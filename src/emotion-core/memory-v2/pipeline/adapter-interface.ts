import type {
  ConversationTurn,
  EmotionalFingerprint,
  InterventionRecord,
  MemoryContext,
} from '../types';
import type { StructuralFramework } from '../types/vocabularies';

// ──────────────────────────────────────────────────────
// PerspectiveSessionSummary — accumulated LoRaMaths results
// One per message that received a perspective analysis.
// ──────────────────────────────────────────────────────

export interface PerspectiveSessionSummary {
  /** Which message turn this perspective was generated for */
  turn: number;
  /** The framework LoRaMaths classified this message under */
  framework: StructuralFramework;
  /** Human-readable label (e.g. "The Loyalty Tax") */
  label: string;
  /** Condensed 45-65 word insight */
  condensed: string;
  /** Framework strength score (0-1) */
  strength: number;
  /** Cross-framework tension (if LoRaMaths detected one) */
  tension?: string;
}

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
  /** Accumulated LoRaMaths perspective results from the session (optional — absent if perspective engine was off/timed out) */
  perspectiveResults?: PerspectiveSessionSummary[];
  /** Intervention records tracking what LoRa did and how user responded (optional — not yet populated) */
  interventionRecords?: InterventionRecord[];
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
