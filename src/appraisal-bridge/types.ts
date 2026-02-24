/**
 * Appraisal Bridge — Boundary Contracts
 *
 * These types define the interface between Layer A (emotion-core signal
 * extraction) and Layer B (appraisal-lab interpretation pipeline).
 *
 * Import rules:
 *   - Only TYPE imports from emotion-core (no runtime)
 *   - No imports from appraisal-lab (bridge maps to/from its own types)
 */

import type { EmotionalState } from '../emotion-core/types/analysis.types';

// ─── Layer A → Bridge Input ─────────────────────────────────────────

export interface PatternSignals {
  readonly capsRatio: number;
  readonly punctuationHits: number;
  readonly emojiHits: number;
  readonly repetitionScore: number;
  readonly questionMarks: number;
}

export interface LayerASnapshot {
  readonly messageIndex: number;
  readonly timestampMs: number;
  readonly deltaMessageSeconds: number;

  readonly valenceScore: number;
  readonly valenceConfidence: number;
  readonly arousalScore: number;
  readonly arousalConfidence: number;
  readonly expressionStrength: number;
  readonly esConfidence: number;

  readonly eivValue: number;
  readonly eivTier: string;

  readonly patternSignals?: Readonly<PatternSignals>;

  readonly emotionalState: Readonly<EmotionalState>;
}

// ─── Bridge → Layer D Output ────────────────────────────────────────

export interface AppraisalFamily {
  readonly dominantFamily: string;
  readonly weights: Readonly<Record<string, number>>;
  readonly confidence: number;
}

export interface AppraisalPressure {
  readonly scalar: number;
  readonly slope: number;
  readonly volatility: number;
  readonly isShock: boolean;
  readonly byFamily: Readonly<Record<string, number>>;
}

export interface AppraisalMood {
  readonly category: string;
  readonly dominance: number;
  readonly confidence: number;
}

export interface AppraisalEscalationFlags {
  readonly warmedUp: boolean;
  readonly isFlapping: boolean;
  readonly enteredCritical: boolean;
}

export interface AppraisalEscalation {
  readonly level: number;
  readonly score: number;
  readonly flags: Readonly<AppraisalEscalationFlags>;
}

export interface AppraisalCollapse {
  readonly event: boolean;
  readonly severity: number;
  readonly direction: string;
}

export interface AppraisalPostClarity {
  readonly active: boolean;
  readonly agencyDeficit: number;
  readonly isRelapse: boolean;
  readonly recoveryPath: 'SPIRAL' | 'SUBSTITUTE' | 'UNKNOWN';
}

export interface AppraisalIntervention {
  readonly toneMode: string;
  readonly pacingMode: string;
  readonly validationMode: string;
  readonly actionMode: string;
  readonly interruptionLevel: 0 | 1 | 2 | 3;
  readonly guardrails: readonly string[];
}

export interface AppraisalResult {
  readonly timestamp: number;
  readonly family: Readonly<AppraisalFamily>;
  readonly pressure: Readonly<AppraisalPressure>;
  readonly mood: Readonly<AppraisalMood>;
  readonly escalation: Readonly<AppraisalEscalation>;
  readonly collapse: Readonly<AppraisalCollapse>;
  readonly postClarity: Readonly<AppraisalPostClarity>;
  readonly intervention: Readonly<AppraisalIntervention>;
}
