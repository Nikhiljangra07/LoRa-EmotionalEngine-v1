import type { Express, Request, Response } from 'express';
import { increment as opIncrement, trackUser, updateConcurrent, recordResponseTime } from '../analytics/operationalCounters';
import { FalkorAnchorAdapter } from '../../emotion-core/memory-v1/db/FalkorAnchorAdapter';
import { ChromaSchemaAdapter } from '../../emotion-core/memory-v1/db/ChromaSchemaAdapter';
import { FalkorFactAnchorStore } from '../../emotion-core/memory-v1/db/FalkorFactAnchorStore';
import { getFalkorClient } from '../../emotion-core/memory-v1/db/falkorClient';
import { getChromaClient } from '../../emotion-core/memory-v1/db/chromaClient';
import { MemoryService } from '../../emotion-core/memory-v1/service/MemoryService';
import { EngineOrchestrator } from '../../emotion-core/engines/EngineOrchestrator';
import { ClaudeResponder } from '../../emotion-core/llm/ClaudeResponder';
import { InputProcessor } from '../../emotion-core/processors/InputProcessor';
import type { ChatTurn } from '../../emotion-core/prompt/PromptTemplateBuilder';
import { STM_MAX_TURNS, truncateTurnText } from '../../emotion-core/prompt/PromptTemplateBuilder';
import { classifyRelationalIntent, RELATIONAL_CONFIDENCE_THRESHOLD } from '../../emotion-core/intent/relationalIntent';
import { sharedTierService } from '../tier/TierService';
import { coarsenBand } from '../behavior/EtvBandBehaviorProfile';
import type { EtvBand } from '../behavior/EtvBandBehaviorProfile';
import { ETVEngineV1 } from '../../emotion-core/etv';
import {
  getResponsePolicy,
  formatPolicyBlock,
  enforceWordLimit,
  enforceQuestionLimit,
} from '../../emotion-core/policy/ResponsePolicy';
import type { ResponsePolicy } from '../../emotion-core/policy/ResponsePolicy';
import { enforceIdentity } from '../../emotion-core/policy/IdentityGuard';
import {
  getDailyLimit,
  getTokensUsedToday,
  wouldExceedLimit,
  addTokens,
} from '../usage/DailyTokenUsage';
import { logSessionEnd } from '../analytics/engagementLogger';
import { isActiveSubscriber } from '../subscription/SubscriptionService';
import {
  incrementTokensToday,
  recordSessionEnd,
  startPeriodicWrite,
} from '../analytics/runtimeMetrics';
import { tryAllow as rateLimitTryAllow } from '../rateLimit/slidingWindowRateLimit';
import {
  trackSessionStarted,
  trackMessageSent,
  trackSessionEnded,
} from '../analytics/posthogClient';
import { featureFlags } from '../../emotion-core/config/featureFlags';
import { MemoryV2Pipeline } from '../../emotion-core/memory-v2/pipeline';
import { ChromaVectorStore } from '../../emotion-core/memory-v2/storage/vector/chroma-adapter';
import { FalkorGraphStore } from '../../emotion-core/memory-v2/storage/graph/falkor-adapter';
import { buildCurrentFingerprint } from '../../emotion-core/memory-v2/retrieval/build-current-fingerprint';
import { MIN_MESSAGES_FOR_COMPLETION, MIN_MESSAGES_FOR_MEMORY } from '../session/constants';
import { getEffectiveUserId } from '../auth/supabaseAuth';
import { sanitizeInput } from '../auth/inputSanitizer';
import type { TierRecord } from '../tier/TierTypes';
import { routeMessage as routeMessageV2 } from '../../emotion-core/routing';
import type { Tier as RouterTier, RouteDecision as RouterDecisionV2 } from '../../emotion-core/routing';

/** Canonical relational reply when LORA_RELATIONAL_ROUTER=1 and intent detected. Returned without engine call. */
export const RELATIONAL_REPLY = 'Thanks for saying that — your warmth is appreciated.';

export interface SessionEntry {
  engine: EngineOrchestrator;
  history: ChatTurn[];
  /** When this session was created (first message). Used for engagement analytics. */
  sessionStartedAt: number;
  /** Tokens used in this session (incremented after each LLM reply). */
  tokensUsed: number;
  /** True when LoRa has offered deep analysis and is awaiting user's yes/no. */
  deepAnalysisPending?: boolean;
  /** True after a soft token-limit warning has been issued for this session. */
  tokenWarningIssued?: boolean;
  /** Message index when the deep analysis offer was made. */
  deepAnalysisOfferedAt?: number;
  /** Original message stored during deep mode clarification. */
  deepClarifyOriginal?: string;
  /**
   * Most recent router tier decisions, oldest → newest, capped to 3 entries.
   * Fed into the router's SessionContext for continuation_inherit + arc_bias.
   */
  recentRouterTiers?: RouterTier[];
}

const DEFAULT_ETV = 0.5;

/** Maximum messages per session; exceeding terminates the session and requires a new sessionId. */
const MAX_SESSION_MESSAGES = 25;

// ── Exported session finalizer (set inside registerChatRoute, used by terminate endpoint) ──
export type SessionFinalizerFn = (
  userId: string,
  sessionId: string,
  entry: SessionEntry,
  reason: 'new_session' | 'session_cap' | 'server_shutdown' | 'idle_timeout' | 'user_terminate',
) => Promise<TierRecord | null>;

let _registeredFinalizer: SessionFinalizerFn | null = null;

/** Get the session finalizer. Only available after registerChatRoute() has been called. */
export function getSessionFinalizer(): SessionFinalizerFn | null {
  return _registeredFinalizer;
}

/** Optional injection for tests (mock LLM + memory so no real DB). */
export interface ChatRouteOptions {
  responderFactory?: () => {
    generateResponse(
      systemPrompt: string,
      userMessage: string,
      options?: { signal?: AbortSignal; requestId?: string; sessionHistory?: Array<{ role: string; text: string; ts?: number }> }
    ): Promise<string>;
  };
  memoryService?: MemoryService;
  tierService?: typeof sharedTierService;
}

