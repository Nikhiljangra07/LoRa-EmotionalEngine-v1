import type { EIVTier } from '../scorers/eivTiers';
import type { PacingHint, ValidationIntensity, ToneHint, ValidationHint, ActionHint, InterruptHint, StepHint, QuestionBudgetHint } from '../types/logging.types';
import { decisionLogEnabled } from '../debug/debugGate';

export interface MessageDecisionLog {
  messageId: string;
  timestamp: number;

  analyzerSummary: {
    emojiUsed: boolean;
    capsUsed: boolean;
    punctuationUsed: boolean;
    repetitionDetected: boolean;
  };

  eiv: {
    value: number;
    tier: EIVTier;
  };

  emotionalState: {
    arousal: 'LOW' | 'MEDIUM' | 'HIGH';
    valence: 'NEUTRAL' | 'POSITIVE' | 'NEGATIVE';
  };

  promptProfile: {
    relationshipStyle: 'PROFESSIONAL' | 'FRIENDLY' | 'CASUAL';
    guidanceMode:
      | 'CALM_NEUTRAL'
      | 'ENERGY_MATCH'
      | 'VALIDATING'
      | 'DE_ESCALATE'
      | 'SUPPORTIVE'
      | 'STABILIZE'
      | 'SUPPORTIVE_REFLECTION'
      | 'FALLBACK';
  };

  flags: {
    safetyTriggered: boolean;
    ambiguityDetected: boolean;
  };

  // 🔹 NEW — optional, beta-only behavioral signals
  llmOutput?: string;
  userFeedback?: 'positive' | 'neutral' | 'negative';

  appraisal?: {
    escalationLevel: number;
    escalationScore: number;
    pressureScalar: number;
    pressureSlope: number;
    moodCategory: string;
    collapseEvent: boolean;
    postClarityActive: boolean;
    interventionToneMode: string;
    interventionPacingMode: string;
  };

  appraisalOverride?: string;
  pacingHint?: PacingHint;
  validationIntensity?: ValidationIntensity;
  toneHint?: ToneHint;
  validationHint?: ValidationHint;
  actionHint?: ActionHint;
  interruptHint?: InterruptHint;
  stepHint?: StepHint;
  questionBudgetHint?: QuestionBudgetHint;
  driftDetected?: true;
  overrideCooldownActive?: true;
  guidanceDwellActive?: true;
  guidanceDwellMode?: 'STABILIZE' | 'DE_ESCALATE';
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

export interface ETVUpdateLogPayload {
  userId: string;
  sessionId: string;
  deltaHours: number;
  decay: number;
  z_t: number;
  evidenceMass: number;
  r_before: number;
  s_before: number;
  r_after: number;
  s_after: number;
  etvMean: number;
  etvVar: number;
  band: string;
  timestamp: number;
  effectiveN?: number;
  riskAdjusted?: number;
  conf?: number;
  messageCount?: number;
  eivMean?: number;
  aviMean?: number;
}

export class DecisionLogger {
  /**
   * Message-level decision logging
   * --------------------------------
   * Logs ONE record per user message.
   */
  static logMessageDecision(payload: MessageDecisionLog): void {
    // V1: console / file logging
    // V2: SQLite
    // V3: analytics pipeline

    if (!decisionLogEnabled) return;
    console.log('[LoRa::MessageDecision]', JSON.stringify(payload));
  }

  /**
   * Session-level logging
   * ---------------------
   * Logs ONCE per session end.
   */
  static logSessionEnd(payload: SessionLog): void {
    if (!decisionLogEnabled) return;
    console.log('[LoRa::SessionEnd]', JSON.stringify(payload));
  }

  static logETVUpdate(payload: ETVUpdateLogPayload): void {
    if (!decisionLogEnabled) return;
    console.log('[LoRa::ETVUpdate]', JSON.stringify(payload));
  }

  static logETVUpdateV1(payload: ETVUpdateLogPayload): void {
    if (!decisionLogEnabled) return;
    console.log('[LoRa::ETVUpdateV1]', JSON.stringify(payload));
  }
}
