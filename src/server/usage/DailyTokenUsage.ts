/**
 * Tracks daily token usage per userId. Resets at UTC midnight.
 * Used to enforce LORA_DAILY_TOKEN_LIMIT before LLM calls.
 */

const storage = new Map<string, { date: string; tokens: number }>();

function todayUTC(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function ensureToday(userId: string): { date: string; tokens: number } {
  const today = todayUTC();
  const entry = storage.get(userId);
  if (!entry || entry.date !== today) {
    const next = { date: today, tokens: 0 };
    storage.set(userId, next);
    return next;
  }
  return entry;
}

/**
 * Parsed daily limit from env. 0 or missing means limit is disabled.
 */
export function getDailyLimit(): number {
  const raw = process.env.LORA_DAILY_TOKEN_LIMIT;
  if (raw === undefined || raw === '') return 0;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) || n < 0 ? 0 : n;
}

/**
 * Tokens used today for this user (resets at UTC midnight).
 */
export function getTokensUsedToday(userId: string): number {
  const entry = ensureToday(userId);
  return entry.tokens;
}

/**
 * Add tokens to today's usage for this user.
 */
export function addTokens(userId: string, tokens: number): void {
  const entry = ensureToday(userId);
  entry.tokens += Math.max(0, Math.floor(tokens));
}

/**
 * True if adding additionalTokens would exceed the daily limit.
 * If limit is disabled (0), always returns false.
 */
export function wouldExceedLimit(userId: string, additionalTokens: number): boolean {
  const limit = getDailyLimit();
  if (limit <= 0) return false;
  const used = getTokensUsedToday(userId);
  return used + additionalTokens > limit;
}
