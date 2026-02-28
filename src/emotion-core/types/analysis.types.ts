// src/emotion-core/types/analysis.types.ts

/**
 * EmotionalValence
 * ----------------
 * Direction of emotion (NOT intensity)
 */
export type EmotionalValence =
  | 'POSITIVE'
  | 'NEGATIVE'
  | 'NEUTRAL';

/**
 * EmotionalArousal
 * ----------------
 * Intensity band derived from EIV tiers
 */
export type EmotionalArousal =
  | 'LOW'
  | 'MEDIUM'
  | 'HIGH';

/**
 * EmotionalState
 * --------------
 * Interpreted emotional meaning AFTER analyzers + EIV
 * BEFORE prompt generation
 *
 * NOTE (V1):
 * - `dominant` is REQUIRED but may be coarse or rule-based
 * - `confidence` is INTERNAL ONLY (never exposed to LLM)
 */
export type EkmanDominant =
  | 'JOY'
  | 'ANGER'
  | 'FEAR'
  | 'SADNESS'
  | 'SURPRISE'
  | 'DISGUST';

export interface EmotionalState {
  dominant:
    | 'JOY'
    | 'SADNESS'
    | 'ANGER'
    | 'FEAR'
    | 'CONTENTMENT'
    | 'NEUTRAL';

  arousal: EmotionalArousal;
  valence: EmotionalValence;

  /**
   * Confidence in interpretation (0–1)
   * INTERNAL USE ONLY
   */
  confidence: number;

  /**
   * Ekman family classification from appraisal-lab family engine.
   * Optional — only set when appraisal bridge is active and confidence >= threshold.
   */
  ekmanDominant?: EkmanDominant;

  /**
   * Confidence of the Ekman family classification (0–1).
   * INTERNAL USE ONLY — never exposed in prompt as a numeric value.
   */
  ekmanConfidence?: number;
}

/**
 * EmotionalProfile is a Layer-2 output contract promised by the LoRa architecture.
 * It is NOT wired into v1 runtime. Wiring is deferred to v1.1+.
 *
 * NOTE:
 * - Immutable by design (readonly fields).
 * - Type-only contract; do not import into runtime paths yet.
 */
export interface EmotionFamilyClassification {
  readonly primary: string;
  readonly secondary?: string;
  readonly confidence: number;
}

export interface EscalationMetrics {
  readonly onsetRate: number;
  readonly offsetRate: number;
  readonly volatility: number;
}

export interface PressureMetrics {
  readonly pressureScore: number;
  readonly pressureTrend: 'rising' | 'stable' | 'releasing';
}

export interface LoopMetrics {
  readonly loopingActive: boolean;
  readonly loopDepth: number;
}

export interface EmotionalProfile {
  readonly eiv: number;
  readonly emotionFamily: EmotionFamilyClassification;
  readonly escalation: EscalationMetrics;
  readonly pressure: PressureMetrics;
  readonly looping: LoopMetrics;
  readonly ambiguity: {
    readonly score: number;
    readonly penaltyApplied: number;
  };
}

/* ============================================================================
 * Analyzer-Level Structures (Future-facing, V1-safe)
 * ========================================================================== */

/**
 * AnalyzerSignal
 * --------------
 * Atomic detected signal (punctuation, emoji, lexical, etc.)
 *
 * NOTE:
 * - V1 does NOT yet generate these directly
 * - This interface is RESERVED for V2+ analyzers
 */
export interface AnalyzerSignal {
  type: string;
  value: number;

  /**
   * Signal-level confidence [0, 1]
   */
  confidence: number;

  position?: 'start' | 'mid' | 'end';
  metadata?: Record<string, unknown>;

  /**
   * Emotional Intensity Value (EIV) [0, 1]
   * OPTIONAL — not required in V1
   */
  eiv?: number;

  /**
   * Source identifier for weighting logic
   */
  weightSource?: string;
}

/**
 * AnalyzerResult
 * --------------
 * Output of a single analyzer
 *
 * NOTE:
 * - NOT consumed by EngineOrchestrator in V1
 * - Preserved for research continuity
 */
export interface AnalyzerResult {
  analyzerId: string;
  signals: AnalyzerSignal[];

  /**
   * Analyzer-level confidence [0, 1]
   * Placeholder in V1
   */
  confidence: number;

  metadata?: Record<string, unknown>;

  aggregateEIV?: number;

  eivBreakdown?: {
    exclamation?: number;
    question?: number;
    ellipsis?: number;
    mixed?: number;
    trailing_ellipsis?: number;
    period?: number;
  };
}

/**
 * AnalysisContext
 * ---------------
 * Optional execution metadata
 */
export interface AnalysisContext {
  userId?: string;
  sessionId?: string;
  timestamp?: number;

  /**
   * Enable verbose EIV logging (DEBUG ONLY)
   */
  debugEIV?: boolean;
}

/**
 * EIVCalculation
 * --------------
 * Detailed math breakdown (TESTING / VALIDATION ONLY)
 */
export interface EIVCalculation {
  baseWeight: number;
  repetitionCount: number;
  increment: number;
  rawEIV: number;
  cappedEIV: number;
  confidence: number;
  researchBacking: string;
}

/* ============================================================================
 * IMPORTANT ARCHITECTURAL NOTE
 * ============================================================================
 *
 * - EIV is calculated numerically in scorers (EIVScorer)
 * - EmotionalState is a DERIVED, INTERPRETED layer
 * - ETV is NOT part of this file (system-level state)
 *
 * This file MUST remain declarative.
 * No logic. No assumptions. No runtime guarantees.
 *
 * ============================================================================
 */
