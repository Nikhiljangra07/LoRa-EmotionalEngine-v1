import '../bootstrap';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { InputProcessor } from '../emotion-core/processors/InputProcessor';
import { SessionManager } from './session/SessionManager';
import { getLLMHealth } from './llmTelemetry';
import { debugEnabled } from '../emotion-core/debug/debugGate';
import { registerChatRoute, runStartupHealthChecks } from './routes/chat.route';

const app = express();
const PORT = Number(process.env.PORT) || 8080;
const HOST = '0.0.0.0';

const allowedOrigins = [
  'http://localhost:5173',
  'https://presence-whispers-production.up.railway.app',
];

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/session/start', (_req, res) => {
  const sessionId = 'sess_' + Math.random().toString(36).substring(2);
  res.json({ sessionId });
});

app.post('/api/session/terminate', (req, res) => {
  res.json({ success: true });
});

// ── Session layer ──────────────────────────────────────────────────
// Shared engine instance for fallback /api/chat and legacy /chat.
const sessionManager = new SessionManager();
const DEFAULT_SESSION_ID = 'default-http-session';

let apiChatRegistered = false;
try {
  registerChatRoute(app);
  apiChatRegistered = true;
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn('[LoRa::Adapter] /api/chat not registered:', msg);
}

if (!apiChatRegistered) {
  app.post('/api/chat', async (req, res) => {
    const message = typeof req.body?.message === 'string' ? req.body.message : '';
    const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : DEFAULT_SESSION_ID;

    if (!message || !message.trim()) {
      return res.json({ reply: '' });
    }

    try {
      const engine = sessionManager.getEngine(sessionId);
      const { analyzerOutputs, signalPacket } = InputProcessor.process(message.trim());
      const result = await engine.processMessage(
        analyzerOutputs,
        undefined,
        false,
        {},
        undefined,
        signalPacket
      );

      res.json({
        reply: result.llmOutput ?? '',
      });
    } catch (error) {
      console.error('LoRa runtime error:', error);
      res.json({ reply: 'LoRa encountered an internal error.' });
    }
  });
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

const publicPath = path.join(__dirname, '..', '..', 'public');
app.use(express.static(publicPath));

app.listen(PORT, HOST, () => {
  console.log(`[LoRa] Server running on ${HOST}:${PORT}`);
  if (apiChatRegistered) {
    runStartupHealthChecks().catch(() => {});
  }
});
