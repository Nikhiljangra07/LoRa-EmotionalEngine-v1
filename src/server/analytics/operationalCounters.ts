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
  // Adaptive routing — model-tier selection per message
  | 'route_sonnet'
  | 'route_haiku_trivial'
  | 'route_haiku_lightweight'
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
  | 'memory_v2_consolidation_failure'
  // Deep reasoning
  | 'deep_reasoning_requested'
  | 'deep_reasoning_completed'
  // Input sanitization
  | 'sanitizer_triggered'
  // Token limit
  | 'containment_token_warning'
  // Errors
  | 'error_500';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const counters: Record<string, number> = {};
const uniqueAuthUsers = new Set<string>();
const uniqueGuestUsers = new Set<string>();
let peakConcurrentSessions = 0;
let lastActivityTs = 0;
const responseTimes: number[] = [];  // rolling window of last 100 response times (ms)
let currentDate = todayUTC();

function todayUTC(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function ensureToday(): void {
  const today = todayUTC();
  if (currentDate !== today) {
    for (const key of Object.keys(counters)) {
      counters[key] = 0;
    }
    uniqueAuthUsers.clear();
    uniqueGuestUsers.clear();
    peakConcurrentSessions = 0;
    responseTimes.length = 0;
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

/** Track a unique user for today. Splits auth vs guest. */
export function trackUser(userId: string): void {
  ensureToday();
  if (userId.startsWith('guest_')) {
    uniqueGuestUsers.add(userId);
  } else {
    uniqueAuthUsers.add(userId);
  }
}

/** Call whenever engineSessions.size changes to track peak. */
export function updateConcurrent(activeCount: number): void {
  ensureToday();
  if (activeCount > peakConcurrentSessions) {
    peakConcurrentSessions = activeCount;
  }
}

/** Record a message response time (ms). Keeps last 100. */
export function recordResponseTime(ms: number): void {
  ensureToday();
  lastActivityTs = Date.now();
  if (responseTimes.length >= 100) responseTimes.shift();
  responseTimes.push(ms);
}

/** Get all counters + user stats as a snapshot. */
export function getCounters(): Record<string, number> & {
  unique_users: number;
  auth_users: number;
  guest_users: number;
  peak_concurrent: number;
  last_activity_ts: number;
  avg_response_ms: number;
  p95_response_ms: number;
  min_response_ms: number;
  max_response_ms: number;
} {
  ensureToday();

  let avg = 0, p95 = 0, min = 0, max = 0;
  if (responseTimes.length > 0) {
    const sorted = [...responseTimes].sort((a, b) => a - b);
    avg = Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length);
    p95 = sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1]!;
    min = sorted[0]!;
    max = sorted[sorted.length - 1]!;
  }

  return {
    ...counters,
    unique_users: uniqueAuthUsers.size + uniqueGuestUsers.size,
    auth_users: uniqueAuthUsers.size,
    guest_users: uniqueGuestUsers.size,
    peak_concurrent: peakConcurrentSessions,
    last_activity_ts: lastActivityTs,
    avg_response_ms: avg,
    p95_response_ms: p95,
    min_response_ms: min,
    max_response_ms: max,
  };
}
