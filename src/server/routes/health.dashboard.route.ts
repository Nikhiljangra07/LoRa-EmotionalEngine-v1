/**
 * GET /api/health — Full service health dashboard.
 *
 * Pings all 4 backend services, shows today's activity stats,
 * active session details, feature flags, and memory system status.
 * Returns a mobile-friendly HTML page.
 *
 * No auth required. Read-only. No side-effects.
 */

import type { Express } from 'express';
import { getFalkorClient } from '../../emotion-core/memory-v1/db/falkorClient';
import { getChromaClient } from '../../emotion-core/memory-v1/db/chromaClient';
import { getLLMHealth } from '../llmTelemetry';
import { getSnapshot } from '../analytics/runtimeMetrics';
import { featureFlags } from '../../emotion-core/config/featureFlags';
import type { SessionEntry } from './chat.route';

// ---------------------------------------------------------------------------
// Service checks
// ---------------------------------------------------------------------------

interface ServiceStatus {
  name: string;
  status: 'ok' | 'down' | 'unknown';
  latencyMs: number;
  detail?: string;
}

async function checkFalkor(): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    const client = getFalkorClient();
    if (client.status === 'wait') await client.connect();
    const pong = await client.ping();
    return {
      name: 'Redis / FalkorDB',
      status: pong === 'PONG' ? 'ok' : 'down',
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      name: 'Redis / FalkorDB',
      status: 'down',
      latencyMs: Date.now() - start,
      detail: err instanceof Error ? err.message : 'ping failed',
    };
  }
}

async function checkChroma(): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    if (!process.env.LORA_CHROMA_URL) {
      return { name: 'ChromaDB', status: 'unknown', latencyMs: 0, detail: 'LORA_CHROMA_URL not set' };
    }
    await getChromaClient().heartbeat();
    return {
      name: 'ChromaDB',
      status: 'ok',
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      name: 'ChromaDB',
      status: 'down',
      latencyMs: Date.now() - start,
      detail: err instanceof Error ? err.message : 'heartbeat failed',
    };
  }
}

async function checkLoRaMaths(): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    const url = process.env.LORA_PERSPECTIVE_URL || 'http://localhost:8000';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${url}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    return {
      name: 'LoRaMaths',
      status: res.ok ? 'ok' : 'down',
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      name: 'LoRaMaths',
      status: 'down',
      latencyMs: Date.now() - start,
      detail: err instanceof Error ? err.message : 'health check failed',
    };
  }
}

function checkLLM(): ServiceStatus {
  const health = getLLMHealth();
  const lastSuccess = health.lastSuccess;
  let detail: string | undefined;
  let status: 'ok' | 'down' | 'unknown';
  if (lastSuccess) {
    const agoSec = Math.round((Date.now() - lastSuccess) / 1000);
    if (agoSec < 60) detail = `last success ${agoSec}s ago`;
    else if (agoSec < 3600) detail = `last success ${Math.round(agoSec / 60)}m ago`;
    else detail = `last success ${Math.round(agoSec / 3600)}h ago`;
    status = 'ok';
  } else {
    detail = 'idle — no calls since boot';
    status = 'unknown';
  }
  return {
    name: 'Claude LLM',
    status,
    latencyMs: 0,
    detail,
  };
}

// ---------------------------------------------------------------------------
// Active session details
// ---------------------------------------------------------------------------

interface ActiveSessionInfo {
  userId: string;
  messages: number;
  duration: string;
  tokens: number;
  deepPending: boolean;
}

