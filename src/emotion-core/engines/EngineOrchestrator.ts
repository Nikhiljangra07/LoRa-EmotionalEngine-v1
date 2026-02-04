import { EIVScorer } from '../scorers/EIVScorer';
import { getEIVTier } from '../scorers/eivTiers';
import { ETVEngine } from './ETVEngine';
import { ETVState } from '../types/etv.types';
import { MASTER_CONSTANTS } from '../config/master.constants';
import {
  EIVComponentAssembler,
  AnalyzerOutputs,
} from '../processors/EIVComponentAssembler';
import { EmotionalState } from '../types/analysis.types';
import { PromptTemplateBuilder } from '../prompt/PromptTemplateBuilder';
import { DecisionLogger } from '../logging/DecisionLogger';
import { OpenAIResponder } from '../llm/OpenAIResponder';

// 🔹 BETA-ONLY TRACE
import { writeSessionTrace } from '../../debug/sessionTrace';

export class EngineOrchestrator {
  private etvState: ETVState;
  private sessionEIVs: number[] = [];
  private sessionHasViolation = false;
  private messageCount = 0;

  // 🔹 LLM boundary (single responsibility)
  private responder = new OpenAIResponder();

  constructor(
    initialETV: number = MASTER_CONSTANTS.engineDefaults.initialETV
  ) {
    this.etvState = {
      value: initialETV,
      sessionEIVs: [],
      messageCount: 0,
      lastUpdated: Date.now(),
    };
  }

  // ---------------------------------------------------
  // Message-level processing (FULL PIPELINE)
  // ---------------------------------------------------
  async processMessage(
    analyzerOutputs: AnalyzerOutputs,
    emotionalState: EmotionalState,
    hasViolation: boolean = false,
    flags: {
      ambiguityDetected?: boolean;
    } = {},
    userFeedback?: 'positive' | 'neutral' | 'negative'
  ) {
    this.messageCount += 1;

    // 1. Assemble EIV components (SAFE)
    const components =
      EIVComponentAssembler.assemble(analyzerOutputs);

    // 2. Calculate EIV (NaN-proof)
    const eivResult = EIVScorer.calculate(components);

    // 3. Track session
    this.sessionEIVs.push(eivResult.value);
    this.sessionHasViolation ||= hasViolation;

    // 4. Build prompt (PURE)
    const prompt = PromptTemplateBuilder.build(
      emotionalState,
      this.etvState
    );

    // 5. Generate LLM response (FAIL-SAFE)
    let llmOutput = '';
    try {
      llmOutput = await this.responder.generateResponse(prompt);
    } catch (err) {
      llmOutput =
        'I’m here with you. Let’s take this one step at a time.';
      console.error('[LoRa::LLMError]', err);
    }

    const hasLowConfidenceSignal =
      analyzerOutputs.expressionStrength.confidence <
        MASTER_CONSTANTS.layer1.degradation.confidenceThreshold ||
      analyzerOutputs.valence.confidence <
        MASTER_CONSTANTS.layer1.degradation.confidenceThreshold ||
      analyzerOutputs.arousal.confidence <
        MASTER_CONSTANTS.layer1.degradation.confidenceThreshold;

    const shouldDegrade = hasLowConfidenceSignal;

    // 6. Analyzer presence summary (v1-safe)
    const analyzerSummary = {
      emojiUsed: shouldDegrade,
      capsUsed: shouldDegrade,
      punctuationUsed: shouldDegrade,
      repetitionDetected: shouldDegrade,
    };

    // 7. Message-level decision logging
    DecisionLogger.logMessageDecision({
      messageId: `msg-${this.messageCount}`,
      timestamp: Date.now(),

      analyzerSummary,

      eiv: {
        value: eivResult.value,
        tier: getEIVTier(eivResult.value),
      },

      emotionalState: {
        arousal: emotionalState.arousal,
        valence: emotionalState.valence,
      },

      promptProfile: {
        relationshipStyle:
          this.etvState.value <
          MASTER_CONSTANTS.stateClassification.relationshipStyle
            .professionalMaxExclusive
            ? 'PROFESSIONAL'
            : this.etvState.value <
              MASTER_CONSTANTS.stateClassification.relationshipStyle
                .friendlyMaxExclusive
            ? 'FRIENDLY'
            : 'CASUAL',

        guidanceMode:
          emotionalState.arousal === 'LOW'
            ? 'CALM_NEUTRAL'
            : emotionalState.valence === 'NEGATIVE'
            ? 'VALIDATING'
            : 'ENERGY_MATCH',
      },

      flags: {
        safetyTriggered: hasViolation,
        ambiguityDetected: flags.ambiguityDetected ?? false,
      },

      llmOutput,
      userFeedback,
    });

    // 8. Session trace (DEBUG / BETA ONLY)
    writeSessionTrace(`session-${this.etvState.lastUpdated}`, {
      timestamp: Date.now(),
      etv: this.etvState.value,
      eiv: eivResult.value,
      emotionalState,
      prompt,
      llmOutput,
    });

    return {
      eiv: eivResult,
      prompt,
      llmOutput,
    };
  }

  // ---------------------------------------------------
  // Session boundary (ETV updates ONLY here)
  // ---------------------------------------------------
  endSession() {
    if (this.sessionEIVs.length === 0) {
      return { newETV: this.etvState.value };
    }

    const sessionMean =
      this.sessionEIVs.reduce((a, b) => a + b, 0) /
      this.sessionEIVs.length;

    const previousETV = this.etvState.value;

    const newETV = ETVEngine.updateETV(
      previousETV,
      sessionMean,
      this.sessionHasViolation
    );

    DecisionLogger.logSessionEnd({
      sessionId: `session-${this.etvState.lastUpdated}`,
      startETV: previousETV,
      endETV: newETV,
      meanSessionEIV: sessionMean,
      violationOccurred: this.sessionHasViolation,
      messageCount: this.messageCount,
      endedAt: Date.now(),
    });

    // Reset session
    this.etvState = {
      value: newETV,
      sessionEIVs: [],
      messageCount: 0,
      lastUpdated: Date.now(),
    };

    this.sessionEIVs = [];
    this.sessionHasViolation = false;
    this.messageCount = 0;

    return { newETV };
  }

  // ---------------------------------------------------
  // Read-only access
  // ---------------------------------------------------
  getState() {
    return { ...this.etvState };
  }
}