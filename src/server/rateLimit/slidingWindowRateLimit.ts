/**
 * In-memory sliding-window rate limit.
 * Dual-key: per userId AND per IP for guest users.
 * Prevents guest userId rotation to bypass limits.
 */

const WINDOW_MS = 1000;
const MAX_REQUESTS_PER_WINDOW = 5;

/** Per-IP limit for guest users (stricter than per-userId) */
const MAX_GUEST_IP_REQUESTS_PER_WINDOW = 10;

/** key -> timestamps (ms) of requests in the current window */
const windows = new Map<string, number[]>();

function checkWindow(key: string, maxRequests: number): boolean {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  let timestamps = windows.get(key);
  if (!timestamps) {
    timestamps = [];
    windows.set(key, timestamps);
  }
  // Drop timestamps outside the window
  while (timestamps.length > 0 && timestamps[0]! < cutoff) {
    timestamps.shift();
  }
  if (timestamps.length >= maxRequests) {
    return false;
  }
  timestamps.push(now);
  return true;
}

/**
 * Returns true if the request is allowed (under the limit), false if rate limited.
 *
 * For guest users (userId starts with "guest_"), also checks per-IP limit
 * to prevent userId rotation attacks.
 */
export function tryAllow(userId: string, ipAddress?: string): boolean {
  // Always check per-userId limit
  if (!checkWindow(`user:${userId}`, MAX_REQUESTS_PER_WINDOW)) {
    return false;
  }

  // For guest users, also enforce per-IP limit
  if (ipAddress && userId.startsWith('guest_')) {
    if (!checkWindow(`ip:${ipAddress}`, MAX_GUEST_IP_REQUESTS_PER_WINDOW)) {
      return false;
    }
  }

  return true;
}

// Periodic cleanup: remove stale windows every 60s
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS * 2;
  for (const [key, timestamps] of windows.entries()) {
    if (timestamps.length === 0 || timestamps[timestamps.length - 1]! < cutoff) {
      windows.delete(key);
    }
  }
}, 60_000).unref();