/** Image or document attachment sent alongside a message. */
export interface ChatAttachment {
  /** 'image' for JPEG/PNG/GIF/WebP, 'document' for PDF. */
  type: 'image' | 'document';
  /** MIME type (e.g. 'image/jpeg', 'application/pdf'). */
  mimeType: string;
  /** Base64-encoded file data. */
  data: string;
  /** Original filename (optional, for display). */
  name?: string;
}

export interface ApiChatBody {
  userId: string;
  sessionId: string;
  messageId: string;
  text: string;
  timestamp?: number;
  /** Alias accepted from external UIs that send "message" instead of "text". */
  message?: string;
  /** UI-triggered deep reasoning mode (Pro tier). */
  deepMode?: boolean;
  /** Stream response via SSE instead of JSON. */
  stream?: boolean;
  /** Image or document attachments (max 5, each max 20MB). */
  attachments?: ChatAttachment[];
  /**
   * Rehydrate engine history from client-provided messages.
   * Used when a user resumes a chat from the client-side history sidebar
   * after the backend session has been reaped (idle timeout, redeploy, etc).
   * Only applied if the in-memory session has empty history.
   */
  rehydrateHistory?: Array<{ role: 'user' | 'assistant'; text: string }>;
}

export interface ApiChatResponse {
  reply: string;
  tier: import('../tier/TierTypes').TierLevel;
  sessionCount: number;
  debug: {
    eiv: number;
    etv: number;
    band: string;
    etvBand?: EtvBand;
    anchorsUsed: number;
    schemasUsed: number;
    degraded: { falkor: boolean; chroma: boolean };
    behaviorMode?: {
      band: string;
      intensityLevel: 'low' | 'medium' | 'high';
      anchorIntegration: boolean;
      degradedMode: boolean;
    };
    relational?: {
      intent: string;
      confidence: number;
    };
    personaEnforcer?: {
      triggered: boolean;
      kind: string;
      intent?: string;
      confidence?: number;
      templateId?: string;
    };
    policy?: {
      maxWords: number;
      maxQuestions: number;
      reasoningDepth: ResponsePolicy['reasoningDepth'];
      tone: ResponsePolicy['tone'];
    };
  };
}

function isNonEmptyString(x: unknown): x is string {
  return typeof x === 'string' && x.trim().length > 0;
}

interface ValidationError { ok: false; status: number; error: string; details: string }
interface ValidationOk    { ok: true;  data: ApiChatBody }

function validateBody(body: unknown): ValidationOk | ValidationError {
  if (body == null || typeof body !== 'object') {
    return { ok: false, status: 400, error: 'invalid_request', details: 'Request body must be a JSON object.' };
  }
  const b = body as Record<string, unknown>;
  if (!isNonEmptyString(b.userId)) {
    return { ok: false, status: 400, error: 'invalid_request', details: 'Missing or empty userId.' };
  }
  if (!isNonEmptyString(b.sessionId)) {
    return { ok: false, status: 400, error: 'invalid_request', details: 'Missing or empty sessionId.' };
  }

  // Accept "text" or "message" — normalize to text.
  // Text is optional ONLY when attachments are present (LoRa will ask clarification).
  const rawText = b.text ?? b.message;
  const hasAttachments = Array.isArray(b.attachments) && b.attachments.length > 0;
  if (!isNonEmptyString(rawText) && !hasAttachments) {
    return { ok: false, status: 400, error: 'invalid_request', details: 'Missing or empty text (also accepts "message").' };
  }

  const messageId = isNonEmptyString(b.messageId)
    ? (b.messageId as string).trim()
    : `auto-${Date.now()}`;

  const timestamp =
    typeof b.timestamp === 'number' && Number.isFinite(b.timestamp)
      ? b.timestamp
      : Date.now();
  // Validate attachments (if present)
  const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const ALLOWED_DOC_TYPES = ['application/pdf'];
  const MAX_ATTACHMENTS = 5;
  const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5MB per file (base64 decoded size)
  let validatedAttachments: ChatAttachment[] | undefined;

  if (hasAttachments) {
    const rawAttachments = b.attachments as unknown[];
    if (rawAttachments.length > MAX_ATTACHMENTS) {
      return { ok: false, status: 400, error: 'invalid_request', details: `Maximum ${MAX_ATTACHMENTS} attachments allowed.` };
    }
    validatedAttachments = [];
    for (const att of rawAttachments) {
      if (att == null || typeof att !== 'object') continue;
      const a = att as Record<string, unknown>;
      const mimeType = typeof a.mimeType === 'string' ? a.mimeType.toLowerCase().trim() : '';
      const data = typeof a.data === 'string' ? a.data : '';
      if (!data) continue;

      // Per-file size check (base64 is ~4/3 of binary)
      const estimatedBytes = Math.ceil((data.length * 3) / 4);
      if (estimatedBytes > MAX_ATTACHMENT_BYTES) {
        return { ok: false, status: 400, error: 'invalid_request', details: `Attachment exceeds 5MB limit.` };
      }

      const isImage = ALLOWED_IMAGE_TYPES.includes(mimeType);
      const isDoc = ALLOWED_DOC_TYPES.includes(mimeType);
      if (!isImage && !isDoc) continue; // silently skip unsupported types

      validatedAttachments.push({
        type: isImage ? 'image' : 'document',
        mimeType,
        data,
        name: typeof a.name === 'string' ? a.name.trim() : undefined,
      });
    }
    if (validatedAttachments.length === 0) validatedAttachments = undefined;
  }

  // Validate rehydrateHistory (optional) — used to restore session state when
  // the client resumes a conversation from local chat history.
  let validatedRehydrate: Array<{ role: 'user' | 'assistant'; text: string }> | undefined;
  if (Array.isArray(b.rehydrateHistory)) {
    const MAX_REHYDRATE_TURNS = 32; // generous cap; backend will trim to STM_MAX_TURNS
    const MAX_REHYDRATE_TEXT = 2000; // per turn, before backend truncation
    const raw = b.rehydrateHistory as unknown[];
    const collected: Array<{ role: 'user' | 'assistant'; text: string }> = [];
    for (const turn of raw.slice(-MAX_REHYDRATE_TURNS)) {
      if (turn == null || typeof turn !== 'object') continue;
      const t = turn as Record<string, unknown>;
      const role = t.role === 'user' ? 'user' : t.role === 'assistant' ? 'assistant' : null;
      if (!role) continue;
      const text = typeof t.text === 'string' ? t.text.slice(0, MAX_REHYDRATE_TEXT) : '';
      if (!text) continue;
      collected.push({ role, text });
    }
    if (collected.length > 0) validatedRehydrate = collected;
  }

  return {
    ok: true,
    data: {
      userId: (b.userId as string).trim(),
      sessionId: (b.sessionId as string).trim(),
      messageId,
      text: typeof rawText === 'string' ? rawText.trim() : '',
      timestamp,
      ...(b.deepMode === true ? { deepMode: true } : {}),
      ...(b.stream === true ? { stream: true } : {}),
      ...(validatedAttachments ? { attachments: validatedAttachments } : {}),
      ...(validatedRehydrate ? { rehydrateHistory: validatedRehydrate } : {}),
    },
  };
}

