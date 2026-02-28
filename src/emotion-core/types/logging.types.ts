// src/emotion-core/types/logging.types.ts

export type EIVTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';

export type PacingHint = 'SLOW' | 'NORMAL' | 'FAST';

export type ValidationIntensity = 'LOW' | 'MEDIUM' | 'HIGH';

export type ToneHint = 'GENTLE' | 'FIRM';

export type ValidationHint = 'LIGHT' | 'STRONG';

export type ActionHint =
  | 'ASK_ONE_QUESTION'
  | 'OFFER_STEPS'
  | 'ENCOURAGE_BREATH'
  | 'SUGGEST_BREAK'
  | 'NO_ACTION';

export type InterruptHint = 'SOFT' | 'FIRM' | 'HARD_STOP';

export type StepHint = 'ONE_STEP' | 'TWO_STEPS';

export type QuestionBudgetHint = 'ZERO' | 'ONE';

export interface AnalyzerSummary {
  emojiUsed: boolean;
  capsUsed: boolean;
  punctuationUsed: boolean;
  repetitionDetected: boolean;
}

export interface EmotionalStateSnapshot {
  arousal: 'LOW' | 'MEDIUM' | 'HIGH';
  valence: 'NEUTRAL' | 'POSITIVE' | 'NEGATIVE';
}

export interface PromptConstraints {
  maxInitiative: number;
  maxDepth: number;
  assertiveness: number;
  personalizationStrength: number;
  clarificationBias: number;
  maxResponseTokens: number;
  band: string;
}

export type VolatilityState = 'LOW' | 'MEDIUM' | 'HIGH';

export interface PromptProfile {
  relationshipStyle: 'PROFESSIONAL' | 'FRIENDLY' | 'CASUAL';
  guidanceMode:
    | 'CALM_NEUTRAL'
    | 'ENERGY_MATCH'
    | 'VALIDATING'
    | 'DE_ESCALATE'
    | 'SUPPORTIVE'
    | 'STABILIZE'
    | 'SUPPORTIVE_REFLECTION'
    | 'STABILIZING'
    | 'CONTAINMENT'
    | 'FALLBACK';
  promptConstraints?: PromptConstraints;
}

export interface MessageDecisionLog {
  messageId: string;
  timestamp: number;

  analyzerSummary: AnalyzerSummary;

  eiv: {
    value: number;
    tier: EIVTier;
  };

  emotionalState: EmotionalStateSnapshot;

  promptProfile: PromptProfile;

  flags: {
    safetyTriggered: boolean;
    ambiguityDetected: boolean;
  };

  avi?: {
    value: number;
    state: VolatilityState;
  };

  ekman?: {
    dominant: string;
    confidence: number;
  };

  lpi?: {
    raw: number;
    smoothed: number;
    maskedPressure: boolean;
  };
  maskedPressurePersistent?: boolean;
  volatilityTrend?: 'RISING' | 'FALLING' | 'STABLE';
  gradientEscalation?: {
    state: string;
    numericLevel: number;
    trend: 'UP' | 'DOWN' | 'FLAT';
  };
  ekmanInfluenceApplied?: boolean;

  llmOutput?: string;
  userReaction?: 'positive' | 'neutral' | 'negative';
}

export interface SessionLog {
  sessionId: string;
  startETV: number;
  endETV: number;
  meanSessionEIV: number;
  violationOccurred: boolean;
  messageCount: number;
  endedAt: number;
}
