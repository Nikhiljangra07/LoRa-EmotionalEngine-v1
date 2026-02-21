import '../bootstrap';
import express from 'express';
import cors from 'cors';
import { InputProcessor } from '../emotion-core/processors/InputProcessor';
import { SessionManager } from './session/SessionManager';
import { getLLMHealth } from './llmTelemetry';

const app = express();
const port = 3000;
const debugEnabled = process.env.LORA_DEBUG === '1';

app.use(
  cors({
    origin: 'http://localhost:8080',
    methods: ['POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  })
);

app.use(express.json());

// ── Session layer ──────────────────────────────────────────────────
// The frontend sends no session identifier, so all HTTP requests share
// a single global engine instance.  This is intentional: it mirrors
// the CLI's single-engine behaviour and preserves emotional continuity
// (ETV, momentum, cooldown, message count) across requests.
// The session is ephemeral — lost on process restart, no persistence.
const sessionManager = new SessionManager();
const DEFAULT_SESSION_ID = 'default-http-session';

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
    const engine = sessionManager.getEngine(DEFAULT_SESSION_ID);
    const { analyzerOutputs, signalPacket } =
      InputProcessor.process(message);

    const result = await engine.processMessage(
      analyzerOutputs,
      undefined,
      false,
      {},
      undefined,
      signalPacket
    );

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
});
