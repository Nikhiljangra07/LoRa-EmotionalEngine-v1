/**
 * Lightweight engagement analytics: one JSON line per session end.
 * No conversation content stored. Writes are fire-and-forget (non-blocking).
 */

import * as fs from 'fs';
import * as path from 'path';

const LOG_DIR = path.join(process.cwd(), 'logs', 'analytics');
const LOG_FILE = path.join(LOG_DIR, 'user-engagement.log');

let dirEnsured = false;
function ensureLogDir(): void {
  if (dirEnsured) return;
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    dirEnsured = true;
  } catch {
    // best-effort; append will fail silently
  }
}

export interface EngagementEvent {
  userId: string;
  sessionId: string;
  sessionStart: number;
  sessionEnd: number;
  messagesCount: number;
  tokensUsed: number;
  durationSeconds: number;
  endedAt: number;
}

/**
 * Appends one JSON line to logs/analytics/user-engagement.log.
 * Never throws and never blocks the caller (fire-and-forget).
 */
export function logSessionEnd(event: EngagementEvent): void {
  ensureLogDir();
  const line = JSON.stringify(event) + '\n';
  fs.promises.appendFile(LOG_FILE, line).catch(() => {
    // ignore write errors so the request pipeline is never affected
  });
}
