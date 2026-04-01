/**
 * Lightweight in-memory operational counters for the health dashboard.
 *
 * Every counter is a simple integer. Resets daily (UTC) alongside runtimeMetrics.
 * Zero overhead on the request path — just an integer increment.
 *
 * NOT persisted to disk. Server restart = counters reset. That's fine —
 * this is real-time monitoring, not long-term analytics (PostHog covers that).
 */

// ---------------------------------------------------------------------------
// Counter names (typed for safety)
// ---------------------------------------------------------------------------

export type CounterName =
  // Messages
  | 'messages_processed'
  | 'messages_relational'
  // LLM
  | 'llm_success'
  | 'llm_fallback_cooldown'
  | 'llm_fallback_retry_exhausted'
  | 'llm_cooldown_activated'
  // Rate limiting
  | 'rate_limit_user'
  | 'rate_limit_ip'
  // Identity guard
  | 'identity_opener_stripped'
  | 'identity_semantic_rewrite'
  | 'identity_question_rewrite'
  // Perspective engine
  | 'perspective_success'
  | 'perspective_failure'
  | 'perspective_timeout'
  // Session lifecycle
  | 'session_cap_hit'
  | 'session_completed'
  // Memory V2
  | 'memory_v2_consolidation_success'
  | 'memory_v2_consolidation_failure';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const counters: Record<string, number> = {};
const uniqueUsers = new Set<string>();
let currentDate = todayUTC();

function todayUTC(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function ensureToday(): void {
  const today = todayUTC();
  if (currentDate !== today) {
    // New day — reset everything
    for (const key of Object.keys(counters)) {
      counters[key] = 0;
    }
    uniqueUsers.clear();
    currentDate = today;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Increment a counter by 1 (or more). */
export function increment(name: CounterName, amount = 1): void {
  ensureToday();
  counters[name] = (counters[name] ?? 0) + amount;
}

/** Track a unique user for today. */
export function trackUser(userId: string): void {
  ensureToday();
  uniqueUsers.add(userId);
}

/** Get all counters + unique user count as a snapshot. */
export function getCounters(): Record<string, number> & { unique_users: number } {
  ensureToday();
  return {
    ...counters,
    unique_users: uniqueUsers.size,
  };
}
