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
import { supabaseAuthMiddleware } from './auth/supabaseAuth';
import { registerDebugMemoryRoute } from './routes/debug.memory.route';
import { registerHealthDashboardRoute } from './routes/health.dashboard.route';
import { shutdownPosthog, trackSessionEnded } from './analytics/posthogClient';
import { sharedTierService } from './tier/TierService';
import { logSessionEnd } from './analytics/engagementLogger';
import { recordSessionEnd } from './analytics/runtimeMetrics';
import { MIN_MESSAGES_FOR_COMPLETION } from './session/constants';
import { getSessionFinalizer } from './routes/chat.route';

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
  'https://asklora.io',
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

// ── Security headers ──
app.use((_req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  next();
});

app.use(express.json({ limit: '25mb' })); // Raised for base64 image/document attachments

// ── Supabase JWT auth (after JSON parser, before routes) ──
app.use(supabaseAuthMiddleware);

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
registerHealthDashboardRoute(app, engineSessions);

// ── Health: simple liveness for stress test and load balancers ─────────
app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

// ── Health: LLM readiness (read-only, no side-effects) ───────────────
app.get('/health/llm', (_req, res) => {
  res.json(getLLMHealth());
});

// ── 404 handler: catch-all for unknown routes ────────────────────────
// Must be registered AFTER all real routes. Returns 404 for anything
// that isn't a known API endpoint, health check, or static asset.
// Prevents vulnerability scanners from seeing 200 on /.env, /.git, etc.
app.use((_req, res) => {
  // API routes that don't exist → JSON 404
  if (_req.path.startsWith('/api/') || _req.path.startsWith('/debug/')) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  // Everything else → plain 404
  res.status(404).send('Not Found');
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

  // Use the shared finalizer so V2 consolidation fires on shutdown.
  // Falls back to lightweight drain if finalizer not available.
  const finalizer = getSessionFinalizer();

  const now = Date.now();
  for (const [key, entry] of engineSessions.entries()) {
    const [userId, sessionId] = key.split('::');

    if (finalizer && userId && sessionId) {
      // Full path: tier + PostHog + V2 consolidation (fire-and-forget)
      finalizer(userId, sessionId, entry, 'server_shutdown').catch(() => {});
    } else {
      // Fallback: lightweight drain (no V2)
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
  }
  engineSessions.clear();
  console.log('[LoRa::Shutdown] active sessions drained');
}

process.on('SIGTERM', () => { drainSessions(); shutdownPosthog().catch(() => {}); });
process.on('SIGINT', () => { drainSessions(); shutdownPosthog().catch(() => {}); });
