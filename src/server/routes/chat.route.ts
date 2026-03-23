import type { Express, Request, Response } from 'express';
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
import { MemoryV2Pipeline } from '../../emotion-core/memory-v2/pipeline';
import { ChromaVectorStore } from '../../emotion-core/memory-v2/storage/vector/chroma-adapter';
import { FalkorGraphStore } from '../../emotion-core/memory-v2/storage/graph/falkor-adapter';

/** Canonical relational reply when LORA_RELATIONAL_ROUTER=1 and intent detected. Returned without engine call. */
export const RELATIONAL_REPLY = 'Thanks for saying that — your warmth is appreciated.';

export interface SessionEntry {
  engine: EngineOrchestrator;
  history: ChatTurn[];
  /** When this session was created (first message). Used for engagement analytics. */
  sessionStartedAt: number;
  /** Tokens used in this session (incremented after each LLM reply). */
  tokensUsed: number;
}

const DEFAULT_ETV = 0.5;

/** Maximum messages per session; exceeding terminates the session and requires a new sessionId. */
const MAX_SESSION_MESSAGES = 25;

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

export interface ApiChatBody {
  userId: string;
  sessionId: string;
  messageId: string;
  text: string;
  timestamp?: number;
  /** Alias accepted from external UIs that send "message" instead of "text". */
  message?: string;
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

  // Accept "text" or "message" — normalize to text
  const rawText = b.text ?? b.message;
  if (!isNonEmptyString(rawText)) {
    return { ok: false, status: 400, error: 'invalid_request', details: 'Missing or empty text (also accepts "message").' };
  }

  const messageId = isNonEmptyString(b.messageId)
    ? (b.messageId as string).trim()
    : `auto-${Date.now()}`;

  const timestamp =
    typeof b.timestamp === 'number' && Number.isFinite(b.timestamp)
      ? b.timestamp
      : Date.now();
  return {
    ok: true,
    data: {
      userId: (b.userId as string).trim(),
      sessionId: (b.sessionId as string).trim(),
      messageId,
      text: (rawText as string).trim(),
      timestamp,
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
      const base = baseResponderFactory();
      return {
        generateResponse(
          systemPrompt: string,
          userMessage: string,
          opts?: { signal?: AbortSignal; requestId?: string; sessionHistory?: Array<{ role: string; text: string; ts?: number }> },
        ) {
          const coarseBand = resolveBand(userId);
          const currentTier = tierService.getTier(userId).tier;
          const policy = getResponsePolicy(currentTier, coarseBand);
          if (isDev) console.log('[LoRa::ResponsePolicy]', { tier: currentTier, band: coarseBand, ...policy });

          const augmentedPrompt = formatPolicyBlock(policy) + '\n\n' + systemPrompt;
          return base.generateResponse(augmentedPrompt, userMessage, opts);
        },
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

  /** Minimum user messages before a session counts toward tier promotion. */
  const MIN_MESSAGES_FOR_COMPLETION = 2;

  function finalizeSession(userId: string, sessionId: string, entry: SessionEntry, reason: 'new_session' | 'session_cap' | 'server_shutdown' | 'idle_timeout' | 'user_terminate'): void {
    emitSessionEnd(userId, sessionId, entry);
    const messageCount = entry.history.filter(t => t.role === 'user').length;
    trackSessionEnded(userId, sessionId, {
      messagesCount: messageCount,
      durationSeconds: Math.round((Date.now() - entry.sessionStartedAt) / 1000),
      tokensUsed: entry.tokensUsed,
      reason,
    });
    if (messageCount >= MIN_MESSAGES_FOR_COMPLETION) {
      tierService.recordSessionCompletionAsync(userId, sessionId).catch(() => {});
    }

    // ── Memory V2 consolidation (end-of-session extraction) ──
    const MIN_MESSAGES_FOR_MEMORY = 3;
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
        console.log('[LoRa::MemoryV2] session consolidated', {
          userId: userId.slice(0, 8),
          sessionId: sessionId.slice(0, 8),
          factsCount: result.factsCount,
          fingerprintStored: result.fingerprintStored,
          profileUpdated: result.profileUpdated,
          reExtracted: result.reExtracted,
        });
      }).catch(err => {
        console.error('[LoRa::MemoryV2] consolidation failed', (err as Error).message);
      });
    }
  }

