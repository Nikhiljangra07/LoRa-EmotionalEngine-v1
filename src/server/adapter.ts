import '../bootstrap';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { getLLMHealth } from './llmTelemetry';
import { registerChatRoute, runStartupHealthChecks } from './routes/chat.route';
import { registerSessionLifecycleRoute } from './routes/session.lifecycle.route';
import { registerOnboardingRoute } from './routes/onboarding.route';
import { featureFlags } from '../emotion-core/config/featureFlags';

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
let engineSessions: Map<string, import('./routes/chat.route').SessionEntry> | undefined;
try {
  engineSessions = registerChatRoute(app);
  apiChatRegistered = true;
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn('[LoRa::Adapter] /api/chat not registered:', msg);
  app.post('/api/chat', (_req, res) => {
    res.status(503).json({ error: 'service_unavailable', details: msg });
  });
}
registerOnboardingRoute(app);
registerSessionLifecycleRoute(app, engineSessions);

// ── Health: LLM readiness (read-only, no side-effects) ───────────────
app.get('/health/llm', (_req, res) => {
  res.json(getLLMHealth());
});

app.listen(port, () => {
  console.log(`[LoRa::Adapter] listening on ${port}`);
  console.log('[LoRa] Runtime Model: Claude Sonnet 4-6');
  console.log('[LoRa] Feature Flags:', featureFlags);
  if (apiChatRegistered) {
    runStartupHealthChecks().catch(() => {});
  }
});
