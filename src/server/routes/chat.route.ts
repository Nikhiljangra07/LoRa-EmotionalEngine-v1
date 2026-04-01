import type { Express, Request, Response } from 'express';
import { increment as opIncrement, trackUser } from '../analytics/operationalCounters';
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
  /** Message index when the deep analysis offer was made. */
  deepAnalysisOfferedAt?: number;
  /** Original message stored during deep mode clarification. */
  deepClarifyOriginal?: string;
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
          summarizerModel: 'claude-sonnet-4-20250514',
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
    recordSessionEnd(messagesCount);
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
      }).then(result => {
        opIncrement('memory_v2_consolidation_success');
        console.log('[LoRa::MemoryV2] session consolidated', {
          userId: userId.slice(0, 8),
          sessionId: sessionId.slice(0, 8),
          factsCount: result.factsCount,
          fingerprintStored: result.fingerprintStored,
          profileUpdated: result.profileUpdated,
          reExtracted: result.reExtracted,
        });
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
      const estimatedTokens = estimateRequestTokens(session.history, text);
      if (wouldExceedLimit(userId, estimatedTokens)) {
        const used = getTokensUsedToday(userId);
        console.warn(`[LORA_TOKEN_LIMIT] userId=${userId} used=${used}`);
        res.status(200).json({
          error: 'daily_limit_reached',
          message: "You have reached today's usage limit. Please try again tomorrow.",
        });
        return;
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

      // Check if this is a clarification response (user answered after ambiguous deep question)
      if (deepModeRequested && session.deepClarifyOriginal) {
        perspectiveMode = 'deep';
        // Combine original + clarification for enriched context
        const enrichedText = `${session.deepClarifyOriginal}\n\n[User clarified]: ${text}`;
        (validated.data as any).text = enrichedText;
        session.deepClarifyOriginal = undefined;
        console.log('[LoRa::DeepAnalysis] clarification received — firing with enriched context');
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
      );

      const debug = result.debug ?? emptyDebug();

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
        // Deep mode: soft cap at 900 words — thorough but not a dump
        reply = enforceWordLimit(reply, 900);
      } else {
        reply = enforceWordLimit(reply, policy.maxWords);
        reply = enforceQuestionLimit(reply, policy.maxQuestions);
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