  function getSession(userId: string, sessionId: string, key = `${userId}::${sessionId}`): SessionEntry {
    let entry = sessions.get(key);
    if (!entry) {
      const prefix = userId + '::';
      for (const k of sessions.keys()) {
        if (k.startsWith(prefix) && k !== key) {
          const old = sessions.get(k)!;
          const oldSessionId = k.slice(prefix.length);
          finalizeSession(userId, oldSessionId, old, 'new_session');
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
        finalizeSession(userId, sessionId, entry, 'idle_timeout');
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
    const { userId, sessionId, text, timestamp } = validated.data;
    if (!userId) {
      res.status(400).json({
        error: 'userId is required for this endpoint.',
      });
      return;
    }

    if (blockedUsers.has(userId)) {
      console.warn(`[LORA_BLOCKED] userId=${userId}`);
      res.status(403).json({ error: 'access_restricted', message: 'Your access has been restricted. Contact support.' });
      return;
    }

    const engineKey = `${userId}::${sessionId}`;
    console.log('ENGINE KEY:', engineKey);
    if (sessionDebug) console.log('[LoRa::Session] /api/chat', { key: engineKey });

    if (!rateLimitTryAllow(userId)) {
      console.warn(`[LORA_RATE_LIMIT] userId=${userId}`);
      res.status(429).json({ message: 'Too many requests. Please slow down.' });
      return;
    }

    const session = getSession(userId, sessionId, engineKey);
    const messageCount = session.history.filter((t) => t.role === 'user').length;
    if (messageCount >= MAX_SESSION_MESSAGES) {
      emitSessionEnd(userId, sessionId, session);
      trackSessionEnded(userId, sessionId, {
        messagesCount: messageCount,
        durationSeconds: Math.round((Date.now() - session.sessionStartedAt) / 1000),
        tokensUsed: session.tokensUsed,
        reason: 'session_cap',
      });
      sessions.delete(engineKey);
      const capTier = await tierService.recordSessionCompletionAsync(userId, sessionId);
      console.warn(`[LORA_SESSION_CAP] sessionId=${sessionId} messages=${messageCount}`);
      res.status(200).json({
        reply: 'This session has reached the maximum message limit. Please start a new session to continue.',
        sessionEnded: true,
        tier: capTier.tier,
        sessionCount: capTier.sessionCount,
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

      const { analyzerOutputs, signalPacket } = InputProcessor.process(text);
      const result = await session.engine.processMessage(
        analyzerOutputs,
        undefined,
        false,
        {},
        undefined,
        signalPacket,
        historyForPrompt,
      );

      const debug = result.debug ?? emptyDebug();

      let reply = result.llmOutput ?? '';
      reply = enforceIdentity(reply);
      reply = enforceWordLimit(reply, policy.maxWords);
      reply = enforceQuestionLimit(reply, policy.maxQuestions);

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

      res.status(200).json({
        reply,
        tier: tierRecord.tier,
        sessionCount: tierRecord.sessionCount,
        debug: {
          eiv: result.eiv?.value ?? 0,
          etv: debug.etv ?? 0,
          band: debug.band ?? 'B0',
          etvBand,
          policy: policyDebug,
          anchorsUsed: debug.anchorsUsed ?? 0,
          schemasUsed: debug.schemasUsed ?? 0,
          degraded: debug.degraded ?? { falkor: false, chroma: false },
          ...(debug.behaviorMode ? { behaviorMode: debug.behaviorMode } : {}),
          ...(debug.stmTurns !== undefined ? { stmTurns: debug.stmTurns } : {}),
          ...((debug as any).personaEnforcer ? { personaEnforcer: (debug as any).personaEnforcer } : {}),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[LoRa::Chat] engine error:', message);
      res.status(500).json({ reply: '', tier: tierRecord.tier, sessionCount: tierRecord.sessionCount, debug: { ...emptyDebug(), etvBand, policy: policyDebug }, error: 'engine_error', details: message });
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
