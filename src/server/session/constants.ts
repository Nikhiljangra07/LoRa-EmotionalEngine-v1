/**
 * Minimum user messages before a session counts toward tier promotion.
 *
 * 1 = any real interaction counts (one message + reply = a session).
 * Sessions with 0 user messages (started but never used) still don't count
 * because the engine entry is never created in that case.
 */
export const MIN_MESSAGES_FOR_COMPLETION = 1;

/** Minimum user messages before Memory V2 consolidation fires. */
export const MIN_MESSAGES_FOR_MEMORY = 3;
