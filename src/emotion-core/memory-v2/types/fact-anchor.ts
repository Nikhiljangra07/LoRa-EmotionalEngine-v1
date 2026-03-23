// ──────────────────────────────────────────────────────
// FactAnchor — structured fact extracted from a session summary
// Each anchor maps to a graph node + edges in the graph DB.
// All values are normalized labels — never raw transcript text.
// ──────────────────────────────────────────────────────

/** The category of fact being anchored */
export const FACT_ANCHOR_TYPES = [
  'goal', 'person', 'barrier', 'event', 'decision', 'identity',
] as const;
export type FactAnchorType = (typeof FACT_ANCHOR_TYPES)[number];

/**
 * Slot names per anchor type — what field this fact occupies.
 * These are fixed so downstream consumers can switch on them.
 */
export const FACT_SLOTS = {
  goal: ['career_goal', 'financial_goal', 'relationship_goal', 'health_goal', 'education_goal', 'personal_goal'] as const,
  person: ['user_name', 'partner', 'family_member', 'friend', 'colleague', 'manager', 'therapist', 'mentor'] as const,
  barrier: ['financial_fear', 'social_judgment', 'partner_reaction', 'failure_fear', 'commitment_fear', 'conflict_avoidance', 'change_resistance', 'vulnerability_fear', 'uncertainty', 'rejection_fear', 'loss_of_control'] as const,
  event: ['breakup', 'job_change', 'relocation', 'health_event', 'loss', 'conflict', 'achievement', 'deadline', 'meeting'] as const,
  decision: ['committed', 'exploring', 'rejected', 'deferred'] as const,
  identity: ['role', 'trait', 'value', 'belief'] as const,
} as const;

export type GoalSlot = (typeof FACT_SLOTS.goal)[number];
export type PersonSlot = (typeof FACT_SLOTS.person)[number];
export type BarrierSlot = (typeof FACT_SLOTS.barrier)[number];
export type EventSlot = (typeof FACT_SLOTS.event)[number];
export type DecisionSlot = (typeof FACT_SLOTS.decision)[number];
export type IdentitySlot = (typeof FACT_SLOTS.identity)[number];

export type FactSlot = GoalSlot | PersonSlot | BarrierSlot | EventSlot | DecisionSlot | IdentitySlot;

/** A relationship edge connecting this fact to another */
export interface FactRelationship {
  targetType: FactAnchorType;
  targetValue: string;
  edge: string;
}

/** A single extracted fact anchor */
export interface FactAnchor {
  type: FactAnchorType;
  /** Which slot this fact occupies within its type */
  slot: FactSlot;
  /** Normalized label — snake_case, never raw text */
  value: string;
  /** Extraction confidence (0–1) */
  confidence: number;
  /** Connections to other facts (for graph edges) */
  relationships: FactRelationship[];
}
