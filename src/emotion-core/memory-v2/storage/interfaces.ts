import type { SessionFingerprint, EmotionalFingerprint, FactAnchor, GraphSnapshot, UserProfile } from '../types';

// ──────────────────────────────────────────────────────
// Storage interfaces — pure contracts, no implementation dependency
// ──────────────────────────────────────────────────────

/**
 * IVectorStore — stores and queries emotional fingerprints via vector similarity.
 * Implementations: ChromaDB (testing), Pinecone (production).
 */
export interface IVectorStore {
  /** Store a session fingerprint as a vector with metadata */
  store(userId: string, fingerprint: SessionFingerprint): Promise<void>;

  /**
   * Find the most similar past fingerprints for a user.
   * Returns up to `limit` results, ordered by cosine similarity (descending).
   */
  querySimilar(
    userId: string,
    currentFingerprint: EmotionalFingerprint,
    limit: number,
  ): Promise<SessionFingerprint[]>;

  /** Delete a specific session's fingerprint */
  delete(userId: string, sessionId: string): Promise<void>;

  /** Remove all data for a user (GDPR / account deletion) */
  purgeUser(userId: string): Promise<void>;
}

/**
 * IGraphStore — stores and queries fact anchors and their relationships.
 * Implementations: FalkorDB (testing), Neo4j Aura (production).
 */
export interface IGraphStore {
  /** Store fact anchors linked to a session */
  storeAnchors(userId: string, sessionId: string, anchors: FactAnchor[]): Promise<void>;

  /** Retrieve anchors for specific sessions */
  getAnchorsForSessions(userId: string, sessionIds: string[]): Promise<FactAnchor[]>;

  /** Get the full graph snapshot for a user (all nodes + edges) */
  getUserGraph(userId: string): Promise<GraphSnapshot>;

  /**
   * Prune edges not accessed within maxAgeDays.
   * Returns the number of edges removed.
   */
  pruneStaleEdges(userId: string, maxAgeDays: number): Promise<number>;

  /** Persist a user profile */
  storeProfile(userId: string, profile: UserProfile): Promise<void>;

  /** Load a user profile (returns null if none exists) */
  getProfile(userId: string): Promise<UserProfile | null>;

  /** Remove all data for a user (GDPR / account deletion) */
  purgeUser(userId: string): Promise<void>;
}