function getActiveSessions(sessions: Map<string, SessionEntry>): ActiveSessionInfo[] {
  const now = Date.now();
  const result: ActiveSessionInfo[] = [];
  for (const [key, entry] of sessions.entries()) {
    const userId = key.split('::')[0] ?? 'unknown';
    const durSec = Math.round((now - entry.sessionStartedAt) / 1000);
    let duration: string;
    if (durSec < 60) duration = `${durSec}s`;
    else if (durSec < 3600) duration = `${Math.floor(durSec / 60)}m ${durSec % 60}s`;
    else duration = `${Math.floor(durSec / 3600)}h ${Math.floor((durSec % 3600) / 60)}m`;

    result.push({
      userId: userId.length > 12 ? userId.slice(0, 6) + '…' + userId.slice(-4) : userId,
      messages: entry.history.filter(t => t.role === 'user').length,
      duration,
      tokens: entry.tokensUsed,
      deepPending: entry.deepAnalysisPending ?? false,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Feature flags summary
// ---------------------------------------------------------------------------

interface FlagInfo { name: string; on: boolean }

function getKeyFlags(): FlagInfo[] {
  const flags = featureFlags as Record<string, unknown>;
  const keys = [
    ['memoryV2Enabled', 'Memory V2'],
    ['multiPerspectiveEnabled', 'Multi-Perspective'],
    ['perspectiveDeepMode', 'Deep Reasoning'],
    ['personaEnforcerEnabled', 'Persona Enforcer'],
    ['relationalRouterEnabled', 'Relational Router'],
    ['factAnchorEnabled', 'Fact Anchors'],
    ['bootstrapMemoryEnabled', 'Bootstrap Memory'],
  ] as const;
  return keys.map(([key, label]) => ({
    name: label,
    on: !!flags[key],
  }));
}

// ---------------------------------------------------------------------------
// HTML renderer
// ---------------------------------------------------------------------------

const serverStartTime = Date.now();

function uptimeString(): string {
  const sec = Math.round((Date.now() - serverStartTime) / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

function statusColor(s: 'ok' | 'down' | 'unknown'): string {
  if (s === 'ok') return '#22c55e';
  if (s === 'down') return '#ef4444';
  return '#a1a1aa';
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(1) + 'k';
  return (n / 1_000_000).toFixed(2) + 'M';
}

function renderHTML(
  services: ServiceStatus[],
  activeSessions: ActiveSessionInfo[],
  snapshot: { tokensToday: number; sessionsToday: number; avgSessionLength: number },
  flags: FlagInfo[],
): string {
  const anyDown = services.some(s => s.status === 'down');
  const overallColor = anyDown ? '#ef4444' : '#22c55e';
  const overallText = anyDown ? 'Degraded' : 'All Systems Operational';
  const now = new Date().toUTCString();

  const serviceRows = services.map(s => `
    <div class="card">
      <div class="row">
        <span class="dot" style="color:${statusColor(s.status)}">●</span>
        <span class="name">${s.name}</span>
        <span class="badge" style="color:${statusColor(s.status)}">${s.status.toUpperCase()}</span>
      </div>
      ${s.detail ? `<div class="sub">${s.detail}</div>` : ''}
      ${s.latencyMs > 0 ? `<div class="sub">${s.latencyMs}ms</div>` : ''}
    </div>
  `).join('');

  const avgLen = snapshot.avgSessionLength;
  let avgStr: string;
  if (avgLen === 0) avgStr = '—';
  else if (avgLen < 60) avgStr = `${avgLen}s`;
  else avgStr = `${Math.floor(avgLen / 60)}m ${avgLen % 60}s`;

  // Active sessions section
  let sessionsHTML = '';
  if (activeSessions.length > 0) {
    const sessionRows = activeSessions.map(s => `
      <div class="session-row">
        <span class="session-user">${s.userId}</span>
        <span class="session-stat">${s.messages} msgs</span>
        <span class="session-stat">${s.duration}</span>
        <span class="session-stat">${formatTokens(s.tokens)} tok</span>
        ${s.deepPending ? '<span class="deep-badge">DEEP</span>' : ''}
      </div>
    `).join('');
    sessionsHTML = `
      <div class="section-title">Active Sessions</div>
      <div class="card">${sessionRows}</div>
    `;
  }

  // Feature flags
  const flagRows = flags.map(f => `
    <div class="flag-row">
      <span class="flag-dot" style="color:${f.on ? '#22c55e' : '#52525b'}">●</span>
      <span class="flag-name">${f.name}</span>
      <span class="flag-val" style="color:${f.on ? '#22c55e' : '#52525b'}">${f.on ? 'ON' : 'OFF'}</span>
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LoRa — System Status</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0a0a;color:#e4e4e7;min-height:100vh;padding:20px 16px}
    .container{max-width:480px;margin:0 auto}
    .header{text-align:center;margin-bottom:24px}
    .logo{font-size:24px;font-weight:700;letter-spacing:-0.5px}
    .overall{font-size:15px;margin-top:6px;font-weight:500;color:${overallColor}}
    .meta{font-size:11px;color:#71717a;margin-top:3px}
    .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:0 0 20px}
    .stat{background:#18181b;border:1px solid #27272a;border-radius:10px;padding:12px 8px;text-align:center}
    .stat-val{font-size:18px;font-weight:700;color:#e4e4e7}
    .stat-lbl{font-size:10px;color:#71717a;margin-top:2px}
    .section-title{font-size:12px;font-weight:600;color:#71717a;text-transform:uppercase;letter-spacing:1px;margin:20px 0 8px;padding-left:4px}
    .card{background:#18181b;border:1px solid #27272a;border-radius:10px;padding:12px 14px;margin-bottom:8px}
    .row{display:flex;align-items:center;gap:8px}
    .dot{font-size:10px}
    .name{flex:1;font-size:13px;font-weight:500}
    .badge{font-size:11px;font-weight:600;letter-spacing:0.5px}
    .sub{font-size:11px;color:#71717a;margin-top:3px;padding-left:18px}
    .session-row{display:flex;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid #27272a}
    .session-row:last-child{border-bottom:none}
    .session-user{flex:1;font-size:12px;font-weight:500;font-family:'SF Mono',Menlo,monospace;color:#a1a1aa}
    .session-stat{font-size:11px;color:#71717a}
    .deep-badge{font-size:9px;font-weight:700;color:#a78bfa;background:#a78bfa22;padding:1px 5px;border-radius:4px}
    .flag-row{display:flex;align-items:center;gap:6px;padding:4px 0}
    .flag-dot{font-size:8px}
    .flag-name{flex:1;font-size:12px;color:#a1a1aa}
    .flag-val{font-size:11px;font-weight:600;letter-spacing:0.5px}
    .footer{text-align:center;margin-top:20px;font-size:11px;color:#52525b}
    .refresh-btn{display:block;margin:16px auto 0;background:#27272a;color:#a1a1aa;border:1px solid #3f3f46;border-radius:8px;padding:10px 24px;font-size:13px;font-weight:500;cursor:pointer;-webkit-tap-highlight-color:transparent}
    .refresh-btn:active{background:#3f3f46}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">LoRa</div>
      <div class="overall">${overallText}</div>
      <div class="meta">${now}</div>
    </div>

    <div class="stats">
      <div class="stat">
        <div class="stat-val">${activeSessions.length}</div>
        <div class="stat-lbl">Active Now</div>
      </div>
      <div class="stat">
        <div class="stat-val">${snapshot.sessionsToday}</div>
        <div class="stat-lbl">Today</div>
      </div>
      <div class="stat">
        <div class="stat-val">${formatTokens(snapshot.tokensToday)}</div>
        <div class="stat-lbl">Tokens</div>
      </div>
      <div class="stat">
        <div class="stat-val">${uptimeString()}</div>
        <div class="stat-lbl">Uptime</div>
      </div>
    </div>

    <div class="section-title">Services</div>
    ${serviceRows}

    ${sessionsHTML}

    <div class="section-title">Today's Activity</div>
    <div class="card">
      <div class="flag-row">
        <span class="flag-name">Sessions completed</span>
        <span class="flag-val" style="color:#e4e4e7">${snapshot.sessionsToday}</span>
      </div>
      <div class="flag-row">
        <span class="flag-name">Tokens consumed</span>
        <span class="flag-val" style="color:#e4e4e7">${formatTokens(snapshot.tokensToday)}</span>
      </div>
      <div class="flag-row">
        <span class="flag-name">Avg session length</span>
        <span class="flag-val" style="color:#e4e4e7">${avgStr}</span>
      </div>
    </div>

    <div class="section-title">Feature Flags</div>
    <div class="card">
      ${flagRows}
    </div>

    <button class="refresh-btn" onclick="location.reload()">Refresh</button>
    <div class="footer">asklora.io · health dashboard</div>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerHealthDashboardRoute(
  app: Express,
  engineSessions?: Map<string, SessionEntry>,
): void {
  app.get('/api/health', async (_req, res) => {
    try {
      const [falkor, chroma, loraMaths] = await Promise.all([
        checkFalkor(),
        checkChroma(),
        checkLoRaMaths(),
      ]);
      const llm = checkLLM();

      const services = [falkor, chroma, loraMaths, llm];
      const sessions = engineSessions ? getActiveSessions(engineSessions) : [];
      const snapshot = getSnapshot();
      const flags = getKeyFlags();

      // If client wants JSON, return JSON
      if (_req.headers.accept?.includes('application/json')) {
        const anyDown = services.some(s => s.status === 'down');
        res.json({
          status: anyDown ? 'degraded' : 'ok',
          uptime: uptimeString(),
          activeSessions: sessions.length,
          services,
          today: snapshot,
          flags,
          sessions,
        });
        return;
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(renderHTML(services, sessions, snapshot, flags));
    } catch {
      res.status(500).json({ status: 'error' });
    }
  });
}
