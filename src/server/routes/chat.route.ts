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

/** Canonical relational reply when LORA_RELATIONAL_ROUTER=1 and intent detected. Returned without engine call. */
export const RELATIONAL_REPLY = 'Thanks for saying that — your warmth is appreciated.';

export interface SessionEntry {
  engine: EngineOrchestrator;
  history: ChatTurn[];
}

const DEFAULT_ETV = 0.5;

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
  debug: {
    eiv: number;
    etv: number;
    band: string;
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

/**
 * Register POST /api/chat with the app. Builds Falkor + Chroma + MemoryService + orchestrator
 * factory once. Throws if LORA_FALKOR_URL or LORA_CHROMA_URL are missing (unless options
 * provide memoryService for testing). Use options to inject mocks in tests and avoid real DB.
 */
export function registerChatRoute(app: Express, options?: ChatRouteOptions): Map<string, SessionEntry> {
  let memoryService: MemoryService;
  const responderFactory = options?.responderFactory ?? (() => new ClaudeResponder());

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

  const sessions = new Map<string, SessionEntry>();
  const sessionDebug = process.env.LORA_DEBUG_SESSION === '1';

  function getSession(userId: string, sessionId: string, key = `${userId}::${sessionId}`): SessionEntry {
    let entry = sessions.get(key);
    if (!entry) {
      entry = {
        engine: new EngineOrchestrator(DEFAULT_ETV, {}, responderFactory, {
          userId,
          memoryService,
        }),
        history: [],
      };
      sessions.set(key, entry);
      if (sessionDebug) console.log('[LoRa::Session] engine created', { key });
    }
    return entry;
  }

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
    const engineKey = `${userId}::${sessionId}`;
    console.log('ENGINE KEY:', engineKey);
    if (sessionDebug) console.log('[LoRa::Session] /api/chat', { key: engineKey });

    const session = getSession(userId, sessionId, engineKey);

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
          session.history.push({
            role: 'assistant',
            text: RELATIONAL_REPLY,
            ts: Date.now(),
          });
          const debug = emptyDebug();
          res.status(200).json({
            reply: RELATIONAL_REPLY,
            debug: {
              ...debug,
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

      const assistantText = result.llmOutput ?? '';
      if (assistantText) {
        session.history.push({
          role: 'assistant',
          text: truncateTurnText(assistantText),
          ts: Date.now(),
        });
      }

      if (session.history.length > STM_MAX_TURNS * 2) {
        session.history = session.history.slice(-STM_MAX_TURNS);
      }

      const debug = result.debug ?? emptyDebug();
      res.status(200).json({
        reply: result.llmOutput,
        debug: {
          eiv: result.eiv?.value ?? 0,
          etv: debug.etv ?? 0,
          band: debug.band ?? 'B0',
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
      res.status(500).json({ reply: '', debug: emptyDebug(), error: 'engine_error', details: message });
    }
  });

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
    console.log('[LoRa] Chroma OK');
  } catch {
    console.log('[LoRa] Chroma: unreachable');
  }
}
