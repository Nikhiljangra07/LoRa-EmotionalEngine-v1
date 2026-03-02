import '../bootstrap';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { InputProcessor } from '../emotion-core/processors/InputProcessor';
import { EngineOrchestrator } from '../emotion-core/engines/EngineOrchestrator';
import { getLLMHealth } from './llmTelemetry';
import { debugEnabled } from '../emotion-core/debug/debugGate';
import { registerChatRoute, runStartupHealthChecks } from './routes/chat.route';
import { registerSessionLifecycleRoute } from './routes/session.lifecycle.route';
import { registerOnboardingRoute } from './routes/onboarding.route';
import { featureFlags } from '../emotion-core/config/featureFlags';
import type { ChatTurn } from '../emotion-core/prompt/PromptTemplateBuilder';
import { STM_MAX_TURNS, truncateTurnText } from '../emotion-core/prompt/PromptTemplateBuilder';

const app = express();
const port = 3000;

app.use(
  cors({
    origin: ['http://localhost:8080', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  })
);

app.use(express.json());

// Laura UI: serve public/ so GET / opens the chat page
app.use(express.static(path.join(__dirname, '..', '..', 'public')));

let apiChatRegistered = false;
try {
  registerChatRoute(app);
  apiChatRegistered = true;
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn('[LoRa::Adapter] /api/chat not registered:', msg);
}
registerOnboardingRoute(app);
registerSessionLifecycleRoute(app);

// ── Legacy /chat session layer ──────────────────────────────────────
// Single global engine for the legacy /chat endpoint (no session IDs).
// Ephemeral — lost on process restart, no persistence.
const legacyEngine = new EngineOrchestrator();
const legacyChatHistory = new Map<string, ChatTurn[]>();
const DEFAULT_SESSION_ID = 'default-http-session';

function getLegacyHistory(sessionId: string): ChatTurn[] {
  let h = legacyChatHistory.get(sessionId);
  if (!h) {
    h = [];
    legacyChatHistory.set(sessionId, h);
  }
  return h;
}

// ── Health: LLM readiness (read-only, no side-effects) ───────────────
app.get('/health/llm', (_req, res) => {
  res.json(getLLMHealth());
});

app.post('/chat', async (req, res) => {
  const message =
    typeof req.body?.message === 'string' ? req.body.message : '';

  if (!message) {
    return res.status(400).json({ reply: '' });
  }

  try {
    const engine = legacyEngine;
    const history = getLegacyHistory(DEFAULT_SESSION_ID);

    const userTurn: ChatTurn = {
      role: 'user',
      text: truncateTurnText(message),
      ts: Date.now(),
    };
    history.push(userTurn);
    const historyForPrompt = history.slice(-STM_MAX_TURNS);

    const { analyzerOutputs, signalPacket } =
      InputProcessor.process(message);

    const result = await engine.processMessage(
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
      history.push({
        role: 'assistant',
        text: truncateTurnText(assistantText),
        ts: Date.now(),
      });
    }
    if (history.length > STM_MAX_TURNS * 2) {
      history.splice(0, history.length - STM_MAX_TURNS);
    }

    if (debugEnabled) {
      console.log('[LoRa::Audit][Adapter]', {
        message,
        reply: result.llmOutput,
      });
    }

    return res.json({ reply: result.llmOutput });
  } catch {
    return res.status(500).json({ reply: '' });
  }
});

app.listen(port, () => {
  console.log(`[LoRa::Adapter] listening on ${port}`);
  console.log('[LoRa] Runtime Model: Claude Sonnet 4-6');
  console.log('[LoRa] Feature Flags:', featureFlags);
  if (apiChatRegistered) {
    runStartupHealthChecks().catch(() => {});
  }
});
