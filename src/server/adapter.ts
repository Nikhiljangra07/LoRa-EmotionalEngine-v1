import '../bootstrap';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { getLLMHealth } from './llmTelemetry';
import { registerChatRoute, runStartupHealthChecks } from './routes/chat.route';
import { registerSessionLifecycleRoute } from './routes/session.lifecycle.route';
import { registerOnboardingRoute } from './routes/onboarding.route';
import { featureFlags } from '../emotion-core/config/featureFlags';
import { registerDebugMemoryRoute } from './routes/debug.memory.route';

const app = express();
const port = 3000;

const isDev = process.env.NODE_ENV === 'development';
const isDebugMode = process.env.LORA_DEBUG_MODE === '1';

if (isDev || isDebugMode) {
  registerDebugMemoryRoute(app);
}

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
  
  if (process.env.NODE_ENV === 'development') {
    console.log('[LoRa Runtime Profile]');
    console.log('mode: development');
    console.log('');
    console.log('memoryServiceEnabled: true');
    console.log('factAnchorEnabled: true');
    console.log('bootstrapMemoryEnabled: true');
    console.log('etvV1Enabled: true');
    console.log('personaEnforcerEnabled: true');
    console.log('responseShapeContractEnabled: true');
    console.log('relationalRouterEnabled: true');
    console.log('narrativeStateEngineEnabled: true');
    console.log('');
  } else {
    console.log('[LoRa] Feature Flags:', featureFlags);
  }

  if (apiChatRegistered) {
    runStartupHealthChecks().catch(() => {});
  }
});
