/**
 * In-memory sliding-window rate limit per userId.
 * Used to cap requests per second on /api/chat.
 */

const WINDOW_MS = 1000;
const MAX_REQUESTS_PER_WINDOW = 5;

/** userId -> timestamps (ms) of requests in the current window */
const windows = new Map<string, number[]>();

/**
 * Returns true if the request is allowed (under the limit), false if rate limited.
 * When allowed, records this request in the sliding window.
 */
export function tryAllow(userId: string): boolean {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  let timestamps = windows.get(userId);
  if (!timestamps) {
    timestamps = [];
    windows.set(userId, timestamps);
  }
  // Drop timestamps outside the window
  while (timestamps.length > 0 && timestamps[0]! < cutoff) {
    timestamps.shift();
  }
  if (timestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }
  timestamps.push(now);
  return true;
}
