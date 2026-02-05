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
import type { SignalPacket } from '../types/SignalPacket.types';
import { PromptTemplateBuilder } from '../prompt/PromptTemplateBuilder';
import { DecisionLogger } from '../logging/DecisionLogger';
import type { MessageDecisionLog } from '../logging/DecisionLogger';
import { OpenAIResponder } from '../llm/OpenAIResponder';
import { EmotionalStateInterpreter } from '../processors/EmotionalStateInterpreter';
import { MOMENTUM_CONSTANTS } from '../config/momentum.constants';
import type { PromptProfile } from '../types/logging.types';
import { debugEnabled } from '../debug/debugGate';

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
  private llmCooldownStartedAt: number | null = null;
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
    userFeedback?: 'positive' | 'neutral' | 'negative',
    signalPacket?: SignalPacket
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

    const analyzerSummary = (
      signalPacket?.metadata as
        | {
            analyzerSummary?: {
              emojiUsed?: boolean;
              capsUsed?: boolean;
              punctuationUsed?: boolean;
              repetitionDetected?: boolean;
            };
            microContext?: string;
          }
        | undefined
    )?.analyzerSummary;

    // 6. Analyzer presence summary (v1-safe)
    const summaryForLog = analyzerSummary ?? {
      emojiUsed: undefined,
      capsUsed: undefined,
      punctuationUsed: undefined,
      repetitionDetected: undefined,
    };

    // 4. Message-level decision context (pre-LLM)
    let guidanceMode: PromptProfile['guidanceMode'] =
      emotionalState.arousal === 'LOW'
        ? 'CALM_NEUTRAL'
        : emotionalState.valence === 'NEGATIVE'
        ? 'VALIDATING'
        : 'ENERGY_MATCH';

    const momentum = EmotionalStateInterpreter.momentum;

    // Bias guidance mode (do NOT override)
    if (
      momentum.confidence >
      MOMENTUM_CONSTANTS.guidanceBias.confidenceMinExclusive
    ) {
      if (
        momentum.arousalBias >
        MOMENTUM_CONSTANTS.guidanceBias.arousalHighMinExclusive
      ) {
        guidanceMode = 'ENERGY_MATCH';
      } else if (
        momentum.valenceBias <
        MOMENTUM_CONSTANTS.guidanceBias.valenceNegativeMaxExclusive
      ) {
        guidanceMode = 'DE_ESCALATE';
      }
    }

    const userMessage = signalPacket?.messageText ?? '';
    const normalizedUserMessage = userMessage.toLowerCase();
    const questionPatterns = [
      'should i',
      'what do you think',
      'what would you do',
      'how do i',
      "what's your take",
      'whats your take',
    ];
    const isQuestion =
      normalizedUserMessage.includes('?') ||
      questionPatterns.some((pattern) =>
        normalizedUserMessage.includes(pattern)
      );
    const allowAnswerFirst =
      isQuestion &&
      momentum.confidence >=
        MASTER_CONSTANTS.momentum.answerFirst.confidenceMinInclusive &&
      !hasViolation &&
      !flags.ambiguityDetected;

    const microContext = (
      signalPacket?.metadata as { microContext?: string } | undefined
    )?.microContext;

    // 5. Build prompt (PURE)
    const prompt = PromptTemplateBuilder.build(emotionalState, this.etvState, {
      guidanceMode,
      momentumConfidence: momentum.confidence,
      answerFirst: allowAnswerFirst,
      microContext,
    });

    const llmInput = userMessage
      ? `${prompt}\n\nUSER MESSAGE:\n${userMessage}`
      : prompt;

    const decision = {
      eiv: {
        confidence: Math.min(
          eivResult.components.expressionStrength.confidence,
          eivResult.components.valence.confidence,
          eivResult.components.arousal.confidence
        ),
      },
      promptProfile: {
        guidanceMode,
      },
    };

    const fallbackContext = {
      userText: userMessage,
      microContext,
      guidanceMode,
      analyzerSummary: summaryForLog as {
        emojiUsed: boolean;
        capsUsed: boolean;
        punctuationUsed: boolean;
        repetitionDetected: boolean;
      },
      emotionalState: {
        arousal: emotionalState.arousal,
        valence: emotionalState.valence,
      },
      flags: {
        safetyTriggered: hasViolation,
        ambiguityDetected: flags.ambiguityDetected ?? false,
      },
    };

    // 6. Generate LLM response (FAIL-SAFE)
    let llmInvoked = false;
    let cachedOutput: string | null = null;
    const llmOutput = await (async () => {
      if (llmInvoked && cachedOutput !== null) {
        return cachedOutput;
      }
      llmInvoked = true;
      cachedOutput = await this.generateLLMResponse(
        llmInput,
        decision,
        fallbackContext
      );

      return cachedOutput;
    })();

    // 7. Message-level decision logging
    const relationshipStyle: PromptProfile['relationshipStyle'] =
      this.etvState.value <
      MASTER_CONSTANTS.stateClassification.relationshipStyle
        .professionalMaxExclusive
        ? 'PROFESSIONAL'
        : this.etvState.value <
          MASTER_CONSTANTS.stateClassification.relationshipStyle
            .friendlyMaxExclusive
        ? 'FRIENDLY'
        : 'CASUAL';

    const decisionPayload: MessageDecisionLog = {
      messageId: `msg-${this.messageCount}`,
      timestamp: Date.now(),

      analyzerSummary: summaryForLog as {
        emojiUsed: boolean;
        capsUsed: boolean;
        punctuationUsed: boolean;
        repetitionDetected: boolean;
      },

      eiv: {
        value: eivResult.value,
        tier: getEIVTier(eivResult.value),
      },

      emotionalState: {
        arousal: emotionalState.arousal,
        valence: emotionalState.valence,
      },

      promptProfile: {
        relationshipStyle,
        guidanceMode,
      },

      flags: {
        safetyTriggered: hasViolation,
        ambiguityDetected: flags.ambiguityDetected ?? false,
      },

      llmOutput,
      userFeedback,
    };
    DecisionLogger.logMessageDecision(
      (debugEnabled && microContext
        ? ({ ...decisionPayload, microContext } as MessageDecisionLog & {
            microContext: string;
          })
        : decisionPayload) as MessageDecisionLog
    );

    if (process.env.LORA_DEBUG === 'true' && signalPacket) {
      console.log('[LoRa::SignalPacket]', JSON.stringify(signalPacket));
    }

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
    prompt: string,
    decision: {
      eiv: { confidence: number };
      promptProfile: { guidanceMode: PromptProfile['guidanceMode'] };
    },
    fallbackContext: {
      userText: string;
      microContext?: string;
      guidanceMode: PromptProfile['guidanceMode'];
      analyzerSummary: {
        emojiUsed: boolean;
        capsUsed: boolean;
        punctuationUsed: boolean;
        repetitionDetected: boolean;
      };
      emotionalState: {
        arousal: EmotionalState['arousal'];
        valence: EmotionalState['valence'];
      };
      flags: {
        safetyTriggered: boolean;
        ambiguityDetected: boolean;
      };
    }
  ): Promise<string> {
    const now = Date.now();
    if (this.llmAvailability === 'UNAVAILABLE') {
      if (
        this.llmCooldownUntil !== null &&
        now >= this.llmCooldownUntil
      ) {
        this.llmAvailability = 'AVAILABLE';
        this.llmCooldownUntil = null;
        this.llmCooldownStartedAt = null;
        this.logLLMEvent('cooldown_exit');
      } else {
        if (!debugEnabled) {
          this.logLLMEvent('cooldown_active', {
            cooldownUntil: this.llmCooldownUntil,
          });
          this.logLLMEvent('fallback_used', { reason: 'cooldown' });
          return EngineOrchestrator.fallbackResponse();
        }
        const normalizedUserText = fallbackContext.userText.toLowerCase();
        const quickQuestionPatterns = [
          'should i',
          'what do you think',
          'what would you do',
          'how do i',
        ];
        const shouldAttemptDuringCooldown =
          normalizedUserText.includes('?') ||
          quickQuestionPatterns.some((pattern) =>
            normalizedUserText.includes(pattern)
          ) ||
          fallbackContext.userText.length <=
            MASTER_CONSTANTS.llm.quickMessageMaxChars ||
          (this.llmCooldownStartedAt !== null &&
            this.llmCooldownUntil !== null &&
            now >=
              this.llmCooldownStartedAt +
                (this.llmCooldownUntil - this.llmCooldownStartedAt) *
                  MASTER_CONSTANTS.llm.cooldownRetryRecoveryRatio);

        if (!shouldAttemptDuringCooldown) {
          this.logLLMEvent('cooldown_active', {
            cooldownUntil: this.llmCooldownUntil,
          });
          this.logLLMEvent('fallback_used', { reason: 'cooldown' });
          return debugEnabled
            ? EngineOrchestrator.generateFallbackReply(fallbackContext)
            : EngineOrchestrator.fallbackResponse();
        }
      }
    }

    const isHighConfidence =
      decision.eiv.confidence >=
        MASTER_CONSTANTS.llm.retryConfidenceThreshold &&
      decision.promptProfile.guidanceMode !== 'FALLBACK';
    const configuredRetries = Math.max(0, this.llmConfig.maxAttempts - 1);
    const maxRetries = isHighConfidence
      ? 0
      : Math.min(MASTER_CONSTANTS.llm.maxRetries, configuredRetries);
    const maxAttempts = Math.max(1, maxRetries + 1);
    const firstAttemptTimeoutMs = Math.min(
      this.llmConfig.maxResponseMs,
      Math.round(
        this.llmConfig.maxResponseMs *
          MASTER_CONSTANTS.llm.firstAttemptTimeoutRatio
      )
    );
    const retryTimeoutMs = this.llmConfig.maxResponseMs;
    let attempts = 0;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attempts = attempt;
      try {
        const response = await this.withTimeout(
          this.getResponder().generateResponse(prompt),
          attempt === 1 ? firstAttemptTimeoutMs : retryTimeoutMs
        );
        return response;
      } catch (err) {
        lastError = err;
      }
    }

    if (attempts > 1) {
      this.logLLMEvent('retry_summary', { attempts });
    }
    this.llmAvailability = 'UNAVAILABLE';
    this.llmCooldownStartedAt = now;
    const cooldownMs = debugEnabled
      ? Math.round(
          this.llmConfig.cooldownMs *
            MASTER_CONSTANTS.llm.cooldownSoftFactor
        )
      : this.llmConfig.cooldownMs;
    this.llmCooldownUntil = now + cooldownMs;
    this.logLLMEvent('cooldown_entry', {
      cooldownUntil: this.llmCooldownUntil,
    });
    if (lastError instanceof Error) {
      void lastError;
    }
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
    if (!debugEnabled) {
      return;
    }
    console.log('[LoRa::LLM]', JSON.stringify({ event, ...details }));
  }

  private static fallbackResponse(): string {
    return 'I’m here with you. Let’s take this one step at a time.';
  }

  private static generateFallbackReply(params: {
    userText: string;
    microContext?: string;
    guidanceMode: PromptProfile['guidanceMode'];
    analyzerSummary: {
      emojiUsed: boolean;
      capsUsed: boolean;
      punctuationUsed: boolean;
      repetitionDetected: boolean;
    };
    emotionalState: {
      arousal: EmotionalState['arousal'];
      valence: EmotionalState['valence'];
    };
    flags: {
      safetyTriggered: boolean;
      ambiguityDetected: boolean;
    };
  }): string {
    const normalized = params.userText.toLowerCase();
    const questionPatterns = [
      'should i',
      'what do you think',
      'what would you do',
      'how do i',
    ];
    const isQuestion =
      normalized.includes('?') ||
      questionPatterns.some((pattern) => normalized.includes(pattern));

    const strongExpressivity =
      params.analyzerSummary.capsUsed ||
      params.analyzerSummary.punctuationUsed ||
      params.analyzerSummary.repetitionDetected ||
      params.analyzerSummary.emojiUsed;
    const isHighArousal = params.emotionalState.arousal === 'HIGH';
    const isNegative = params.emotionalState.valence === 'NEGATIVE';
    const isPositive = params.emotionalState.valence === 'POSITIVE';

    if (isQuestion) {
      return [
        "I'd start with a single next step you can finish today, then review what still feels uncertain.",
        "What part of the decision feels most stuck right now?",
      ].join(' ');
    }

    if ((isHighArousal || strongExpressivity) && isNegative) {
      return [
        "That sounds really heavy. Two things to try: take a brief pause to reset your breathing, then pick one small action you can control right now.",
        "What would feel like the smallest relief today?",
      ].join(' ');
    }

    if (isHighArousal && isPositive) {
      return [
        "That sounds exciting. What's the next moment you're most looking forward to?",
      ].join(' ');
    }

    return [
      "I hear you. What's the one part you'd like to focus on next?",
    ].join(' ');
  }
}