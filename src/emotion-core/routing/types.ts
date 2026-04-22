/**
 * Adaptive Router V2 — core types.
 *
 * Ported from ~/Desktop/lora-router-bench (iter_008) after 124-turn adversarial
 * validation (87.9% bench, 84% cold-start fresh, crisis override verified).
 *
 * A Tier names how much of LoRa's pipeline should fire for a given message.
 * A RouteDecision is the router's output — tier + reason + raw signals.
 *
 * This file has ZERO dependencies on the rest of the backend — the router
 * is a pure function. That's deliberate; it means the integration can be
 * flag-gated with a clean revert path.
 */

export type Tier = 'trivial' | 'lightweight' | 'substantive';

export interface RouterInput {
  /** The current user message. */
  text: string;
  /** Optional session context. */
  context?: SessionContext;
}

export interface SessionContext {
  /** Number of user messages in the session so far (not counting current). */
  messageCount: number;
  /** Tiers of recent messages, oldest → newest. Capped to last N (default 3). */
  recentTiers: Tier[];
  /** Recent EIV values (oldest → newest). */
  recentEIVs: number[];
  /** True if the user is mid-clarification on a prior substantive exchange. */
  inClarificationLoop: boolean;
}

export interface Signals {
  hasLifeStakes: boolean;
  hasDecisionVocab: boolean;
  hasEmotionalVocab: boolean;
  hasExplicitDeep: boolean;
  hasExplicitQuick: boolean;
  isTrivialShape: boolean;
  wordCount: number;
  hasQuestionMark: boolean;
  /** Message opens with a factual interrogative ("what's X", "explain X"). */
  isFactualShell: boolean;
  /** Message contains at least one first-person pronoun. */
  hasPersonalPronoun: boolean;
  /** Message is a session-opener greeting ("hey", "hi") — never inherits tier. */
  isSessionOpener: boolean;
  /** Message is a continuation cue ("yeah", "go on") — eligible to inherit. */
  isContinuationCue: boolean;
  /** 0-100 emotional-intensity score from surface features (caps, punctuation, repetition). */
  eivScore: number;
  /** eivScore >= EIV_HIGH_THRESHOLD. */
  hasHighEIV: boolean;
  /**
   * Crisis vocabulary (suicide, self-harm, breaking-point).
   * Broken out as its own signal so the router can guarantee crisis content
   * overrides explicit_quick_request — the user saying "quick question" must
   * not downgrade a crisis message.
   */
  hasCrisis: boolean;
  /**
   * Technical / code content (v1 parity). Used to bias toward lightweight
   * when the question is about APIs, functions, programming languages, etc.
   */
  hasTechnicalHints: boolean;
  /**
   * Code block or inline identifier (backticks). v1 parity.
   */
  hasCodeBlock: boolean;
  /**
   * Relationship vocabulary (girlfriend, husband, mom, boss, etc.).
   * v1 parity — relational content promotes substantive.
   */
  hasRelationshipVocab: boolean;
  /**
   * Self-reflection vocabulary ("my life", "who am i", "i've been").
   * v1 parity — identity/self-reflection promotes substantive.
   */
  hasSelfReflection: boolean;
}

export interface RouteDecision {
  tier: Tier;
  /** Short machine-readable reason code. Used for telemetry. */
  reason: RouteReason;
  /** 0-1 confidence in the decision. Low conf = ambiguous case. */
  confidence: number;
  /** Raw signals extracted from the message (for telemetry + debugging). */
  signals: Signals;
}

export type RouteReason =
  | 'crisis_override'
  | 'explicit_deep_request'
  | 'explicit_quick_request'
  | 'trivial_shape'
  | 'session_opener'
  | 'continuation_inherit'
  | 'life_stakes'
  | 'decision_and_emotional'
  | 'partial_weight_signal_bias_deep'
  | 'factual_shell_demotion'
  | 'arc_bias'
  | 'eiv_solo_promotion'
  | 'relationship_vocab'
  | 'self_reflection_vocab'
  | 'code_block'
  | 'technical_short'
  | 'default_lightweight';
