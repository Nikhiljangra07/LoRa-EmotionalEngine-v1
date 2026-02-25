import type { EIVTier } from '../scorers/eivTiers';
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
}
