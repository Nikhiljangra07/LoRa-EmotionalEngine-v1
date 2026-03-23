import type {
  EkmanEmotion,
  ContextCategory,
  Tier,
} from './vocabularies';

// ──────────────────────────────────────────────────────
// Graph DB node and edge types — matches Neo4j schema in CLAUDE.md
// All fields are category labels or numbers. No free text.
// ──────────────────────────────────────────────────────

// ── Node types ──

export interface UserNode {
  nodeType: 'User';
  userId: string;
  tier: Tier;
  /** ISO date */
  firstSeen: string;
}

export interface GoalNode {
  nodeType: 'Goal';
  /** From a constrained label set — not free text */
  label: string;
  /** 1–10 */
  importance: number;
}

export interface PersonNode {
  nodeType: 'Person';
  /** Relationship role, e.g. "partner", "manager", "friend" */
  role: string;
  /** Descriptive label, e.g. "supportive", "critical" */
  label: string;
}

export interface BarrierNode {
  nodeType: 'Barrier';
  /** e.g. "financial_fear", "social_judgment" */
  label: string;
  /** 0–1 */
  intensity: number;
}

export interface EmotionalStateNode {
  nodeType: 'EmotionalState';
  primary: EkmanEmotion;
  /** 0–1 */
  intensity: number;
}

export interface ContextCategoryNode {
  nodeType: 'ContextCategory';
  label: ContextCategory;
}

export interface SessionNode {
  nodeType: 'Session';
  sessionId: string;
  /** ISO date */
  timestamp: string;
  /** 1–10 */
  importanceScore: number;
}

export type GraphNode =
  | UserNode
  | GoalNode
  | PersonNode
  | BarrierNode
  | EmotionalStateNode
  | ContextCategoryNode
  | SessionNode;

// ── Edge types ──

export type EdgeType =
  | 'HAS_GOAL'
  | 'KNOWS_PERSON'
  | 'BLOCKED_BY'
  | 'FELT'
  | 'TRIGGERED_BY'
  | 'HAD_STATE'
  | 'RELATED_TO';

export interface GraphEdge {
  edgeType: EdgeType;
  from: GraphNode;
  to: GraphNode;
  /** Optional metadata on the edge */
  metadata?: {
    sessionId?: string;
    timestamp?: string;
  };
}

/** A snapshot of a user's full graph — returned by getUserGraph() */
export interface GraphSnapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
