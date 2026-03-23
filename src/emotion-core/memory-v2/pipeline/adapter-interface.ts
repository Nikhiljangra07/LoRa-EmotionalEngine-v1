import type {
  ConversationTurn,
  EmotionalFingerprint,
  MemoryContext,
} from '../types';

// ──────────────────────────────────────────────────────
// IMemoryAdapter — the plug-in interface for the backend
//
// The backend calls this interface at two points:
// 1. processSessionEnd() — when a session ends
// 2. retrieveContext() — when a new session starts
//
// To switch from Level 1 to Level 2 memory:
//   Disable Level 1 memory flag → enable Level 2 adapter → restart.
//   No code contamination between repos.
// ──────────────────────────────────────────────────────

/** Data provided by the backend when a session ends */
export interface SessionEndData {
  userId: string;
  sessionId: string;
  /** The full conversation history (used for summarization, then discarded) */
  conversationHistory: ConversationTurn[];
  /** EIV values per turn, computed by EngineOrchestrator during the session */
  eivCurve: number[];
}

/** Result returned after processing a session end */
export interface ProcessResult {
  /** Whether data was successfully stored */
  stored: boolean;
  /** Number of fact anchors stored */
  factsCount: number;
  /** Whether the fingerprint was stored */
  fingerprintStored: boolean;
  /** Whether the user profile was updated */
  profileUpdated: boolean;
  /** Whether re-extraction was needed (verification failed first pass) */
  reExtracted: boolean;
}

/** The plug-in interface for the backend */
export interface IMemoryAdapter {
  /** Process session end: summarize → extract → verify → store → discard */
  processSessionEnd(sessionData: SessionEndData): Promise<ProcessResult>;

  /** Retrieve emotionally relevant context for a new session */
  retrieveContext(userId: string, currentState: EmotionalFingerprint): Promise<MemoryContext>;

  /** Remove all data for a user (GDPR / account deletion) */
  purgeUser(userId: string): Promise<void>;
}
