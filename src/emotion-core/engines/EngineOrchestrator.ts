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
  generateResponse(
    prompt: string,
    options?: { signal?: AbortSignal; requestId?: string }
  ): Promise<string>;
};

const DEFAULT_LLM_CONFIG: LLMConfig = {
  maxResponseMs: 2500,
  maxAttempts: 2,
  cooldownMs: 30000,
};

/** Per-request abort timeout (env-configurable, default 12 s). */
const llmTimeoutMs = Math.max(
  1000,
  parseInt(process.env.LORA_LLM_TIMEOUT_MS || '', 10) || 12000
);

import { writeSessionTrace } from '../../debug/sessionTrace';

export class EngineOrchestrator {
  private etvState: ETVState;
  private sessionEIVs: number[] = [];
  private sessionHasViolation = false;
  private messageCount = 0;

  private readonly interpreter: EmotionalStateInterpreter;

  private responder?: LLMResponder;
  private llmAvailability: LLMAvailability = 'AVAILABLE';
  private llmCooldownUntil: number | null = null;
  private llmCooldownStartedAt: number | null = null;
  private readonly llmConfig: LLMConfig;
  private readonly responderFactory: () => LLMResponder;

  private activeExecution?: symbol;
  private lastDecision?: {
    eiv: ReturnType<typeof EIVScorer.calculate>;
    prompt: string;
    llmOutput: string;
  };

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
    this.interpreter = new EmotionalStateInterpreter();
  }

  // ---------------------------------------------------
  // Message-level processing (FULL PIPELINE)
  // ---------------------------------------------------
  async processMessage(
    analyzerOutputs: AnalyzerOutputs,
    emotionalStateOverride?: EmotionalState,
    hasViolation: boolean = false,
    flags: {
      ambiguityDetected?: boolean;
    } = {},
    userFeedback?: 'positive' | 'neutral' | 'negative',
    signalPacket?: SignalPacket
  ) {
    const executionToken = Symbol('LLM_EXECUTION');
    if (this.activeExecution) {
      return this.lastDecision!;
    }
    this.activeExecution = executionToken;

    try {
    this.messageCount += 1;

    // 1. Assemble EIV components
    const components =
      EIVComponentAssembler.assemble(analyzerOutputs);

    // 2. Calculate EIV — ONCE per message (single source of truth)
    const eivResult = EIVScorer.calculate(components);

    // 3. Derive emotional state (or use override for test backward compat)
    const interpreted = this.interpreter.interpret(analyzerOutputs, eivResult.value);
    const emotionalState: EmotionalState = emotionalStateOverride ?? {
      dominant: 'NEUTRAL',
      arousal: interpreted.arousal,
      valence: interpreted.valence,
      confidence: analyzerOutputs.valence.confidence,
    };

    // 4. Track session (bounded ring buffer)
    this.sessionEIVs.push(eivResult.value);
    const maxEntries = MASTER_CONSTANTS.engineDefaults.maxSessionEIVEntries;
    while (this.sessionEIVs.length > maxEntries) {
      this.sessionEIVs.shift();
    }
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

    const summaryForLog = analyzerSummary ?? {
      emojiUsed: undefined,
      capsUsed: undefined,
      punctuationUsed: undefined,
      repetitionDetected: undefined,
    };

    // 5. Message-level decision context (pre-LLM)
    let guidanceMode: PromptProfile['guidanceMode'] =
      emotionalState.arousal === 'LOW'
        ? 'CALM_NEUTRAL'
        : emotionalState.valence === 'NEGATIVE'
        ? 'VALIDATING'
        : 'ENERGY_MATCH';

    const momentum = this.interpreter.momentum;

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

    if (debugEnabled) {
      console.log('[LoRa::Audit][Engine]', {
        userText: userMessage,
        emotionalState,
        eiv: {
          value: eivResult.value,
          tier: getEIVTier(eivResult.value),
        },
        promptProfile: { guidanceMode },
      });
    }

    // 6. Build prompt (PURE)
    const prompt = PromptTemplateBuilder.build(emotionalState, this.etvState, {
      guidanceMode,
      momentumConfidence: momentum.confidence,
      answerFirst: allowAnswerFirst,
      microContext,
    });

    const llmInput = userMessage
      ? `${prompt}\n\nUSER MESSAGE:\n${userMessage}`
      : prompt;

    if (debugEnabled) {
      console.log('[LoRa::Audit][Prompt]', llmInput);
    }

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

    // 6. Generate LLM response (FAIL-SAFE, single owner)
    const llmOutput = await this.generateLLMResponse(
      llmInput,
      decision,
      fallbackContext
    );

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

    if (debugEnabled && signalPacket) {
      console.log('[LoRa::SignalPacket]', JSON.stringify(signalPacket));
    }

    if (debugEnabled) {
      writeSessionTrace(`session-${this.etvState.lastUpdated}`, {
        timestamp: Date.now(),
        etv: this.etvState.value,
        eiv: eivResult.value,
        emotionalState,
        prompt,
        llmOutput,
      });
    }

    const result = {
      eiv: eivResult,
      prompt,
      llmOutput,
    };

    this.lastDecision = result;
    return result;
    } finally {
      if (this.activeExecution === executionToken) {
        this.activeExecution = undefined;
      }
    }
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
          return EngineOrchestrator.generateFallbackReply(fallbackContext);
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
    let attempts = 0;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attempts = attempt;
      const requestId = `msg-${this.messageCount}-a${attempt}`;

      // AbortController cancels the real HTTP request on timeout
      // (prevents orphaned requests that cause duplicate success logs).
      let timedOut = false;
      const controller = new AbortController();
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, llmTimeoutMs);

      try {
        if (debugEnabled) {
          console.log('[LoRa::Audit][LLM]', {
            path: 'real_llm_attempt',
            attempt,
            maxAttempts,
            requestId,
            timeoutMs: llmTimeoutMs,
          });
        }
        const response = await this.getResponder().generateResponse(prompt, {
          signal: controller.signal,
          requestId,
        });
        clearTimeout(timer);
        return response;
      } catch (err) {
        clearTimeout(timer);
        lastError = err;
        const retryable = EngineOrchestrator.isRetryableError(err, timedOut);
        if (debugEnabled) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const status =
            (err as any)?.status ?? (err as any)?.statusCode ?? 'N/A';
          let bodySnippet = 'N/A';
          try {
            const raw =
              (err as any)?.response?.body ??
              (err as any)?.error?.message ??
              (err as any)?.body;
            if (raw) bodySnippet = String(raw).slice(0, 300);
          } catch {
            /* ignore */
          }
          console.log('[LoRa::Debug][LLM] attempt_failed', {
            requestId,
            attempt,
            error: errMsg,
            status,
            bodySnippet,
            timedOut,
            retryable,
          });
        }
        // Non-retryable errors (401/403/404/422) → stop immediately
        if (!retryable) break;
        // Jitter backoff (100-300 ms) before next attempt
        if (attempt < maxAttempts) {
          const jitter = Math.floor(Math.random() * 200) + 100;
          await new Promise<void>((r) => setTimeout(r, jitter));
        }
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
    if (debugEnabled && lastError instanceof Error) {
      console.log('[LoRa::Debug][LLM] retry_exhausted_error', {
        message: lastError.message,
        status: (lastError as any)?.status ?? 'N/A',
      });
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

  /**
   * Retry only on timeout / network / 429 / 5xx.
   * Never retry auth (401/403), not-found (404), or bad-request (422).
   */
  private static isRetryableError(err: unknown, timedOut: boolean): boolean {
    if (timedOut) return true;
    const status =
      (err as any)?.status ?? (err as any)?.statusCode;
    if (typeof status === 'number') {
      if (
        status === 401 ||
        status === 403 ||
        status === 404 ||
        status === 422
      )
        return false;
      if (status === 429 || status >= 500) return true;
    }
    // Network errors (no HTTP status) are transient → retryable
    return true;
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