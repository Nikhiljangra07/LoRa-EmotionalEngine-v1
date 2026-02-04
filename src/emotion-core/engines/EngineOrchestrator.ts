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

type LLMAvailability = 'AVAILABLE' | 'UNAVAILABLE';

type LLMConfig = {
  maxResponseMs: number;
  maxAttempts: number;
  cooldownMs: number;
};

type LLMResponder = {
  generateResponse(prompt: string): Promise<string>;
};

const DEFAULT_LLM_CONFIG: LLMConfig = {
  maxResponseMs: 2500,
  maxAttempts: 2,
  cooldownMs: 30000,
};

// 🔹 BETA-ONLY TRACE
import { writeSessionTrace } from '../../debug/sessionTrace';

export class EngineOrchestrator {
  private etvState: ETVState;
  private sessionEIVs: number[] = [];
  private sessionHasViolation = false;
  private messageCount = 0;

  // 🔹 LLM boundary (single responsibility)
  private responder?: LLMResponder;
  private llmAvailability: LLMAvailability = 'AVAILABLE';
  private llmCooldownUntil: number | null = null;
  private readonly llmConfig: LLMConfig;
  private readonly responderFactory: () => LLMResponder;

  constructor(
    initialETV: number = MASTER_CONSTANTS.engineDefaults.initialETV,
    llmConfig: Partial<LLMConfig> = {},
    responderFactory: () => LLMResponder = () =>
      new OpenAIResponder()
  ) {
    this.etvState = {
      value: initialETV,
      sessionEIVs: [],
      messageCount: 0,
      lastUpdated: Date.now(),
    };
    this.llmConfig = {
      ...DEFAULT_LLM_CONFIG,
      ...llmConfig,
    };
    this.responderFactory = responderFactory;
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
    const llmOutput = await this.generateLLMResponse(prompt);

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

  private getResponder(): LLMResponder {
    if (!this.responder) {
      this.responder = this.responderFactory();
    }
    return this.responder;
  }

  private async generateLLMResponse(
    prompt: string
  ): Promise<string> {
    const now = Date.now();
    if (this.llmAvailability === 'UNAVAILABLE') {
      if (
        this.llmCooldownUntil !== null &&
        now >= this.llmCooldownUntil
      ) {
        this.llmAvailability = 'AVAILABLE';
        this.llmCooldownUntil = null;
        this.logLLMEvent('cooldown_exit');
      } else {
        this.logLLMEvent('cooldown_active', {
          cooldownUntil: this.llmCooldownUntil,
        });
        this.logLLMEvent('fallback_used', { reason: 'cooldown' });
        return EngineOrchestrator.fallbackResponse();
      }
    }

    for (let attempt = 1; attempt <= this.llmConfig.maxAttempts; attempt += 1) {
      this.logLLMEvent('retry_attempt', { attempt });
      try {
        const response = await this.withTimeout(
          this.getResponder().generateResponse(prompt),
          this.llmConfig.maxResponseMs
        );
        return response;
      } catch (err) {
        this.logLLMEvent('retry_failed', {
          attempt,
          error: err instanceof Error ? err.message : 'unknown',
        });
      }
    }

    this.llmAvailability = 'UNAVAILABLE';
    this.llmCooldownUntil = now + this.llmConfig.cooldownMs;
    this.logLLMEvent('cooldown_entry', {
      cooldownUntil: this.llmCooldownUntil,
    });
    this.logLLMEvent('fallback_used', { reason: 'retry_exhausted' });
    return EngineOrchestrator.fallbackResponse();
  }

  private withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('LLM response timed out'));
      }, timeoutMs);

      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  private logLLMEvent(
    event: string,
    details: Record<string, unknown> = {}
  ) {
    console.log('[LoRa::LLM]', JSON.stringify({ event, ...details }));
  }

  private static fallbackResponse(): string {
    return 'I’m here with you. Let’s take this one step at a time.';
  }
}