function emptyDebug(): ApiChatResponse['debug'] {
  return {
    eiv: 0,
    etv: 0,
    band: 'B0',
    anchorsUsed: 0,
    schemasUsed: 0,
    degraded: { falkor: false, chroma: false },
  };
}

/** Rough token estimate for request (input + output buffer). ~4 chars per token + 500 for output. */
function estimateRequestTokens(history: ChatTurn[], currentText: string): number {
  const inputChars =
    history.reduce((sum, t) => sum + (t.text?.length ?? 0), 0) + currentText.length;
  return Math.ceil(inputChars / 4) + 500;
}

/**
 * Register POST /api/chat with the app. Builds Falkor + Chroma + MemoryService + orchestrator
 * factory once. Throws if LORA_FALKOR_URL or LORA_CHROMA_URL are missing (unless options
 * provide memoryService for testing). Use options to inject mocks in tests and avoid real DB.
 */
export function registerChatRoute(app: Express, options?: ChatRouteOptions): Map<string, SessionEntry> {
  let memoryService: MemoryService;
  const baseResponderFactory = options?.responderFactory ?? (() => new ClaudeResponder());
  const tierService = options?.tierService ?? sharedTierService;
  const isDev = process.env.NODE_ENV !== 'production';

  const blockedUsers = new Set(
    (process.env.LORA_BLOCKED_USERS ?? '').split(',').map(s => s.trim()).filter(Boolean),
  );

  if (options?.memoryService) {
    memoryService = options.memoryService;
  } else {
    const falkorUrl = process.env.LORA_FALKOR_URL;
    const chromaUrl = process.env.LORA_CHROMA_URL;
    if (!falkorUrl?.trim() || !chromaUrl?.trim()) {
      throw new Error(
        'LORA_FALKOR_URL and LORA_CHROMA_URL are required for /api/chat. Set both and restart.'
      );
    }
    const anchorAdapter = new FalkorAnchorAdapter();
    const chromaAdapter = new ChromaSchemaAdapter();
    const factStore = new FalkorFactAnchorStore();
    memoryService = new MemoryService(anchorAdapter, chromaAdapter, factStore);
  }

  // ── Memory V2 (shadow or active mode) ──
  const memoryV2Enabled = process.env.LORA_MEMORY_V2 === '1';
  const memoryV2ShadowEnabled = process.env.LORA_MEMORY_V2_SHADOW === '1';
  const memoryV2Service = (memoryV2Enabled || memoryV2ShadowEnabled)
    ? new MemoryV2Pipeline(
        new ChromaVectorStore({ url: process.env.LORA_CHROMA_URL ?? 'http://localhost:8000' }),
        new FalkorGraphStore({ client: getFalkorClient() }),
        {
          summarizerModel: 'claude-sonnet-4-6',
          extractorModel: 'claude-haiku-4-5-20251001',
          apiKey: process.env.ANTHROPIC_API_KEY!,
        },
      )
    : null;
  if (memoryV2Service) {
    console.log('[LoRa::MemoryV2] initialized', { mode: memoryV2Enabled ? 'active' : 'shadow' });
  }

  const sessions = new Map<string, SessionEntry>();
  const sessionDebug = process.env.LORA_DEBUG_SESSION === '1';

  function resolveBand(userId: string): EtvBand {
    try {
      return coarsenBand(ETVEngineV1.getPolicy(userId).band);
    } catch {
      return 'B0';
    }
  }

  function makePolicyAwareFactory(userId: string) {
    return () => {
      const base = baseResponderFactory() as {
        generateResponse: (...args: any[]) => Promise<string>;
        generateResponseStream?: (systemPrompt: string, userMessage: string, onToken: (chunk: string) => void, opts?: any) => Promise<string>;
      };
      function augmentPrompt(systemPrompt: string) {
        const coarseBand = resolveBand(userId);
        const currentTier = tierService.getTier(userId).tier;
        const policy = getResponsePolicy(currentTier, coarseBand);
        if (isDev) console.log('[LoRa::ResponsePolicy]', { tier: currentTier, band: coarseBand, ...policy });
        return formatPolicyBlock(policy) + '\n\n' + systemPrompt;
      }
      return {
        generateResponse(
          systemPrompt: string,
          userMessage: string,
          opts?: { signal?: AbortSignal; requestId?: string; sessionHistory?: Array<{ role: string; text: string; ts?: number }> },
        ) {
          return base.generateResponse(augmentPrompt(systemPrompt), userMessage, opts);
        },
        // Delegate streaming — same policy augmentation, just uses the streaming API
        generateResponseStream: base.generateResponseStream
          ? (
              systemPrompt: string,
              userMessage: string,
              onToken: (chunk: string) => void,
              opts?: { signal?: AbortSignal; requestId?: string; sessionHistory?: Array<{ role: string; text: string; ts?: number }> },
            ) => base.generateResponseStream!(augmentPrompt(systemPrompt), userMessage, onToken, opts)
          : undefined,
      };
    };
  }

  function emitSessionEnd(userId: string, sessionId: string, entry: SessionEntry): void {
    const now = Date.now();
    const messagesCount = entry.history.filter((t) => t.role === 'user').length;
    const durationSeconds = (now - entry.sessionStartedAt) / 1000;
    logSessionEnd({
      userId,
      sessionId,
      sessionStart: entry.sessionStartedAt,
      sessionEnd: now,
      messagesCount,
      tokensUsed: entry.tokensUsed,
      durationSeconds: Math.round(durationSeconds * 100) / 100,
      endedAt: Math.floor(now / 1000),
    });
    // recordSessionEnd expects session duration in seconds — NOT message count.
    // The dashboard's "Avg session length" reads this as seconds, so passing
    // messagesCount made it show "5s" for sessions that actually spanned
    // 30+ minutes. Use the duration computed two lines above.
    recordSessionEnd(Math.round(durationSeconds));
  }

  /**
   * Finalize a session: engagement logging, PostHog, tier increment (if ≥2 msgs),
   * Memory V2 consolidation (if ≥3 msgs). Single code path for all session-end reasons.
   * Returns the updated TierRecord if tier was incremented, null otherwise.
   */
  async function finalizeSession(userId: string, sessionId: string, entry: SessionEntry, reason: 'new_session' | 'session_cap' | 'server_shutdown' | 'idle_timeout' | 'user_terminate'): Promise<TierRecord | null> {
    emitSessionEnd(userId, sessionId, entry);
    const messageCount = entry.history.filter(t => t.role === 'user').length;
    trackSessionEnded(userId, sessionId, {
      messagesCount: messageCount,
      durationSeconds: Math.round((Date.now() - entry.sessionStartedAt) / 1000),
      tokensUsed: entry.tokensUsed,
      reason,
    });

    let tierRecord: TierRecord | null = null;
    if (messageCount >= MIN_MESSAGES_FOR_COMPLETION) {
      try {
        tierRecord = await tierService.recordSessionCompletionAsync(userId, sessionId);
        // Counter visible on the health dashboard's TODAY'S ACTIVITY card.
        // Fires for every session that crossed the MIN_MESSAGES guard,
        // regardless of end reason (terminate, cap, idle, redeploy drain).
        opIncrement('session_completed');
      } catch { /* tier increment failed — non-fatal */ }
    }

    // ── Memory V2 consolidation (end-of-session extraction) ──
    if (memoryV2Service && messageCount >= MIN_MESSAGES_FOR_MEMORY) {
      const eivCurve = entry.engine.getSessionEIVs();
      memoryV2Service.processSessionEnd({
        userId,
        sessionId,
        conversationHistory: entry.history.map(t => ({
          role: t.role === 'user' ? 'user' as const : 'lora' as const,
          content: t.text,
        })),
        eivCurve,
        perspectiveResults: entry.engine.getSessionPerspectives(),
      }).then(result => {
        // The V2 pipeline swallows its own timeouts/partial failures and
        // resolves with a zeroed result instead of rejecting. Treat that
        // case as a no-op, not a success — otherwise the dashboard counter
        // and logs look healthy while data was actually lost upstream.
        const didAnything =
          result.factsCount > 0 ||
          result.fingerprintStored ||
          result.profileUpdated;
        const payload = {
          userId: userId.slice(0, 8),
          sessionId: sessionId.slice(0, 8),
          factsCount: result.factsCount,
          fingerprintStored: result.fingerprintStored,
          profileUpdated: result.profileUpdated,
          reExtracted: result.reExtracted,
        };
        if (didAnything) {
          opIncrement('memory_v2_consolidation_success');
          console.log('[LoRa::MemoryV2] session consolidated', payload);
        } else {
          opIncrement('memory_v2_consolidation_failure');
          console.warn(
            '[LoRa::MemoryV2] consolidation produced no-op (upstream failure swallowed)',
            payload,
          );
        }
      }).catch(err => {
        opIncrement('memory_v2_consolidation_failure');
        console.error('[LoRa::MemoryV2] consolidation failed', (err as Error).message);
      });
    }

    return tierRecord;
  }

  // Expose finalizeSession for session.lifecycle.route.ts (terminate endpoint).
  _registeredFinalizer = (userId, sessionId, entry, reason) =>
    finalizeSession(userId, sessionId, entry, reason);

  function getSession(userId: string, sessionId: string, key = `${userId}::${sessionId}`): SessionEntry {
    let entry = sessions.get(key);
    if (!entry) {
      const prefix = userId + '::';
      for (const k of sessions.keys()) {
        if (k.startsWith(prefix) && k !== key) {
          const old = sessions.get(k)!;
          const oldSessionId = k.slice(prefix.length);
          finalizeSession(userId, oldSessionId, old, 'new_session').catch(() => {});
          sessions.delete(k);
        }
      }
      const startedAt = Date.now();
      entry = {
        engine: new EngineOrchestrator(DEFAULT_ETV, {}, makePolicyAwareFactory(userId), {
          userId,
          memoryService,
        }),
        history: [],
        sessionStartedAt: startedAt,
        tokensUsed: 0,
      };
      sessions.set(key, entry);
      updateConcurrent(sessions.size);
      trackSessionStarted(userId, sessionId);
      if (sessionDebug) console.log('[LoRa::Session] engine created', { key });
    }
    return entry;
  }

  /** Idle session reaper: finalizes sessions with no activity for 30 minutes (browser close, tab close, etc.). */
  const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
  const REAPER_INTERVAL_MS = 5 * 60 * 1000;

  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of sessions.entries()) {
      const lastActivity = entry.history.length > 0
        ? entry.history[entry.history.length - 1].ts ?? entry.sessionStartedAt
        : entry.sessionStartedAt;
      if (now - lastActivity >= IDLE_TIMEOUT_MS) {
        const [userId, sessionId] = key.split('::');
        console.log('[LoRa::SessionReaper] idle session finalized', { key, idleMinutes: Math.round((now - lastActivity) / 60000) });
        finalizeSession(userId, sessionId, entry, 'idle_timeout').catch(() => {});
        sessions.delete(key);
      }
    }
  }, REAPER_INTERVAL_MS).unref();

  app.post('/api/chat', async (req: Request, res: Response): Promise<void> => {
    const origin = req.headers.origin ?? req.headers.referer ?? '(none)';
    const bodyKeys = req.body && typeof req.body === 'object' ? Object.keys(req.body) : [];
    console.log('[LoRa::Chat] POST /api/chat', { method: req.method, path: req.path, origin, bodyKeys });

    const validated = validateBody(req.body);
    if (!validated.ok) {
      console.log('[LoRa::Chat] validation failed:', validated.details);
      res.status(validated.status).json({ error: validated.error, details: validated.details });
      return;
    }
    const { sessionId, timestamp } = validated.data;

    // Use JWT-verified userId for authenticated users, body userId for guests
    const userId = getEffectiveUserId(req, validated.data.userId);
    if (!userId) {
      res.status(400).json({
        error: 'userId is required for this endpoint.',
      });
      return;
    }

    // ── Input sanitization: strip prompt injection payloads ──
    const sanitized = sanitizeInput(validated.data.text);
    if (sanitized.injectionDetected) {
      opIncrement('sanitizer_triggered');
      console.warn(`[LORA_INJECTION] userId=${userId} patterns=${sanitized.matchedPatterns.join(',')}`);
    }
    const text = sanitized.text;

    if (blockedUsers.has(userId)) {
      console.warn(`[LORA_BLOCKED] userId=${userId}`);
      res.status(403).json({ error: 'access_restricted', message: 'Your access has been restricted. Contact support.' });
      return;
    }

    const engineKey = `${userId}::${sessionId}`;
    console.log('ENGINE KEY:', engineKey);
    if (sessionDebug) console.log('[LoRa::Session] /api/chat', { key: engineKey });

    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '';
    if (!rateLimitTryAllow(userId, clientIp)) {
      opIncrement('rate_limit_user');
      console.warn(`[LORA_RATE_LIMIT] userId=${userId} ip=${clientIp}`);
      res.status(429).json({ message: 'Too many requests. Please slow down.' });
      return;
    }

    const session = getSession(userId, sessionId, engineKey);

    // ── Rehydrate session history from client (sidebar resume) ──
    // Only fires when:
    //   1. Client provided rehydrateHistory (resuming from local sidebar)
    //   2. Backend session has empty history (i.e. it was just created OR reaped)
    // Existing in-memory sessions are never overwritten — backend state is truth.
    if (validated.data.rehydrateHistory && session.history.length === 0) {
      const truncated = validated.data.rehydrateHistory.slice(-STM_MAX_TURNS);
      for (const turn of truncated) {
        session.history.push({
          role: turn.role,
          text: truncateTurnText(turn.text),
          ts: Date.now(),
        });
      }
      console.log(`[LoRa::Rehydrate] restored ${session.history.length} turns for ${engineKey}`);
    }

    const messageCount = session.history.filter((t) => t.role === 'user').length;
    if (messageCount >= MAX_SESSION_MESSAGES) {
      opIncrement('session_cap_hit');
      const capTier = await finalizeSession(userId, sessionId, session, 'session_cap');
      sessions.delete(engineKey);
      console.warn(`[LORA_SESSION_CAP] sessionId=${sessionId} messages=${messageCount}`);
      const currentTier = capTier ?? await tierService.getTierAsync(userId);
      res.status(200).json({
        reply: 'This session has reached the maximum message limit. Please start a new session to continue.',
        sessionEnded: true,
        tier: currentTier.tier,
        sessionCount: currentTier.sessionCount,
        debug: emptyDebug(),
        error: 'session_cap',
        details: 'Session message limit reached. Use a new sessionId to continue.',
      });
      return;
    }

    // Tier comes ONLY from TierService (TIER_1 | TIER_2 | TIER_3). Never use band/etvBand/debug.band for top-level tier.
    const tierRecord = await tierService.getTierAsync(userId);
    console.log('[LoRa::TierCheck]', {
      tierFromService: tierRecord.tier,
      sessionCount: tierRecord.sessionCount,
      etvBand: resolveBand(userId)
    });
    const etvBand = resolveBand(userId);
    const policy = getResponsePolicy(tierRecord.tier, etvBand);
    const policyDebug = { maxWords: policy.maxWords, maxQuestions: policy.maxQuestions, reasoningDepth: policy.reasoningDepth, tone: policy.tone };

    const dailyLimit = getDailyLimit();
    if (dailyLimit > 0) {
      const used = getTokensUsedToday(userId);
      const estimatedTokens = estimateRequestTokens(session.history, text);

      if (wouldExceedLimit(userId, estimatedTokens)) {
        console.warn(`[LORA_TOKEN_LIMIT] userId=${userId} used=${used}`);
        res.status(200).json({
          error: 'daily_limit_reached',
          message: "You have reached today's usage limit. Please try again tomorrow.",
        });
        return;
      }

      // Graceful wrap-up: when approaching limit during a heavy session,
      // flag the engine so the next reply includes a soft closure.
      const TOKEN_WARNING_THRESHOLD = 0.9;
      if (used > dailyLimit * TOKEN_WARNING_THRESHOLD) {
        const eivCurve = session.engine.getSessionEIVs();
        const recentEIVs = eivCurve.slice(-5);
        const hasElevatedEIV = recentEIVs.some(v => v > 0.4);
        if (hasElevatedEIV && !session.tokenWarningIssued) {
          session.tokenWarningIssued = true;
          opIncrement('containment_token_warning');
          console.log(`[LoRa::TokenWarning] userId=${userId} used=${used}/${dailyLimit} — issuing graceful wrap-up`);
        }
      }
    }

    try {
      const userTurn: ChatTurn = {
        role: 'user',
        text: truncateTurnText(text),
        ts: typeof timestamp === 'number' ? timestamp : Date.now(),
      };
      session.history.push(userTurn);

      // Relational router: when LORA_RELATIONAL_ROUTER=1 and intent detected, return immediately.
      // No engine call, no navigation overlays, no prompt builder. Reply exactly RELATIONAL_REPLY.
      if (process.env.LORA_RELATIONAL_ROUTER === '1') {
        const classification = classifyRelationalIntent(text);
        if (classification.intent !== 'none' && classification.confidence >= RELATIONAL_CONFIDENCE_THRESHOLD) {
          const guardedReply = enforceIdentity(RELATIONAL_REPLY);
          session.history.push({
            role: 'assistant',
            text: guardedReply,
            ts: Date.now(),
          });
          trackMessageSent(userId, sessionId, {
            messageIndex: session.history.filter(t => t.role === 'user').length,
            tier: tierRecord.tier,
            etvBand,
            eiv: 0,
            anchorsUsed: 0,
            replyLengthChars: guardedReply.length,
            tokensEstimated: 0,
          });

          opIncrement('messages_relational');
          trackUser(userId);
          const debug = emptyDebug();
          res.status(200).json({
            reply: guardedReply,
            tier: tierRecord.tier,
            sessionCount: tierRecord.sessionCount,
            debug: {
              ...debug,
              etvBand,
              policy: policyDebug,
              relational: { intent: classification.intent, confidence: classification.confidence },
            },
          });
          return;
        }
      }

      const historyForPrompt = session.history.slice(-STM_MAX_TURNS);

      // ── Adaptive Router (always on) ──
      // Computes the routing decision using the user's message + session
      // context (recent tier chain drives continuation_inherit / arc_bias).
      // The decision feeds perspectiveMode + the engine's model selection.
      //
      // Crisis safety: if router returns reason='crisis_override' we skip
      // framework analysis entirely (routerSkipPerspective) so LoRaMaths
      // doesn't run game theory / Bayesian analysis on a suicide message.
      // Still routes to substantive (Sonnet + LoRa identity + CRISIS block).
      const recentTiers = session.recentRouterTiers ?? [];
      const routerDecisionV2: RouterDecisionV2 = routeMessageV2({
        text,
        context: {
          messageCount: session.history.filter(t => t.role === 'user').length - 1,
          recentTiers: recentTiers.slice(-3),
          recentEIVs: session.engine.getSessionEIVs().slice(-3),
          inClarificationLoop: !!session.deepClarifyOriginal,
        },
      });
      // Crisis content skips framework analysis. Trivial tier also skips —
      // greetings and acks don't benefit from LoRaMaths and shouldn't pay
      // the 3-4s latency.
      const routerSkipPerspective =
        routerDecisionV2.reason === 'crisis_override' ||
        routerDecisionV2.tier === 'trivial';
      if (isDev) {
        console.log('[LoRa::Router]', {
          tier: routerDecisionV2.tier,
          reason: routerDecisionV2.reason,
          confidence: routerDecisionV2.confidence,
          skipPerspective: routerSkipPerspective,
          recentTiers,
        });
      }

      // ── Memory V2 retrieval (active mode only, not shadow) ──
      if (memoryV2Enabled && memoryV2Service) {
        try {
          const { analyzerOutputs: preAnalysis } = InputProcessor.process(text);
          const fingerprint = buildCurrentFingerprint({
            eiv: preAnalysis.expressionStrength.score,
            arousal: preAnalysis.arousal.score,
            valence: preAnalysis.valence.score,
            userMessage: text,
            turnCount: session.history.length,
          });
          const v2Context = await memoryV2Service.retrieveContext(userId, fingerprint);
          if (v2Context.relatedFacts.length > 0) {
            session.engine.setMemoryV2Context({
              matchedSessions: v2Context.matchedSessions.map(m => ({ similarity: m.similarity })),
              relatedFacts: v2Context.relatedFacts.map(f => ({
                type: f.type,
                value: f.value,
                confidence: f.confidence,
              })),
              responseMode: v2Context.responseMode,
              topSimilarity: v2Context.topSimilarity,
            });
            console.log('[LoRa::MemoryV2] retrieved', {
              userId: userId.slice(0, 8),
              facts: v2Context.relatedFacts.length,
              mode: v2Context.responseMode,
              similarity: v2Context.topSimilarity.toFixed(2),
            });
          }
        } catch (err) {
          console.warn('[LoRa::MemoryV2] retrieval failed:', (err as Error).message);
        }
      }

      // ── Deep analysis mode detection ──
      let perspectiveMode: 'quick' | 'deep' | undefined;
      const deepModeRequested = featureFlags.perspectiveDeepModeEnabled && validated.data.deepMode === true;

      // Clear stale deep clarification context when user sends a non-deep message
      // (e.g. after aborting deep mode on the frontend)
      if (!deepModeRequested && session.deepClarifyOriginal) {
        console.log('[LoRa::DeepAnalysis] clearing stale deepClarifyOriginal — non-deep message received');
        session.deepClarifyOriginal = undefined;
      }

      // ── Deep-mode gate ──
      // When LORA_SUBSCRIPTION_ENABLED is OFF (default), Deep Mode is open to
      // all authenticated users — matches the current prod behaviour.
      // When ON, Deep Mode requires an active Stripe subscription
      // (customer.subscription.* webhook events drive the Redis state).
      // Guests are blocked regardless — userId is empty.
      if (deepModeRequested) {
        opIncrement('deep_reasoning_requested');

        if (featureFlags.subscriptionEnabled) {
          if (!userId) {
            opIncrement('deep_reasoning_gated_no_auth');
            res.status(401).json({
              error: 'auth_required',
              message: 'Sign in to use Deep Mode',
              action: 'sign_in',
            });
            return;
          }
          const subscribed = await isActiveSubscriber(userId);
          if (!subscribed) {
            opIncrement('deep_reasoning_gated_no_subscription');
            res.status(402).json({
              error: 'subscription_required',
              message: 'Deep Mode requires a Depth subscription. CA$19.99/mo, cancel anytime.',
              action: 'subscribe',
              subscribeUrl: '/pricing',
            });
            return;
          }
        }
      }

      // Check if this is a clarification response (user answered after ambiguous deep question)
      if (deepModeRequested && session.deepClarifyOriginal) {
        // Detect topic shift: if the new message looks like a fresh question
        // (long, contains '?', and shares few words with the original),
        // discard the old context and treat as a new deep question.
        const origWords = new Set(session.deepClarifyOriginal.toLowerCase().split(/\s+/));
        const newWords = text.toLowerCase().split(/\s+/);
        const overlap = newWords.filter(w => w.length > 3 && origWords.has(w)).length;
        const overlapRatio = newWords.length > 0 ? overlap / newWords.length : 0;
        const looksLikeNewQuestion = text.includes('?') && newWords.length > 8 && overlapRatio < 0.3;

        if (looksLikeNewQuestion) {
          // Topic shift — discard old context, start fresh deep analysis
          session.deepClarifyOriginal = undefined;
          perspectiveMode = 'deep';
          console.log('[LoRa::DeepAnalysis] topic shift detected — starting fresh deep analysis');
        } else {
          perspectiveMode = 'deep';
          const enrichedText = `${session.deepClarifyOriginal}\n\n[User clarified]: ${text}`;
          (validated.data as any).text = enrichedText;
          session.deepClarifyOriginal = undefined;
          console.log('[LoRa::DeepAnalysis] clarification received — firing with enriched context');
        }
      } else if (deepModeRequested) {
        perspectiveMode = 'deep';
        console.log('[LoRa::DeepAnalysis] UI triggered — firing deep mode');
      } else if (featureFlags.perspectiveDeepModeEnabled && session.deepAnalysisPending) {
        const yesPattern = /^(yes|yeah|yep|ok|sure|haan|ha|go ahead|do it|full|deep)\b/i;
        if (yesPattern.test(text.trim())) {
          perspectiveMode = 'deep';
          session.deepAnalysisPending = false;
          session.engine.setDeepAnalysisPending(false);
          console.log('[LoRa::DeepAnalysis] user accepted — firing deep mode');
        } else {
          session.deepAnalysisPending = false;
          session.engine.setDeepAnalysisPending(false);
        }
      }

      // ── Crisis safety override: crisis content ALWAYS bypasses deep mode ──
      // Even if the user manually toggled deep OR accepted the offer, crisis
      // vocabulary must never reach the Vortex deep synthesis pipeline (which
      // would run game-theory / Bayesian frameworks on suicide content). The
      // crisis response goes through the standard Sonnet path with the
      // CRISIS_RESPONSE_BLOCK appended; LoRaMaths is skipped entirely.
      if (routerDecisionV2.signals.hasCrisis && perspectiveMode === 'deep') {
        console.warn('[LoRa::Crisis] overriding deepMode — crisis content must not reach deep synthesis');
        perspectiveMode = undefined;
      }

      // ── Attachment-only clarification ──
      // When user sends an image/document without meaningful text, LoRa sees the
      // attachment and asks what specifically they need. Feels like LoRa is engaged
      // with the content, not like a limitation.
      const hasAttachments = validated.data.attachments && validated.data.attachments.length > 0;
      let effectiveText = text;
      if (hasAttachments && (!text || text.length < 3)) {
        effectiveText = '[User shared an attachment without a question. Look at what they sent, acknowledge it briefly, then ask what specifically they want you to analyze or help with.]';
      }

      const { analyzerOutputs, signalPacket } = InputProcessor.process(effectiveText);

      // ── Streaming: use streaming LLM API internally for speed, ──
      // ── but buffer the full response and guard it before sending. ──
      // ── No raw LLM tokens ever reach the client. ──
      const wantsStream = !!validated.data.stream;

      const _engineStart = Date.now();
      const result = await session.engine.processMessage(
        analyzerOutputs,
        undefined,
        false,
        {},
        undefined,
        signalPacket,
        historyForPrompt,
        perspectiveMode,
        // Use streaming API internally (faster TTFT) but don't pipe to client
        wantsStream ? () => {} : undefined,
        // Attachments (images, PDFs) — passed through to Claude API
        validated.data.attachments,
        // Router tier — engine uses this for model selection (Haiku/Sonnet).
        routerDecisionV2.tier,
        // Router skip-perspective — true for trivial tier + crisis content.
        routerSkipPerspective,
        // Router crisis signal — engine appends CRISIS_RESPONSE_BLOCK to
        // the system prompt when true, suspending the 6 Laws for this reply.
        routerDecisionV2.signals.hasCrisis,
      );

      const debug = result.debug ?? emptyDebug();

      // ── Record router tier into session context (arc_bias + continuation_inherit) ──
      // Only after a successful processMessage — the tier reflects a
      // committed decision. Cap to last 3 entries.
      {
        const recent = session.recentRouterTiers ?? [];
        recent.push(routerDecisionV2.tier);
        session.recentRouterTiers = recent.slice(-3);
      }

      // Sync deep analysis pending state from engine → session
      if (featureFlags.perspectiveDeepModeEnabled && session.engine.isDeepAnalysisPending()) {
        session.deepAnalysisPending = true;
        session.deepAnalysisOfferedAt = session.history.filter(t => t.role === 'user').length;
      }

      let reply = result.llmOutput ?? '';
      reply = enforceIdentity(reply);
      const isDeepAnalysis = !!(result as any).deepAnalysis;
      const isDeepClarification = !!(result as any).deepClarification;

      // If deep mode returned a clarification, store original message for next request
      if (isDeepClarification) {
        session.deepClarifyOriginal = text;
        console.log('[LoRa::DeepAnalysis] storing original message for clarification flow');
      }

      if (isDeepAnalysis) {
        opIncrement('deep_reasoning_completed');
        // Deep mode: soft cap at 900 words — thorough but not a dump
        // (consumeDeepModeUse removed — per-use paywall retired, pending Phase 4 subscription)
        reply = enforceWordLimit(reply, 900);
      } else if (routerDecisionV2.signals.hasCrisis) {
        // Crisis response: tight cap, one safety question. Presence,
        // not exposition. Matches the CRISIS_RESPONSE_BLOCK's "Under 120
        // words" instruction — 150 is the post-generation backstop in
        // case the model overshoots.
        reply = enforceWordLimit(reply, 150);
        reply = enforceQuestionLimit(reply, 1);
      } else {
        // Tighter limits during CONTAINMENT: shorter replies, fewer questions
        const currentEIV = result.eiv?.value ?? 0;
        const inContainment = currentEIV > 0.4;
        const effectiveMaxWords = inContainment ? Math.min(policy.maxWords, 150) : policy.maxWords;
        const effectiveMaxQuestions = inContainment ? 1 : policy.maxQuestions;
        reply = enforceWordLimit(reply, effectiveMaxWords);
        reply = enforceQuestionLimit(reply, effectiveMaxQuestions);
      }

      // Graceful wrap-up: append a soft closure notice when approaching token limit during heavy sessions
      if (session.tokenWarningIssued) {
        reply += '\n\n---\n*We are approaching today\'s session limit. What is the one thing you most need before we close?*';
        session.tokenWarningIssued = false; // only show once
      }

      const consumed =
        estimateRequestTokens(session.history, '') + Math.ceil(reply.length / 4);
      if (dailyLimit > 0) addTokens(userId, consumed);
      session.tokensUsed += consumed;
      incrementTokensToday(consumed);

      trackMessageSent(userId, sessionId, {
        messageIndex: session.history.filter(t => t.role === 'user').length,
        tier: tierRecord.tier,
        etvBand,
        eiv: result.eiv?.value ?? 0,
        anchorsUsed: debug.anchorsUsed ?? 0,
        replyLengthChars: reply.length,
        tokensEstimated: consumed,
        routedTier: routerDecisionV2.tier,
        routedReason: routerDecisionV2.reason,
        routedConfidence: routerDecisionV2.confidence,
        routedSkipPerspective: routerSkipPerspective,
      });

      if (reply) {
        session.history.push({
          role: 'assistant',
          text: truncateTurnText(reply),
          ts: Date.now(),
        });
      }

      if (session.history.length > STM_MAX_TURNS * 2) {
        session.history = session.history.slice(-STM_MAX_TURNS);
      }

      const debugPayload = {
        eiv: result.eiv?.value ?? 0,
        etv: debug.etv ?? 0,
        band: debug.band ?? 'B0',
        etvBand,
        policy: policyDebug,
        anchorsUsed: debug.anchorsUsed ?? 0,
        schemasUsed: debug.schemasUsed ?? 0,
        degraded: debug.degraded ?? { falkor: false, chroma: false },
        ...((debug as any).behaviorMode ? { behaviorMode: (debug as any).behaviorMode } : {}),
        ...(debug.stmTurns !== undefined ? { stmTurns: debug.stmTurns } : {}),
        ...((debug as any).personaEnforcer ? { personaEnforcer: (debug as any).personaEnforcer } : {}),
      };

      // ── SSE streaming path ──
      // Full response is generated, identity-guarded, word/question-limited.
      // Now stream the GUARDED text progressively via SSE.
      // No raw LLM tokens ever reach the client.
      if (wantsStream) {
        // Record the message BEFORE we start streaming. Doing it here (not after
        // the stream loop) ensures the dashboard counters update even if the
        // client disconnects mid-stream — the work was already done by the
        // engine. Without this, the SSE path was completely uninstrumented and
        // the dashboard showed 0 messages / 0 users despite real traffic.
        opIncrement('messages_processed');
        trackUser(userId);
        recordResponseTime(Date.now() - _engineStart);

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        const meta = {
          tier: tierRecord.tier,
          sessionCount: tierRecord.sessionCount,
          ...(isDeepClarification ? { deepClarification: true } : {}),
          ...(isDeepAnalysis ? { deepAnalysis: true, deepMeta: (result as any).deepMeta } : {}),
          debug: debugPayload,
        };
        res.write(`event: meta\ndata: ${JSON.stringify(meta)}\n\n`);

        // Stream the guarded reply word by word for progressive display.
        // Split into ~8-word chunks, send at 40ms intervals.
        const words = reply.split(/(\s+)/);
        const chunkSize = 16; // ~8 words + whitespace
        let i = 0;
        await new Promise<void>((resolve) => {
          const iv = setInterval(() => {
            if (i >= words.length) {
              clearInterval(iv);
              resolve();
              return;
            }
            const chunk = words.slice(i, i + chunkSize).join('');
            i += chunkSize;
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            if (typeof (res as any).flush === 'function') (res as any).flush();
          }, 40);
          req.on('close', () => { clearInterval(iv); resolve(); });
        });

        res.write(`event: final\ndata: ${JSON.stringify(reply)}\n\n`);
        res.write(`event: done\ndata: {}\n\n`);
        res.end();
        return;
      }

      // ── Standard JSON response (non-streaming) ──
      opIncrement('messages_processed');
      trackUser(userId);
      recordResponseTime(Date.now() - _engineStart);
      res.status(200).json({
        reply,
        tier: tierRecord.tier,
        ...(isDeepClarification ? { deepClarification: true } : {}),
        sessionCount: tierRecord.sessionCount,
        ...(isDeepAnalysis ? {
          deepAnalysis: true,
          deepMeta: (result as any).deepMeta,
        } : {}),
        debug: debugPayload,
      });
    } catch (err) {
      opIncrement('error_500');
      const message = err instanceof Error ? err.message : String(err);
      console.error('[LoRa::Chat] engine error:', message);
      res.status(500).json({ reply: '', tier: tierRecord.tier, sessionCount: tierRecord.sessionCount, debug: { ...emptyDebug(), etvBand, policy: policyDebug }, error: 'engine_error', details: 'An error occurred processing your message. Please try again.' });
    }
  });

  startPeriodicWrite();
  return sessions;
}

/**
 * Run Chroma and Falkor health probes; log one line per DB. Call after registerChatRoute
 * (when LORA_FALKOR_URL and LORA_CHROMA_URL are set). Does not throw or exit.
 */
export async function runStartupHealthChecks(): Promise<void> {
  try {
    const c = getFalkorClient();
    if (c.status === 'wait') await c.connect();
    await c.ping();
    console.log('[LoRa] Falkor OK');
  } catch {
    console.log('[LoRa] Falkor: unreachable');
  }
  try {
    await getChromaClient().heartbeat();
    console.log('[LoRa] Chroma ready (manual embedding mode)');
  } catch {
    console.log('[LoRa] Chroma: unreachable');
  }
}
