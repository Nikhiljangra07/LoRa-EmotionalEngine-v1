// ──────────────────────────────────────────────────────
// SessionSummary — transient structured summary of a conversation
// Generated at session end, consumed by both extraction paths,
// then DISCARDED. Never persisted to any database.
// ──────────────────────────────────────────────────────

/** A single turn in the conversation history (input to summarizer) */
export interface ConversationTurn {
  role: 'user' | 'lora';
  /** Raw message text — used ONLY for summarization, never stored */
  content: string;
}

/** The structured session summary — maps to the 6-section template */
export interface SessionSummary {
  /** §1 — What was this session about? (1 sentence max) */
  primaryTopic: string;
  /** §2 — Concrete information shared (names, dates, events, decisions) */
  keyFacts: string[];
  /** §3 — How the user's emotional state changed */
  emotionalArc: {
    start: string;
    middle: string;
    end: string;
  };
  /** §4 — What is causing the user's state, and how are they expressing it? */
  causeExpressionLink: {
    cause: string;
    expression: string;
  };
  /** §5 — What was decided or what action was identified? (null if none) */
  currentDirection: string | null;
  /** §6 — What remains open or unanswered? */
  unresolved: string[];
  /** §7 — Structural pattern shape (optional for backward-compat with old summaries) */
  structuralShape?: {
    /** The dominant structural pattern driving this session */
    dominantPattern: string;
    /** What the user specifically avoided naming or confronting */
    namedAvoidances: string[];
    /** Reframe attempts by LoRa and whether the user accepted them */
    reframeAttempts: { turn: number; accepted: boolean }[];
  };
}
