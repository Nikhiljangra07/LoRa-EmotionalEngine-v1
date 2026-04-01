/**
 * GET /api/health — Full service health dashboard.
 *
 * Pings all 4 backend services (Redis/Falkor, Chroma, LoRaMaths, LLM)
 * and returns a mobile-friendly HTML page.
 *
 * No auth required. Read-only. No side-effects.
 */

import type { Express } from 'express';
import { getFalkorClient } from '../../emotion-core/memory-v1/db/falkorClient';
import { getChromaClient } from '../../emotion-core/memory-v1/db/chromaClient';
import { getLLMHealth } from '../llmTelemetry';

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

function statusIcon(s: 'ok' | 'down' | 'unknown'): string {
  if (s === 'ok') return '●';
  if (s === 'down') return '●';
  return '●';
}

function statusColor(s: 'ok' | 'down' | 'unknown'): string {
  if (s === 'ok') return '#22c55e';
  if (s === 'down') return '#ef4444';
  return '#a1a1aa';
}

function renderHTML(services: ServiceStatus[], activeSessions: number): string {
  const allOk = services.every(s => s.status === 'ok');
  const overallColor = allOk ? '#22c55e' : '#ef4444';
  const overallText = allOk ? 'All Systems Operational' : 'Degraded';
  const now = new Date().toUTCString();

  const rows = services.map(s => `
    <div class="svc">
      <div class="svc-header">
        <span class="dot" style="color:${statusColor(s.status)}">${statusIcon(s.status)}</span>
        <span class="svc-name">${s.name}</span>
        <span class="svc-status" style="color:${statusColor(s.status)}">${s.status.toUpperCase()}</span>
      </div>
      ${s.detail ? `<div class="svc-detail">${s.detail}</div>` : ''}
      ${s.latencyMs > 0 ? `<div class="svc-detail">${s.latencyMs}ms</div>` : ''}
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LoRa — System Status</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a; color: #e4e4e7;
      min-height: 100vh; padding: 24px 16px;
    }
    .container { max-width: 480px; margin: 0 auto; }
    .header { text-align: center; margin-bottom: 32px; }
    .logo { font-size: 24px; font-weight: 700; letter-spacing: -0.5px; }
    .overall {
      font-size: 15px; margin-top: 8px; font-weight: 500;
      color: ${overallColor};
    }
    .meta { font-size: 12px; color: #71717a; margin-top: 4px; }
    .svc {
      background: #18181b; border: 1px solid #27272a; border-radius: 10px;
      padding: 14px 16px; margin-bottom: 10px;
    }
    .svc-header { display: flex; align-items: center; gap: 8px; }
    .dot { font-size: 12px; }
    .svc-name { flex: 1; font-size: 14px; font-weight: 500; }
    .svc-status { font-size: 12px; font-weight: 600; letter-spacing: 0.5px; }
    .svc-detail { font-size: 12px; color: #71717a; margin-top: 4px; padding-left: 20px; }
    .footer { text-align: center; margin-top: 24px; font-size: 12px; color: #52525b; }
    .stats { display: flex; justify-content: center; gap: 24px; margin: 16px 0 24px; }
    .stat { text-align: center; }
    .stat-val { font-size: 20px; font-weight: 700; color: #e4e4e7; }
    .stat-lbl { font-size: 11px; color: #71717a; margin-top: 2px; }
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
        <div class="stat-val">${activeSessions}</div>
        <div class="stat-lbl">Active Sessions</div>
      </div>
      <div class="stat">
        <div class="stat-val">${uptimeString()}</div>
        <div class="stat-lbl">Uptime</div>
      </div>
    </div>
    ${rows}
    <div class="footer">Pull to refresh · asklora.io</div>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerHealthDashboardRoute(
  app: Express,
  engineSessions?: Map<string, unknown>,
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
      const activeSessions = engineSessions?.size ?? 0;

      // If client wants JSON (e.g. programmatic check), return JSON
      if (_req.headers.accept?.includes('application/json')) {
        const allOk = services.every(s => s.status === 'ok');
        res.json({ status: allOk ? 'ok' : 'degraded', uptime: uptimeString(), activeSessions, services });
        return;
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(renderHTML(services, activeSessions));
    } catch {
      res.status(500).json({ status: 'error' });
    }
  });
}
