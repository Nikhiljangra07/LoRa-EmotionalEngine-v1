import type { EmotionalFingerprint, StructuralDynamic, MemoryContext, MatchedSession, ResponseMode, FactAnchor } from '../types';
import type { IVectorStore, IGraphStore } from '../storage/interfaces';
import { computeSimilarity } from './similarity';

// ──────────────────────────────────────────────────────
// Emotion-Anchored Retriever — the Graph-Vector Handshake
//
// Step 1: Vector DB query → top N similar past fingerprints
// Step 2: Filter by similarity threshold (> 0.70)
// Step 3: Graph DB query → facts from matched sessions
// Step 4: Determine response mode based on top similarity
// Step 5: Return combined MemoryContext
// ──────────────────────────────────────────────────────

/** Similarity threshold — only surface memories above this score */
const SIMILARITY_THRESHOLD = 0.70;

/** Threshold for subtle acknowledgment: "This feels familiar, doesn't it?" */
const SUBTLE_THRESHOLD = 0.80;

/** Threshold for direct recall: "You had this same energy when..." */
const DIRECT_THRESHOLD = 0.90;

/** How many candidates to fetch from vector DB before filtering */
const VECTOR_QUERY_LIMIT = 10;

/**
 * Compute recency boost (0–1) for a past session.
 * More recent sessions get a higher boost.
 * Falls off linearly over 90 days to 0.
 */
function recencyBoost(pastTimestamp: string, nowMs: number): number {
  const pastMs = new Date(pastTimestamp).getTime();
  if (!Number.isFinite(pastMs)) return 0; // Invalid timestamp → no boost
  const daysSince = (nowMs - pastMs) / (24 * 60 * 60 * 1000);

  if (daysSince <= 0) return 1.0;
  if (daysSince >= 90) return 0.0;

  // Linear decay: 1.0 at day 0 → 0.0 at day 90
  return 1.0 - daysSince / 90;
}

/**
 * Compute the full similarity score including recency boost.
 *
 * Formula from CLAUDE.md:
 *   0.35 * emotion_match
 *   + 0.25 * undertone_overlap
 *   + 0.20 * intensity_distance
 *   + 0.10 * context_similarity
 *   + 0.10 * recency_boost
 */
function fullSimilarity(
  current: EmotionalFingerprint,
  past: EmotionalFingerprint,
  pastTimestamp: string,
  nowMs: number,
  currentSD?: StructuralDynamic,
  pastSD?: StructuralDynamic,
): number {
  // computeSimilarity returns the 0.90 base (emotion + undertone + intensity + context + structure)
  const base = computeSimilarity(current, past, currentSD, pastSD);
  const recency = recencyBoost(pastTimestamp, nowMs);
  return base + 0.10 * recency;
}

/**
 * Determine response mode based on similarity and context match.
 *
 * - silent (default): Always. Adjust tone without mentioning memory.
 * - subtle (> 0.80): "This feels familiar, doesn't it?"
 * - direct (> 0.90 AND same context): "You had this same energy when..."
 */
function determineResponseMode(
  topSimilarity: number,
  currentContext: EmotionalFingerprint['contextCategory'],
  bestMatchContext: EmotionalFingerprint['contextCategory'] | null,
): ResponseMode {
  if (topSimilarity > DIRECT_THRESHOLD && currentContext === bestMatchContext) {
    return 'direct';
  }
  if (topSimilarity > SUBTLE_THRESHOLD) {
    return 'subtle';
  }
  return 'silent';
}

/**
 * Retrieve emotionally relevant memory context for a user.
 *
 * This is the Graph-Vector Handshake:
 * 1. Vector DB finds sessions that FELT similar
 * 2. Graph DB provides the FACTS from those sessions
 * 3. Response mode determines how LoRa uses the memory
 */
export async function retrieveMemory(
  userId: string,
  currentState: EmotionalFingerprint,
  vectorStore: IVectorStore,
  graphStore: IGraphStore,
): Promise<MemoryContext> {
  const nowMs = Date.now();

  // Step 1: Vector DB query — get candidate similar sessions
  const candidates = await vectorStore.querySimilar(userId, currentState, VECTOR_QUERY_LIMIT);

  // Step 2: Score each candidate with the full formula (including recency)
  // and filter by threshold
  const scored: MatchedSession[] = [];
  for (const candidate of candidates) {
    const similarity = fullSimilarity(
      currentState,
      candidate.emotionalFingerprint,
      candidate.timestamp,
      nowMs,
      undefined, // currentSD — not available during per-message retrieval
      candidate.structuralDynamic,
    );
    if (similarity >= SIMILARITY_THRESHOLD) {
      scored.push({ fingerprint: candidate, similarity });
    }
  }

  // Sort by similarity descending, take top 3
  scored.sort((a, b) => b.similarity - a.similarity);
  const matchedSessions = scored.slice(0, 3);

  // Step 3: Graph DB query — get facts from matched sessions
  let relatedFacts: FactAnchor[] = [];
  if (matchedSessions.length > 0) {
    const sessionIds = matchedSessions.map((m) => m.fingerprint.sessionId);
    relatedFacts = await graphStore.getAnchorsForSessions(userId, sessionIds);
  }

  // Step 4: Determine response mode
  const topSimilarity = matchedSessions.length > 0
    ? matchedSessions[0]!.similarity
    : 0;

  const bestMatchContext = matchedSessions.length > 0
    ? matchedSessions[0]!.fingerprint.emotionalFingerprint.contextCategory
    : null;

  const responseMode = determineResponseMode(
    topSimilarity,
    currentState.contextCategory,
    bestMatchContext,
  );

  return {
    matchedSessions,
    relatedFacts,
    responseMode,
    topSimilarity,
  };
}

// Export for testing
export { recencyBoost, fullSimilarity, determineResponseMode };
export { SIMILARITY_THRESHOLD, SUBTLE_THRESHOLD, DIRECT_THRESHOLD };
