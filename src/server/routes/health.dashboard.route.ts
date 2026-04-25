/**
 * GET /api/health — Service health dashboard.
 *
 * Two response modes:
 *   1. Public (default) — only the four service statuses (Redis, Chroma,
 *      LoRaMaths, LLM) plus an overall status string. No session data,
 *      no feature flags, no system resource numbers. Safe to expose to
 *      load balancers, uptime monitors, or curious browsers.
 *   2. Authorized — full dashboard (active sessions, flags, system info,
 *      operational counters, today's activity). Gated behind the
 *      HEALTH_DASHBOARD_TOKEN env var; supply it via `?token=…` query or
 *      `X-Health-Token` request header.
 *
 * If HEALTH_DASHBOARD_TOKEN is unset, the route is locked to public mode
 * regardless of what the caller sends — secure default. A startup warning
 * is logged so the operator knows monitoring needs the token configured.
 *
 * Read-only. No side-effects.
 */

import type { Express, Request } from 'express';
import { timingSafeEqual } from 'crypto';
import { getFalkorClient } from '../../emotion-core/memory-v1/db/falkorClient';
import { getChromaClient } from '../../emotion-core/memory-v1/db/chromaClient';
import { getLLMHealth } from '../llmTelemetry';
import { getSnapshot } from '../analytics/runtimeMetrics';
import { getCounters } from '../analytics/operationalCounters';
import { featureFlags } from '../../emotion-core/config/featureFlags';
import type { SessionEntry } from './chat.route';

// ---------------------------------------------------------------------------
// Token gate — protects the full dashboard from public exposure
// ---------------------------------------------------------------------------

