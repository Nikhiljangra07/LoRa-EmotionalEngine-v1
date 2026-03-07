/**
 * Runtime cost tracking: total tokens and sessions per day (UTC).
 * Written to disk every 5 minutes. No I/O on the request path.
 */

import * as fs from 'fs';
import * as path from 'path';

const LOG_DIR = path.join(process.cwd(), 'logs', 'analytics');
const METRICS_FILE = path.join(LOG_DIR, 'runtime-metrics.json');
const WRITE_INTERVAL_MS = 5 * 60 * 1000;

function todayUTC(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

let state: {
  date: string;
  totalTokens: number;
  sessionCount: number;
  sumSessionLength: number;
} = { date: '', totalTokens: 0, sessionCount: 0, sumSessionLength: 0 };

function ensureToday(): void {
  const today = todayUTC();
  if (state.date !== today) {
    state = { date: today, totalTokens: 0, sessionCount: 0, sumSessionLength: 0 };
  }
}

/**
 * Call when tokens are consumed (in-memory only; does not touch disk).
 */
export function incrementTokensToday(tokens: number): void {
  ensureToday();
  state.totalTokens += Math.max(0, Math.floor(tokens));
}

/**
 * Call when a session ends (in-memory only).
 */
export function recordSessionEnd(sessionLength: number): void {
  ensureToday();
  state.sessionCount += 1;
  state.sumSessionLength += Math.max(0, Math.floor(sessionLength));
}

export function getSnapshot(): { tokensToday: number; sessionsToday: number; avgSessionLength: number } {
  ensureToday();
  const avgSessionLength =
    state.sessionCount > 0
      ? Math.round(state.sumSessionLength / state.sessionCount)
      : 0;
  return {
    tokensToday: state.totalTokens,
    sessionsToday: state.sessionCount,
    avgSessionLength,
  };
}

function writeMetrics(): void {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    const snapshot = getSnapshot();
    const payload = JSON.stringify(snapshot, null, 2);
    fs.promises.writeFile(METRICS_FILE, payload + '\n').catch(() => {
      // best-effort; do not affect request path or interval
    });
  } catch {
    // best-effort
  }
}

let intervalStarted = false;

/**
 * Start writing metrics every 5 minutes. Safe to call multiple times (idempotent).
 */
export function startPeriodicWrite(): void {
  if (intervalStarted) return;
  intervalStarted = true;
  writeMetrics();
  setInterval(writeMetrics, WRITE_INTERVAL_MS);
}
