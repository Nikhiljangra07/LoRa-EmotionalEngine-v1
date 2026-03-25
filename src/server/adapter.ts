import '../bootstrap';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { validateEnv } from '../config/envValidator';
import { getLLMHealth } from './llmTelemetry';
import { registerChatRoute, runStartupHealthChecks } from './routes/chat.route';
import { registerSessionLifecycleRoute } from './routes/session.lifecycle.route';
import { registerOnboardingRoute } from './routes/onboarding.route';
import { featureFlags } from '../emotion-core/config/featureFlags';
import { registerDebugMemoryRoute } from './routes/debug.memory.route';
import { shutdownPosthog, trackSessionEnded } from './analytics/posthogClient';
import { sharedTierService } from './tier/TierService';
import { logSessionEnd } from './analytics/engagementLogger';
import { recordSessionEnd } from './analytics/runtimeMetrics';
import { MIN_MESSAGES_FOR_COMPLETION } from './session/constants';

const app = express();
const port = Number(process.env.PORT) || 3000;

const isProduction = process.env.NODE_ENV === 'production';

if (isProduction) {
  if (process.env.LORA_STRESS_TEST === '1') {
    console.error('[LoRa::ENV_CHECK] Stress-test mode cannot run in production.');
    process.exit(1);
  }
  process.env.LORA_STRESS_TEST = '';
  process.env.LORA_DEBUG = '';
  process.env.LORA_DEBUG_EIV = '';
  process.env.LORA_DEBUG_MODE = '';
  process.env.LORA_DEBUG_SESSION = '';
  process.env.LORA_DEBUG_PROMPT_SIGNALS = '';
  process.env.LORA_DEBUG_LLM_PAYLOAD = '';
}

const isDev = process.env.NODE_ENV === 'development';
const isDebugMode = process.env.LORA_DEBUG_MODE === '1';

if ((isDev || isDebugMode) && !isProduction) {
  registerDebugMemoryRoute(app);
}

const allowedOrigins = [
  'http://localhost:8080',
  'http://localhost:3000',
  'http://localhost:5173',
  'https://presence-whispers-production.up.railway.app',
];

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('CORS blocked'));
      }
    },
    credentials: true,
  })
);

app.use(express.json());

// Laura UI: serve public/ so GET / opens the chat page
app.use(express.static(path.join(__dirname, '..', '..', 'public')));

if (process.env.NODE_ENV !== 'test') {
  try {
    validateEnv();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[LoRa]', msg);
    process.exit(1);
  }
}

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

// ── Health: simple liveness for stress test and load balancers ─────────
app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

// ── Health: LLM readiness (read-only, no side-effects) ───────────────
app.get('/health/llm', (_req, res) => {
  res.json(getLLMHealth());
});

app.listen(port, () => {
  console.log(`LoRa server running on port ${port}`);
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

  if (process.env.POSTHOG_API_KEY) {
    console.log('[LoRa] PostHog analytics active');
  }
});

// Uses shared MIN_MESSAGES_FOR_COMPLETION from session/constants.ts

function drainSessions(): void {
  if (!engineSessions || engineSessions.size === 0) return;
  const now = Date.now();
  for (const [key, entry] of engineSessions.entries()) {
    const [userId, sessionId] = key.split('::');
    const messagesCount = entry.history.filter(t => t.role === 'user').length;
    const durationSeconds = Math.round((now - entry.sessionStartedAt) / 1000);
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
    trackSessionEnded(userId, sessionId, {
      messagesCount,
      durationSeconds,
      tokensUsed: entry.tokensUsed,
      reason: 'server_shutdown',
    });
    if (messagesCount >= MIN_MESSAGES_FOR_COMPLETION) {
      sharedTierService.recordSessionCompletionAsync(userId, sessionId).catch(() => {});
    }
  }
  engineSessions.clear();
  console.log('[LoRa::Shutdown] active sessions drained');
}

process.on('SIGTERM', () => { drainSessions(); shutdownPosthog().catch(() => {}); });
process.on('SIGINT', () => { drainSessions(); shutdownPosthog().catch(() => {}); });