function isAuthorizedHealthRequest(req: Request): boolean {
  // Defensive .trim() — Railway / copy-paste commonly leaves invisible
  // trailing newlines or spaces in env var values that silently break
  // exact-byte comparisons.
  const expected = (process.env.HEALTH_DASHBOARD_TOKEN ?? '').trim();
  if (expected.length === 0) return false;

  let provided: string;
  const qToken = req.query.token;
  if (typeof qToken === 'string' && qToken.length > 0) {
    provided = qToken.trim();
  } else {
    const headerToken = req.headers['x-health-token'];
    provided = typeof headerToken === 'string' ? headerToken.trim() : '';
  }
  if (provided.length === 0) return false;

  // Constant-time compare; require equal lengths to use timingSafeEqual.
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public minimal HTML — service status only, no sensitive fields
// ---------------------------------------------------------------------------

function renderMinimalHTML(services: ServiceStatus[]): string {
  const anyDown = services.some(s => s.status === 'down');
  const overallColor = anyDown ? '#ef4444' : '#22c55e';
  const overallText = anyDown ? 'Degraded' : 'Operational';
  const rows = services
    .map(s => {
      const color = statusColor(s.status);
      const label = s.status === 'ok' ? 'OK' : s.status === 'down' ? 'DOWN' : 'UNKNOWN';
      return `<div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #27272a"><span>${s.name}</span><span style="color:${color};font-weight:600">${label}</span></div>`;
    })
    .join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LoRa — Health</title><style>body{background:#09090b;color:#e4e4e7;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;margin:0;padding:24px;max-width:520px;margin:0 auto}h1{font-size:18px;margin:0 0 4px}p.sub{color:#a1a1aa;font-size:13px;margin:0 0 24px}.card{background:#18181b;border:1px solid #27272a;border-radius:8px;padding:16px}.dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:${overallColor};margin-right:8px;vertical-align:middle}</style></head><body><h1><span class="dot"></span>LoRa — ${overallText}</h1><p class="sub">Public status. Full dashboard requires a token.</p><div class="card">${rows}</div></body></html>`;
}

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
// Feature flags
// ---------------------------------------------------------------------------

interface FlagInfo { name: string; on: boolean }

function getKeyFlags(): FlagInfo[] {
  const flags = featureFlags as Record<string, unknown>;
  const keys: [string, string][] = [
    ['memoryV2Enabled', 'Memory V2'],
    ['multiPerspectiveEnabled', 'Multi-Perspective'],
    ['perspectiveDeepModeEnabled', 'Deep Reasoning'],
    ['personaEnforcerEnabled', 'Persona Enforcer'],
    ['relationalRouterEnabled', 'Relational Router'],
    ['factAnchorEnabled', 'Fact Anchors'],
    ['bootstrapMemoryEnabled', 'Bootstrap Memory'],
    ['etvV1Enabled', 'ETV Engine'],
    ['narrativeStateEngineEnabled', 'Narrative State'],
    ['memoryServiceEnabled', 'Memory V1 Service'],
  ];
  return keys.map(([key, label]) => ({
    name: label,
    on: !!flags[key],
  }));
}

// ---------------------------------------------------------------------------
// System info
// ---------------------------------------------------------------------------

interface SystemInfo {
  nodeVersion: string;
  heapUsedMB: number;
  heapTotalMB: number;
  rssMB: number;
  env: string;
  llmModel: string;
  llmTimeout: string;
  perspectiveUrl: string;
  chromaUrl: string;
  falkorUrl: string;
}

function getSystemInfo(): SystemInfo {
  const mem = process.memoryUsage();
  return {
    nodeVersion: process.version,
    heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
    rssMB: Math.round(mem.rss / 1024 / 1024),
    env: process.env.NODE_ENV || 'unknown',
    llmModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    // Default must match EngineOrchestrator.llmTimeoutMs (60000ms). Was '18000'
    // here while the runtime defaulted to 60000, making the dashboard misreport
    // the actual abort threshold.
    llmTimeout: `${process.env.LORA_LLM_TIMEOUT_MS || '60000'}ms`,
    perspectiveUrl: process.env.LORA_PERSPECTIVE_URL ? 'configured' : 'not set',
    chromaUrl: process.env.LORA_CHROMA_URL ? 'configured' : 'not set',
    falkorUrl: process.env.LORA_FALKOR_URL ? 'configured' : 'not set',
  };
}

// ---------------------------------------------------------------------------
// Time formatting — Vancouver (America/Vancouver)
// ---------------------------------------------------------------------------

const serverStartTime = Date.now();

function vancouverTime(): string {
  return new Date().toLocaleString('en-US', {
    timeZone: 'America/Vancouver',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function uptimeString(): string {
  const sec = Math.round((Date.now() - serverStartTime) / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h < 24) return `${h}h ${m}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function formatAgo(ts: number): string {
  const sec = Math.round((Date.now() - ts) / 1000);
  if (sec < 10) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m ago`;
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

// ---------------------------------------------------------------------------
// HTML renderer
// ---------------------------------------------------------------------------

function renderHTML(
  services: ServiceStatus[],
  activeSessions: ActiveSessionInfo[],
  snapshot: { tokensToday: number; sessionsToday: number; avgSessionLength: number },
  flags: FlagInfo[],
  system: SystemInfo,
  counters: Record<string, number>,
): string {
  const anyDown = services.some(s => s.status === 'down');
  const overallColor = anyDown ? '#ef4444' : '#22c55e';
  const overallText = anyDown ? 'Degraded' : 'All Systems Operational';
  const timeStr = vancouverTime();

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

  // Active sessions
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
  } else {
    sessionsHTML = `
      <div class="section-title">Active Sessions</div>
      <div class="card"><div class="empty">No active sessions</div></div>
    `;
  }

  // Feature flags
  const flagRows = flags.map(f => `
    <div class="kv-row">
      <span class="kv-dot" style="color:${f.on ? '#22c55e' : '#52525b'}">●</span>
      <span class="kv-key">${f.name}</span>
      <span class="kv-val" style="color:${f.on ? '#22c55e' : '#52525b'}">${f.on ? 'ON' : 'OFF'}</span>
    </div>
  `).join('');

  // Memory bar — show RSS out of 512 MB (Railway default). This is the real usage metric.
  const rssLimit = 512;
  const rssPct = Math.round((system.rssMB / rssLimit) * 100);
  const rssColor = rssPct > 80 ? '#ef4444' : rssPct > 50 ? '#eab308' : '#22c55e';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>LoRa — System Status</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#09090b;color:#e4e4e7;min-height:100vh;padding:20px 16px;-webkit-font-smoothing:antialiased}
    .container{max-width:480px;margin:0 auto}
    .header{text-align:center;margin-bottom:20px}
    .logo{font-size:26px;font-weight:700;letter-spacing:-0.5px}
    .overall{font-size:14px;margin-top:6px;font-weight:600;color:${overallColor}}
    .meta{font-size:11px;color:#71717a;margin-top:3px}
    .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:0 0 16px}
    .stat{background:#18181b;border:1px solid #27272a;border-radius:10px;padding:10px 6px;text-align:center}
    .stat-val{font-size:17px;font-weight:700;color:#e4e4e7}
    .stat-lbl{font-size:9px;color:#71717a;margin-top:2px;text-transform:uppercase;letter-spacing:0.5px}
    .section-title{font-size:11px;font-weight:600;color:#52525b;text-transform:uppercase;letter-spacing:1px;margin:18px 0 6px;padding-left:4px}
    .card{background:#18181b;border:1px solid #27272a;border-radius:10px;padding:10px 12px;margin-bottom:6px}
    .row{display:flex;align-items:center;gap:8px}
    .dot{font-size:10px}
    .name{flex:1;font-size:13px;font-weight:500}
    .badge{font-size:11px;font-weight:600;letter-spacing:0.5px}
    .sub{font-size:11px;color:#71717a;margin-top:3px;padding-left:18px}
    .session-row{display:flex;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid #1e1e22}
    .session-row:last-child{border-bottom:none}
    .session-user{flex:1;font-size:11px;font-weight:500;font-family:'SF Mono',Menlo,monospace;color:#a1a1aa}
    .session-stat{font-size:10px;color:#71717a}
    .deep-badge{font-size:9px;font-weight:700;color:#a78bfa;background:#a78bfa18;padding:1px 5px;border-radius:4px}
    .empty{font-size:12px;color:#3f3f46;text-align:center;padding:6px 0}
    .kv-row{display:flex;align-items:center;gap:6px;padding:3px 0}
    .kv-dot{font-size:8px}
    .kv-key{flex:1;font-size:12px;color:#a1a1aa}
    .kv-val{font-size:11px;font-weight:600;letter-spacing:0.3px}
    .bar-outer{height:6px;background:#27272a;border-radius:3px;margin-top:4px;overflow:hidden}
    .bar-inner{height:100%;border-radius:3px;transition:width 0.3s}
    .sys-row{display:flex;align-items:center;padding:3px 0}
    .sys-key{flex:1;font-size:11px;color:#71717a}
    .sys-val{font-size:11px;color:#a1a1aa;font-family:'SF Mono',Menlo,monospace}
    .footer{text-align:center;margin-top:16px;font-size:10px;color:#3f3f46}
    .refresh-btn{display:block;margin:14px auto 0;background:#18181b;color:#a1a1aa;border:1px solid #27272a;border-radius:8px;padding:10px 28px;font-size:13px;font-weight:500;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:background 0.15s}
    .refresh-btn:active{background:#27272a}
    .auto-badge{display:inline-block;font-size:9px;color:#22c55e;background:#22c55e18;padding:1px 6px;border-radius:4px;margin-left:6px;font-weight:600}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">LoRa</div>
      <div class="overall">${overallText}</div>
      <div class="meta">${timeStr} (Vancouver)<span class="auto-badge" id="auto-label" style="display:none">AUTO</span></div>
      <div class="meta">${counters.last_activity_ts > 0 ? 'Last activity: ' + formatAgo(counters.last_activity_ts) : 'No activity since boot'}</div>
    </div>

    <div class="stats">
      <div class="stat">
        <div class="stat-val">${activeSessions.length}</div>
        <div class="stat-lbl">Live Now</div>
      </div>
      <div class="stat">
        <div class="stat-val">${counters.unique_users ?? 0}</div>
        <div class="stat-lbl">Users Today</div>
      </div>
      <div class="stat">
        <div class="stat-val">${counters.messages_processed ?? 0}</div>
        <div class="stat-lbl">Messages</div>
      </div>
      <div class="stat">
        <div class="stat-val">${uptimeString()}</div>
        <div class="stat-lbl">Uptime</div>
      </div>
    </div>

    <div class="section-title">Users</div>
    <div class="card">
      <div class="kv-row">
        <span class="kv-key">Active right now</span>
        <span class="kv-val" style="color:#22c55e">${activeSessions.length}</span>
      </div>
      <div class="kv-row">
        <span class="kv-key">Total users today</span>
        <span class="kv-val" style="color:#e4e4e7">${counters.unique_users ?? 0}</span>
      </div>
      <div class="kv-row">
        <span class="kv-key">Signed-in users</span>
        <span class="kv-val" style="color:#e4e4e7">${counters.auth_users ?? 0}</span>
      </div>
      <div class="kv-row">
        <span class="kv-key">Guest users</span>
        <span class="kv-val" style="color:#e4e4e7">${counters.guest_users ?? 0}</span>
      </div>
      <div class="kv-row">
        <span class="kv-key">Peak concurrent sessions</span>
        <span class="kv-val" style="color:#e4e4e7">${counters.peak_concurrent ?? 0}</span>
      </div>
      <div class="kv-row">
        <span class="kv-key">Avg messages per user</span>
        <span class="kv-val" style="color:#e4e4e7">${(counters.unique_users ?? 0) > 0 ? ((counters.messages_processed ?? 0) / (counters.unique_users ?? 1)).toFixed(1) : '—'}</span>
      </div>
      <div class="kv-row">
        <span class="kv-key">Deep reasoning used</span>
        <span class="kv-val" style="color:#a78bfa">${counters.deep_reasoning_completed ?? 0}</span>
      </div>
    </div>

    <div class="section-title">Services</div>
    ${serviceRows}

    ${sessionsHTML}

    <div class="section-title">Today's Activity</div>
    <div class="card">
      <div class="kv-row">
        <span class="kv-key">Messages processed</span>
        <span class="kv-val" style="color:#e4e4e7">${counters.messages_processed ?? 0}</span>
      </div>
      <div class="kv-row">
        <span class="kv-key">Relational (greeting/farewell)</span>
        <span class="kv-val" style="color:#e4e4e7">${counters.messages_relational ?? 0}</span>
      </div>
      <div class="kv-row">
        <span class="kv-key">Sessions completed</span>
        <span class="kv-val" style="color:#e4e4e7">${snapshot.sessionsToday}</span>
      </div>
      <div class="kv-row">
        <span class="kv-key">Session caps hit (25 msgs)</span>
        <span class="kv-val" style="color:#e4e4e7">${counters.session_cap_hit ?? 0}</span>
      </div>
      <div class="kv-row">
        <span class="kv-key">Unique users</span>
        <span class="kv-val" style="color:#e4e4e7">${counters.unique_users ?? 0}</span>
      </div>
      <div class="kv-row">
        <span class="kv-key">Tokens consumed</span>
        <span class="kv-val" style="color:#e4e4e7">${formatTokens(snapshot.tokensToday)}</span>
      </div>
      <div class="kv-row">
        <span class="kv-key">Avg session length</span>
        <span class="kv-val" style="color:#e4e4e7">${avgStr}</span>
      </div>
    </div>

    <div class="section-title">Response Time</div>
    <div class="card">
      <div class="kv-row">
        <span class="kv-key">Average</span>
        <span class="kv-val" style="color:${(counters.avg_response_ms ?? 0) > 12000 ? '#ef4444' : (counters.avg_response_ms ?? 0) > 6000 ? '#eab308' : '#22c55e'}">${(counters.avg_response_ms ?? 0) > 0 ? ((counters.avg_response_ms ?? 0) / 1000).toFixed(1) + 's' : '—'}</span>
      </div>
      <div class="kv-row">
        <span class="kv-key">P95 (slowest 5%)</span>
        <span class="kv-val" style="color:${(counters.p95_response_ms ?? 0) > 15000 ? '#ef4444' : (counters.p95_response_ms ?? 0) > 8000 ? '#eab308' : '#22c55e'}">${(counters.p95_response_ms ?? 0) > 0 ? ((counters.p95_response_ms ?? 0) / 1000).toFixed(1) + 's' : '—'}</span>
      </div>
      <div class="kv-row">
        <span class="kv-key">Fastest</span>
        <span class="kv-val" style="color:#e4e4e7">${(counters.min_response_ms ?? 0) > 0 ? ((counters.min_response_ms ?? 0) / 1000).toFixed(1) + 's' : '—'}</span>
      </div>
      <div class="kv-row">
        <span class="kv-key">Slowest</span>
        <span class="kv-val" style="color:#e4e4e7">${(counters.max_response_ms ?? 0) > 0 ? ((counters.max_response_ms ?? 0) / 1000).toFixed(1) + 's' : '—'}</span>
      </div>
    </div>

    <div class="section-title">LLM Health</div>
    <div class="card">
      <div class="kv-row">
        <span class="kv-key">Successful calls</span>
        <span class="kv-val" style="color:#22c55e">${counters.llm_success ?? 0}</span>
      </div>
      <div class="kv-row">
        <span class="kv-key">Fallbacks (cooldown)</span>
        <span class="kv-val" style="color:${(counters.llm_fallback_cooldown ?? 0) > 0 ? '#ef4444' : '#e4e4e7'}">${counters.llm_fallback_cooldown ?? 0}</span>
      </div>
      <div class="kv-row">
        <span class="kv-key">Fallbacks (retry exhausted)</span>
        <span class="kv-val" style="color:${(counters.llm_fallback_retry_exhausted ?? 0) > 0 ? '#ef4444' : '#e4e4e7'}">${counters.llm_fallback_retry_exhausted ?? 0}</span>
      </div>
      <div class="kv-row">
        <span class="kv-key">Cooldown activations</span>
        <span class="kv-val" style="color:${(counters.llm_cooldown_activated ?? 0) > 0 ? '#eab308' : '#e4e4e7'}">${counters.llm_cooldown_activated ?? 0}</span>
      </div>
    </div>

    <div class="section-title">Perspective Engine</div>
    <div class="card">
      <div class="kv-row">
        <span class="kv-key">Success</span>
        <span class="kv-val" style="color:#22c55e">${counters.perspective_success ?? 0}</span>
      </div>
      <div class="kv-row">
        <span class="kv-key">Failures</span>
        <span class="kv-val" style="color:${(counters.perspective_failure ?? 0) > 0 ? '#ef4444' : '#e4e4e7'}">${counters.perspective_failure ?? 0}</span>
      </div>
      <div class="kv-row">
        <span class="kv-key">Timeouts</span>
        <span class="kv-val" style="color:${(counters.perspective_timeout ?? 0) > 0 ? '#eab308' : '#e4e4e7'}">${counters.perspective_timeout ?? 0}</span>
      </div>
    </div>

    <div class="section-title">Safety &amp; Quality</div>
    <div class="card">
      <div class="kv-row">
        <span class="kv-key">Prompt injection attempts</span>
        <span class="kv-val" style="color:${(counters.sanitizer_triggered ?? 0) > 0 ? '#ef4444' : '#e4e4e7'}">${counters.sanitizer_triggered ?? 0}</span>
      </div>
      <div class="kv-row">
        <span class="kv-key">Identity: opener stripped</span>
        <span class="kv-val" style="color:${(counters.identity_opener_stripped ?? 0) > 0 ? '#eab308' : '#e4e4e7'}">${counters.identity_opener_stripped ?? 0}</span>
      </div>
      <div class="kv-row">
        <span class="kv-key">Identity: semantic rewrite</span>
        <span class="kv-val" style="color:${(counters.identity_semantic_rewrite ?? 0) > 0 ? '#eab308' : '#e4e4e7'}">${counters.identity_semantic_rewrite ?? 0}</span>
      </div>
      <div class="kv-row">
        <span class="kv-key">Identity: question rewrite</span>
        <span class="kv-val" style="color:${(counters.identity_question_rewrite ?? 0) > 0 ? '#eab308' : '#e4e4e7'}">${counters.identity_question_rewrite ?? 0}</span>
      </div>
      <div class="kv-row">
        <span class="kv-key">Rate limited (user)</span>
        <span class="kv-val" style="color:${(counters.rate_limit_user ?? 0) > 0 ? '#ef4444' : '#e4e4e7'}">${counters.rate_limit_user ?? 0}</span>
      </div>
      <div class="kv-row">
        <span class="kv-key">Rate limited (IP)</span>
        <span class="kv-val" style="color:${(counters.rate_limit_ip ?? 0) > 0 ? '#ef4444' : '#e4e4e7'}">${counters.rate_limit_ip ?? 0}</span>
      </div>
      <div class="kv-row">
        <span class="kv-key">Server errors (500)</span>
        <span class="kv-val" style="color:${(counters.error_500 ?? 0) > 0 ? '#ef4444' : '#e4e4e7'}">${counters.error_500 ?? 0}</span>
      </div>
    </div>

    <div class="section-title">Memory V2</div>
    <div class="card">
      <div class="kv-row">
        <span class="kv-key">Consolidations succeeded</span>
        <span class="kv-val" style="color:#22c55e">${counters.memory_v2_consolidation_success ?? 0}</span>
      </div>
      <div class="kv-row">
        <span class="kv-key">Consolidations failed</span>
        <span class="kv-val" style="color:${(counters.memory_v2_consolidation_failure ?? 0) > 0 ? '#ef4444' : '#e4e4e7'}">${counters.memory_v2_consolidation_failure ?? 0}</span>
      </div>
    </div>

    <div class="section-title">Memory &amp; System</div>
    <div class="card">
      <div class="sys-row">
        <span class="sys-key">Memory (RSS)</span>
        <span class="sys-val">${system.rssMB} / ${rssLimit} MB (${rssPct}%)</span>
      </div>
      <div class="bar-outer">
        <div class="bar-inner" style="width:${rssPct}%;background:${rssColor}"></div>
      </div>
      <div class="sys-row" style="margin-top:6px">
        <span class="sys-key">JS Heap</span>
        <span class="sys-val">${system.heapUsedMB} / ${system.heapTotalMB} MB</span>
      </div>
      <div class="sys-row">
        <span class="sys-key">Node</span>
        <span class="sys-val">${system.nodeVersion}</span>
      </div>
      <div class="sys-row">
        <span class="sys-key">Environment</span>
        <span class="sys-val">${system.env}</span>
      </div>
      <div class="sys-row">
        <span class="sys-key">LLM</span>
        <span class="sys-val">${system.llmModel}</span>
      </div>
      <div class="sys-row">
        <span class="sys-key">LLM Timeout</span>
        <span class="sys-val">${system.llmTimeout}</span>
      </div>
    </div>

    <div class="section-title">Connections</div>
    <div class="card">
      <div class="sys-row">
        <span class="sys-key">Falkor URL</span>
        <span class="sys-val">${system.falkorUrl}</span>
      </div>
      <div class="sys-row">
        <span class="sys-key">Chroma URL</span>
        <span class="sys-val">${system.chromaUrl}</span>
      </div>
      <div class="sys-row">
        <span class="sys-key">LoRaMaths URL</span>
        <span class="sys-val">${system.perspectiveUrl}</span>
      </div>
    </div>

    <div class="section-title">Feature Flags</div>
    <div class="card">
      ${flagRows}
    </div>

    <button class="refresh-btn" onclick="location.reload()">Refresh</button>
    <button class="refresh-btn" id="auto-btn" onclick="toggleAuto()" style="margin-top:6px;font-size:11px;padding:8px 20px">Auto-refresh: OFF</button>
    <div class="footer">asklora.io · health dashboard</div>
  </div>

  <script>
    let autoInterval = null;
    function toggleAuto() {
      const btn = document.getElementById('auto-btn');
      const label = document.getElementById('auto-label');
      if (autoInterval) {
        clearInterval(autoInterval);
        autoInterval = null;
        btn.textContent = 'Auto-refresh: OFF';
        label.style.display = 'none';
      } else {
        autoInterval = setInterval(() => location.reload(), 30000);
        btn.textContent = 'Auto-refresh: ON (30s)';
        label.style.display = 'inline-block';
      }
    }
  </script>
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
  const trimmedToken = (process.env.HEALTH_DASHBOARD_TOKEN ?? '').trim();
  if (trimmedToken.length === 0) {
    console.warn(
      '[LoRa::Health] HEALTH_DASHBOARD_TOKEN is not set — /api/health is locked to public mode (service status only). Set it on Railway and pass via ?token=… or X-Health-Token to view the full dashboard.',
    );
  } else {
    // Log length only (NOT the value) so the operator can verify the env
    // var matches their expected length. e.g. `openssl rand -hex 32` → 64.
    // If this prints something other than the expected length, the value
    // on Railway has whitespace, was truncated, or was mistyped.
    console.log(`[LoRa::Health] Token gate active (token length=${trimmedToken.length}).`);
  }

  app.get('/api/health', async (req, res) => {
    try {
      const [falkor, chroma, loraMaths] = await Promise.all([
        checkFalkor(),
        checkChroma(),
        checkLoRaMaths(),
      ]);
      const llm = checkLLM();
      const services = [falkor, chroma, loraMaths, llm];
      const anyDown = services.some(s => s.status === 'down');
      const wantsJson = req.headers.accept?.includes('application/json');
      const authorized = isAuthorizedHealthRequest(req);

      // Public path — services + status only. No sessions, flags, system,
      // counters, or activity stats. Safe for load balancers, uptime
      // monitors, and unauthenticated browsers.
      if (!authorized) {
        if (wantsJson) {
          res.json({
            status: anyDown ? 'degraded' : 'ok',
            services: services.map(s => ({
              name: s.name,
              status: s.status,
              latencyMs: s.latencyMs,
            })),
          });
          return;
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(renderMinimalHTML(services));
        return;
      }

      // Authorized path — full dashboard.
      const sessions = engineSessions ? getActiveSessions(engineSessions) : [];
      const snapshot = getSnapshot();
      const flags = getKeyFlags();
      const system = getSystemInfo();
      const counters = getCounters();

      if (wantsJson) {
        res.json({
          status: anyDown ? 'degraded' : 'ok',
          uptime: uptimeString(),
          activeSessions: sessions.length,
          services,
          today: snapshot,
          flags,
          sessions,
          system,
          counters,
        });
        return;
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(renderHTML(services, sessions, snapshot, flags, system, counters));
    } catch {
      res.status(500).json({ status: 'error' });
    }
  });
}
