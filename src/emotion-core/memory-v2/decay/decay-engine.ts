import type { SessionFingerprint, SessionSummary } from '../types';

// ──────────────────────────────────────────────────────
// Decay Engine — the "Losing Memory" (fog logic)
//
// Memories don't get deleted — they get fogged.
// If the user references something from 3 months ago,
// the access reactivates it (fog lifts). Deletion would
// make LoRa look stupid.
//
// Visibility rule (from CLAUDE.md):
//   visible if: (days_since_access < 30)
//            OR (importance_score > 7)
//            OR (access_count > 5)
// ──────────────────────────────────────────────────────

const RECENT_ACCESS_DAYS = 30;
const HIGH_IMPORTANCE_THRESHOLD = 7;
const HIGH_ACCESS_COUNT = 5;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Is this fingerprint visible (not fogged)?
 *
 * A fingerprint is visible if ANY of the following are true:
 * - It was accessed within the last 30 days
 * - Its importance score is > 7 (life anchors persist)
 * - It has been accessed more than 5 times (frequently recalled = important)
 *
 * Fogged fingerprints still exist in storage — they just aren't
 * returned by retrieval. Re-accessing lifts the fog.
 */
export function isVisible(fingerprint: SessionFingerprint, nowMs: number): boolean {
  // Check recency
  const lastAccessedMs = new Date(fingerprint.lastAccessed).getTime();
  const daysSinceAccess = (nowMs - lastAccessedMs) / MS_PER_DAY;
  if (daysSinceAccess < RECENT_ACCESS_DAYS) return true;

  // Check importance
  if (fingerprint.importanceScore > HIGH_IMPORTANCE_THRESHOLD) return true;

  // Check access frequency
  if (fingerprint.accessCount > HIGH_ACCESS_COUNT) return true;

  return false;
}

// ── Importance assignment ──

/**
 * Keywords that signal high importance (8-10): life anchors.
 * These are events that fundamentally change the user's situation.
 */
const LIFE_ANCHOR_KEYWORDS = [
  'breakup', 'broke up', 'ended the relationship', 'divorce',
  'job loss', 'fired', 'laid off', 'lost my job', 'terminated',
  'self-harm', 'suicide', 'suicidal', 'hurt myself', 'ending it',
  'death', 'died', 'passed away', 'funeral', 'grief',
  'major commitment', 'engaged', 'married', 'pregnant', 'baby',
  'diagnosis', 'cancer', 'terminal', 'chronic illness',
  'relocation', 'moving country', 'immigration',
  'assault', 'abuse', 'trauma', 'violence',
] as const;

/**
 * Keywords that signal medium importance (5-7): recurring patterns.
 * These are behaviors or concerns that surface repeatedly.
 */
const PATTERN_KEYWORDS = [
  'pattern', 'again', 'keep doing', 'always', 'every time',
  'avoidance', 'avoiding', 'deflecting', 'shutting down',
  'communication', 'not talking', 'conflict',
  'anxiety', 'anxious', 'worried', 'stressed',
  'decision', 'deciding', 'crossroads', 'torn',
  'career change', 'job change', 'switching',
  'relationship issue', 'trust issue',
] as const;

/**
 * Assign an importance score (1-10) to a session summary.
 *
 * Scoring tiers (from CLAUDE.md):
 * - 8-10: Life anchors (breakup, job loss, self-harm, major commitment)
 * - 5-7: Recurring patterns (avoidance, communication shifts)
 * - 1-4: Passing states (casual question, minor frustration)
 *
 * Scans the summary text for keyword matches to determine tier.
 * This is a heuristic for standalone use — the LLM-based importanceScore
 * from the fingerprint extractor (Component 4) is more accurate.
 */
export function assignImportance(summary: SessionSummary): number {
  // Build a single searchable text from the summary
  const searchText = [
    summary.primaryTopic,
    ...summary.keyFacts,
    summary.emotionalArc.start,
    summary.emotionalArc.middle,
    summary.emotionalArc.end,
    summary.causeExpressionLink.cause,
    summary.causeExpressionLink.expression,
    summary.currentDirection ?? '',
    ...summary.unresolved,
  ].join(' ').toLowerCase();

  // Check for life anchor keywords (8-10)
  let lifeAnchorHits = 0;
  for (const keyword of LIFE_ANCHOR_KEYWORDS) {
    if (searchText.includes(keyword)) {
      lifeAnchorHits++;
    }
  }

  if (lifeAnchorHits > 0) {
    // More keyword hits → higher score within the 8-10 range
    return Math.min(10, 8 + Math.min(lifeAnchorHits - 1, 2));
  }

  // Check for pattern keywords (5-7)
  let patternHits = 0;
  for (const keyword of PATTERN_KEYWORDS) {
    if (searchText.includes(keyword)) {
      patternHits++;
    }
  }

  if (patternHits > 0) {
    return Math.min(7, 5 + Math.min(patternHits - 1, 2));
  }

  // Default: passing state (1-4)
  // Use summary length as a rough proxy — longer sessions tend to be more substantial
  const wordCount = searchText.split(/\s+/).length;
  if (wordCount > 100) return 4;
  if (wordCount > 50) return 3;
  if (wordCount > 25) return 2;
  return 1;
}

/**
 * Touch a fingerprint's access metadata.
 *
 * - Updates lastAccessed to now
 * - Increments accessCount
 *
 * This "lifts the fog" on memories that have been re-accessed.
 * Returns a new fingerprint (immutable update).
 */
export function touchAccess(fingerprint: SessionFingerprint): SessionFingerprint {
  return {
    ...fingerprint,
    lastAccessed: new Date().toISOString(),
    accessCount: fingerprint.accessCount + 1,
  };
}

// Export constants for testing
export {
  RECENT_ACCESS_DAYS,
  HIGH_IMPORTANCE_THRESHOLD,
  HIGH_ACCESS_COUNT,
};
