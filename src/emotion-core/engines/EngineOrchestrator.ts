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
import type { PromptProfile, PacingHint, ValidationIntensity, ToneHint, ValidationHint, ActionHint, InterruptHint, StepHint, QuestionBudgetHint } from '../types/logging.types';
import { debugEnabled } from '../debug/debugGate';
import { featureFlags } from '../config/featureFlags';
import { AppraisalBridgeRunner } from '../../appraisal-bridge/AppraisalBridgeRunner';
import { resolveHints, type ResolvableHints } from './hintResolver';
import { applyHintStickiness, type StickyHints, type StickyHintKey } from './hintStickiness';
import { enforceHintSemanticCoherence } from './hintSemanticGuard';
import { mapLayerASnapshot } from '../../appraisal-bridge/mapLayerASnapshot';
import type { AppraisalResult } from '../../appraisal-bridge/types';
import { AVIScorer } from '../scorers/AVIScorer';
import { ETVEngineV1, SESSION_GAP_MS, buildSessionSummary } from '../etv';
import type { SessionSummaryV1 } from '../etv';

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
  private sessionAVIs: number[] = [];
  private sessionStartedAt: number = 0;
  private sessionHasViolation = false;
  private messageCount = 0;

  private readonly interpreter: EmotionalStateInterpreter;

  private responder?: LLMResponder;
  private llmAvailability: LLMAvailability = 'AVAILABLE';
  private llmCooldownUntil: number | null = null;
  private llmCooldownStartedAt: number | null = null;
  private readonly llmConfig: LLMConfig;
  private readonly responderFactory: () => LLMResponder;

  private readonly appraisalBridge?: AppraisalBridgeRunner;
  private lastMessageTimestampMs = 0;

  // ── Idempotent session-close guard (ETV V1) ──
  private sessionOpen = false;
  private currentSessionId: string | null = null;
  private lastClosedSessionId: string | null = null;

  private activeExecution?: symbol;
  private lastDecision?: {
    eiv: ReturnType<typeof EIVScorer.calculate>;
    prompt: string;
    llmOutput: string;
  };

  private readonly minimumMessagesForAdaptiveControl = 3;

  private overrideCooldownRemaining = 0;

  // ── Hint stickiness (hysteresis, gated by hintStickinessEnabled) ──
  private lastStickyHints: StickyHints = {};
  private hintHoldsRemaining: Partial<Record<StickyHintKey, number>> = {};

  // ── Guidance dwell lock (gated by guidanceDwellLockEnabled) ──
  private guidanceDwellRemaining: number = 0;
  private guidanceDwellMode: 'STABILIZE' | 'DE_ESCALATE' | null = null;

  // ── Drift monitor (observability-only, gated by driftMonitorEnabled) ──
  private readonly driftWindowSize = 10;
  private recentGuidanceModes: string[] = [];
  private recentPacingHints: (string | undefined)[] = [];
  private recentEscalationLevels: number[] = [];
  private driftWarningActive = false;

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
    if (featureFlags.appraisalBridgeEnabled) {
      this.appraisalBridge = new AppraisalBridgeRunner();
    }
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
    const messageTimestampMs = Date.now();

    // ── ETV V1: automatic session boundary detection ──
    if (featureFlags.etvV1Enabled && this.lastMessageTimestampMs > 0) {
      const idleMs = messageTimestampMs - this.lastMessageTimestampMs;
      if (idleMs > SESSION_GAP_MS) {
        this.endSession();
      }
    }

    if (this.messageCount === 0) {
      this.sessionStartedAt = messageTimestampMs;
      this.currentSessionId = `session-${messageTimestampMs}`;
      this.sessionOpen = true;
    }
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

    // ── ETV V1: compute and accumulate per-message AVI ──
    if (featureFlags.etvV1Enabled) {
      const avi = AVIScorer.computeAVI(this.sessionEIVs);
      this.sessionAVIs.push(avi);
      while (this.sessionAVIs.length > maxEntries) {
        this.sessionAVIs.shift();
      }
    }

    // Ensure lastMessageTimestampMs is always updated (session boundary
    // detection needs this even when the appraisal bridge is disabled).
    if (!this.appraisalBridge) {
      this.lastMessageTimestampMs = messageTimestampMs;
    }

    // ── Appraisal bridge (optional, feature-flagged) ────────────────
    let appraisalResult: AppraisalResult | undefined;
    if (this.appraisalBridge) {
      const deltaMs =
        this.lastMessageTimestampMs > 0
          ? messageTimestampMs - this.lastMessageTimestampMs
          : 0;
      this.lastMessageTimestampMs = messageTimestampMs;

      const snapshot = mapLayerASnapshot({
        messageIndex: this.messageCount,
        timestampMs: messageTimestampMs,
        deltaMessageSeconds: deltaMs / 1000,
        analyzerScalars: {
          valenceScore: analyzerOutputs.valence.score,
          valenceConfidence: analyzerOutputs.valence.confidence,
          arousalScore: analyzerOutputs.arousal.score,
          arousalConfidence: analyzerOutputs.arousal.confidence,
          expressionStrength: analyzerOutputs.expressionStrength.score,
          esConfidence: analyzerOutputs.expressionStrength.confidence,
        },
        eiv: { value: eivResult.value, tier: eivResult.breakdown.tier },
        emotionalState,
      });
      appraisalResult = this.appraisalBridge.step(snapshot);
    }

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

    // ── Appraisal-driven guidance override (Phase 1, feature-flagged) ──
    let appraisalOverride: string | undefined;
    let overrideCooldownActiveThisMessage = false;

    const cooldownEnabled =
      featureFlags.adaptiveOverrideCooldownEnabled &&
      featureFlags.appraisalBridgeModeEnabled;

    if (cooldownEnabled && this.overrideCooldownRemaining > 0) {
      this.overrideCooldownRemaining--;
      overrideCooldownActiveThisMessage = true;
    }

    if (
      featureFlags.appraisalBridgeModeEnabled &&
      appraisalResult &&
      this.messageCount >= this.minimumMessagesForAdaptiveControl &&
      !overrideCooldownActiveThisMessage
    ) {
      if (appraisalResult.collapse.event) {
        guidanceMode = 'STABILIZE';
        appraisalOverride = 'COLLAPSE_OVERRIDE';
      } else if (appraisalResult.escalation.level >= 2) {
        guidanceMode = 'DE_ESCALATE';
        appraisalOverride = 'ESCALATION_OVERRIDE';
      } else if (appraisalResult.postClarity.active) {
        guidanceMode = 'SUPPORTIVE_REFLECTION';
        appraisalOverride = 'POST_CLARITY_OVERRIDE';
      }

      if (appraisalOverride && cooldownEnabled) {
        this.overrideCooldownRemaining = 2;
      }
    }

    // ── Guidance dwell lock (feature-flagged) ──
    const collapseEventForDwell = !!(appraisalResult && appraisalResult.collapse.event);
    const dwellResult = this.applyGuidanceDwell(guidanceMode, collapseEventForDwell);
    guidanceMode = dwellResult.mode;

    // ── Phase 2: derived pacing hint (feature-flagged, SLOW only) ──
    // pacingHint stays undefined when the hint would be NORMAL,
    // so it is never passed to the builder in the neutral case.
    let pacingHint: PacingHint | undefined;
    if (
      featureFlags.appraisalBridgeModeEnabled &&
      featureFlags.appraisalPacingHintEnabled &&
      appraisalResult &&
      this.messageCount >= this.minimumMessagesForAdaptiveControl
    ) {
      if (guidanceMode === 'STABILIZE' || guidanceMode === 'DE_ESCALATE') {
        pacingHint = 'SLOW';
      } else if (appraisalResult.collapse.event) {
        pacingHint = 'SLOW';
      } else if (appraisalResult.escalation.level >= 2) {
        pacingHint = 'SLOW';
      } else if (
        appraisalResult.pressure.scalar >= 2.25 ||
        appraisalResult.pressure.volatility >= 1.2
      ) {
        pacingHint = 'SLOW';
      } else if (featureFlags.interventionPacingHintEnabled) {
        const pm = appraisalResult.intervention.pacingMode;
        if (pm === 'SLOW' || pm === 'DELAYED_RESPONSE' || pm === 'SHORT_DIRECT') {
          pacingHint = 'SLOW';
        }
        // 'NORMAL' and unknown → undefined (neutral = absent)
      }
      // else: stays undefined (NORMAL case — nothing passed to builder)
    }

    // ── Drift monitor: update rolling buffers + check ──
    let driftDetectedThisMessage = false;
    if (
      featureFlags.driftMonitorEnabled &&
      this.messageCount >= this.minimumMessagesForAdaptiveControl
    ) {
      this.recentGuidanceModes.push(guidanceMode);
      this.recentPacingHints.push(pacingHint);
      this.recentEscalationLevels.push(
        appraisalResult ? appraisalResult.escalation.level : 0,
      );

      while (this.recentGuidanceModes.length > this.driftWindowSize) {
        this.recentGuidanceModes.shift();
      }
      while (this.recentPacingHints.length > this.driftWindowSize) {
        this.recentPacingHints.shift();
      }
      while (this.recentEscalationLevels.length > this.driftWindowSize) {
        this.recentEscalationLevels.shift();
      }

      const unstable = this.checkDrift();
      if (unstable && !this.driftWarningActive) {
        console.warn('[DRIFT_MONITOR] Excessive strategy oscillation detected');
        this.driftWarningActive = true;
        driftDetectedThisMessage = true;
      }
      if (!unstable) {
        this.driftWarningActive = false;
      }
    }

    // ── validationIntensity: pure prompt overlay from existing signals ──
    let validationIntensity: ValidationIntensity | undefined;
    if (
      featureFlags.validationIntensityEnabled &&
      this.messageCount >= this.minimumMessagesForAdaptiveControl
    ) {
      if (eivResult.value >= 0.70 || emotionalState.arousal === 'HIGH') {
        validationIntensity = 'HIGH';
      } else if (eivResult.value >= 0.40) {
        validationIntensity = 'MEDIUM';
      }
      // LOW is suppressed — validationIntensity stays undefined
    }

    // ── ToneHint: derived prompt overlay (feature-flagged, present-or-absent) ──
    let toneHint: ToneHint | undefined;
    if (
      featureFlags.appraisalToneHintEnabled &&
      featureFlags.appraisalBridgeEnabled &&
      featureFlags.appraisalBridgeModeEnabled &&
      this.messageCount >= this.minimumMessagesForAdaptiveControl
    ) {
      if (guidanceMode === 'STABILIZE') {
        toneHint = 'GENTLE';
      } else if (guidanceMode === 'DE_ESCALATE') {
        toneHint = 'GENTLE';
      } else if (appraisalOverride) {
        toneHint = 'GENTLE';
      } else if (appraisalResult && appraisalResult.escalation.level >= 2) {
        toneHint = 'GENTLE';
      } else if (appraisalResult && appraisalResult.intervention.interruptionLevel >= 2) {
        toneHint = 'FIRM';
      } else if (featureFlags.interventionToneHintEnabled && appraisalResult) {
        const tm = appraisalResult.intervention.toneMode;
        if (tm === 'STABILIZE' || tm === 'DE_ESCALATE' || tm === 'REFLECTIVE' || tm === 'AFFIRM_BOUNDARIED') {
          toneHint = 'GENTLE';
        } else if (tm === 'FIRM_CONTAIN') {
          toneHint = 'FIRM';
        }
        // 'NEUTRAL' and unknown → undefined (absent)
      }
    }

    // ── ValidationHint: derived from intervention.validationMode (present-or-absent) ──
    let validationHint: ValidationHint | undefined;
    if (
      featureFlags.interventionValidationHintEnabled &&
      featureFlags.appraisalBridgeEnabled &&
      featureFlags.appraisalBridgeModeEnabled &&
      this.messageCount >= this.minimumMessagesForAdaptiveControl &&
      appraisalResult
    ) {
      if (guidanceMode === 'STABILIZE' || guidanceMode === 'DE_ESCALATE') {
        validationHint = 'STRONG';
      } else {
        const vm = appraisalResult.intervention.validationMode;
        if (vm === 'SUPPORTIVE') {
          validationHint = 'STRONG';
        } else if (vm === 'LIMITED' || vm === 'BOUNDARIED') {
          validationHint = 'LIGHT';
        }
        // 'STANDARD' and any other value → undefined (neutral = absent)
      }
    }

    // ── ActionHint: derived from intervention.actionMode (present-or-absent) ──
    let actionHint: ActionHint | undefined;
    if (
      featureFlags.interventionActionHintEnabled &&
      featureFlags.appraisalBridgeEnabled &&
      featureFlags.appraisalBridgeModeEnabled &&
      this.messageCount >= this.minimumMessagesForAdaptiveControl &&
      appraisalResult
    ) {
      const am = appraisalResult.intervention.actionMode;
      let candidate: ActionHint | undefined;
      if (am === 'ENCOURAGE_PAUSE') {
        candidate = 'ENCOURAGE_BREATH';
      } else if (am === 'SHIFT_TO_REFLECTION') {
        candidate = 'ASK_ONE_QUESTION';
      } else if (am === 'INTERRUPT_LOOP') {
        candidate = 'SUGGEST_BREAK';
      }
      // 'NONE' and unknown → undefined

      if (candidate !== undefined) {
        if (guidanceMode === 'STABILIZE') {
          if (candidate === 'ENCOURAGE_BREATH' || candidate === 'SUGGEST_BREAK') {
            actionHint = candidate;
          }
          // ASK_ONE_QUESTION / OFFER_STEPS blocked in STABILIZE
        } else if (guidanceMode === 'DE_ESCALATE') {
          if (candidate === 'ASK_ONE_QUESTION' || candidate === 'SUGGEST_BREAK') {
            actionHint = candidate;
          }
          // OFFER_STEPS / ENCOURAGE_BREATH blocked in DE_ESCALATE
        } else {
          actionHint = candidate;
        }
      }
    }

    // ── InterruptHint: derived from intervention.interruptionLevel (present-or-absent) ──
    let interruptHint: InterruptHint | undefined;
    if (
      featureFlags.interventionInterruptHintEnabled &&
      featureFlags.appraisalBridgeEnabled &&
      featureFlags.appraisalBridgeModeEnabled &&
      this.messageCount >= this.minimumMessagesForAdaptiveControl &&
      appraisalResult
    ) {
      const level = appraisalResult.intervention.interruptionLevel;
      if (level >= 3) {
        interruptHint = (guidanceMode === 'STABILIZE' || guidanceMode === 'DE_ESCALATE')
          ? 'FIRM'
          : 'HARD_STOP';
      } else if (level === 2) {
        interruptHint = 'FIRM';
      } else if (level === 1) {
        interruptHint = 'SOFT';
      }
      // level 0 → undefined (absent)
    }

    // ── StepHint: micro-step guard derived from actionMode (present-or-absent) ──
    let stepHint: StepHint | undefined;
    if (
      featureFlags.interventionStepHintEnabled &&
      featureFlags.appraisalBridgeEnabled &&
      featureFlags.appraisalBridgeModeEnabled &&
      this.messageCount >= this.minimumMessagesForAdaptiveControl &&
      appraisalResult
    ) {
      const am = appraisalResult.intervention.actionMode;
      if (am === 'SHIFT_TO_REFLECTION' || am === 'INTERRUPT_LOOP') {
        stepHint = 'ONE_STEP';
      }
      // 'ENCOURAGE_PAUSE', 'NONE', unknown → undefined

      if (stepHint !== undefined) {
        if (guidanceMode === 'STABILIZE') {
          stepHint = undefined;
        } else if (guidanceMode === 'DE_ESCALATE' && stepHint === 'TWO_STEPS') {
          stepHint = 'ONE_STEP';
        }
        if (stepHint !== undefined && interruptHint) {
          stepHint = undefined;
        }
        if (stepHint !== undefined && pacingHint === 'SLOW') {
          stepHint = undefined;
        }
        if (stepHint !== undefined && appraisalResult.escalation.level >= 2) {
          stepHint = undefined;
        }
      }
    }

    // ── QuestionBudgetHint: controls max questions per response (present-or-absent) ──
    let questionBudgetHint: QuestionBudgetHint | undefined;
    if (
      featureFlags.interventionQuestionBudgetEnabled &&
      featureFlags.appraisalBridgeEnabled &&
      featureFlags.appraisalBridgeModeEnabled &&
      this.messageCount >= this.minimumMessagesForAdaptiveControl &&
      appraisalResult
    ) {
      if (guidanceMode === 'STABILIZE') {
        questionBudgetHint = 'ZERO';
      } else if (interruptHint) {
        questionBudgetHint = 'ZERO';
      } else if (guidanceMode === 'DE_ESCALATE') {
        questionBudgetHint = 'ONE';
      } else if (pacingHint === 'SLOW') {
        questionBudgetHint = 'ONE';
      } else if (appraisalResult.escalation.level >= 2) {
        questionBudgetHint = 'ZERO';
      }
      // else → undefined (absent)
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

    // 5b–5d. Hint pipeline: resolve → stickiness → re-resolve
    {
      let currentHints: ResolvableHints = {
        guidanceMode,
        pacingHint,
        toneHint,
        validationIntensity,
        validationHint,
        actionHint,
        interruptHint,
        stepHint,
        questionBudgetHint,
      };

      // 5b. First resolve pass — priority trimming + hard cap
      if (featureFlags.hintResolverEnabled) {
        currentHints = resolveHints(currentHints);
      }

      // 5c. Stickiness — hysteresis to reduce oscillation
      if (
        featureFlags.hintStickinessEnabled &&
        this.messageCount >= this.minimumMessagesForAdaptiveControl
      ) {
        const HOLD_CONFIG: Partial<Record<StickyHintKey, number>> = {
          pacingHint: 2,
          questionBudgetHint: 2,
          interruptHint: 2,
          toneHint: 1,
          validationHint: 1,
          actionHint: 1,
          validationIntensity: 1,
          stepHint: 0,
        };
        const { final, holdsRemainingNext } = applyHintStickiness({
          resolved: currentHints,
          previous: this.lastStickyHints,
          holdsRemaining: this.hintHoldsRemaining,
          holdConfig: HOLD_CONFIG,
        });
        currentHints = { ...currentHints, ...final };
        this.lastStickyHints = final;
        this.hintHoldsRemaining = holdsRemainingNext;
      }

      // 5d. Second resolve pass — re-enforce cap after stickiness may have reintroduced hints
      if (featureFlags.hintResolverEnabled) {
        currentHints = resolveHints(currentHints);
      }

      // 5e. Semantic coherence guard — enforce cross-hint consistency
      if (featureFlags.hintSemanticGuardEnabled) {
        currentHints = enforceHintSemanticCoherence(currentHints);
      }

      pacingHint = currentHints.pacingHint as typeof pacingHint;
      toneHint = currentHints.toneHint as typeof toneHint;
      validationIntensity = currentHints.validationIntensity as typeof validationIntensity;
      validationHint = currentHints.validationHint as typeof validationHint;
      actionHint = currentHints.actionHint as typeof actionHint;
      interruptHint = currentHints.interruptHint as typeof interruptHint;
      stepHint = currentHints.stepHint as typeof stepHint;
      questionBudgetHint = currentHints.questionBudgetHint as typeof questionBudgetHint;
    }

    // 6. Build prompt (PURE)
    const prompt = PromptTemplateBuilder.build(emotionalState, this.etvState, {
      guidanceMode,
      momentumConfidence: momentum.confidence,
      answerFirst: allowAnswerFirst,
      microContext,
      ...(pacingHint ? { pacingHint } : {}),
      ...(validationIntensity ? { validationIntensity } : {}),
      ...(toneHint ? { toneHint } : {}),
      ...(validationHint ? { validationHint } : {}),
      ...(actionHint ? { actionHint } : {}),
      ...(interruptHint ? { interruptHint } : {}),
      ...(stepHint ? { stepHint } : {}),
      ...(questionBudgetHint ? { questionBudgetHint } : {}),
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
      timestamp: messageTimestampMs,

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

      ...(appraisalResult
        ? {
            appraisal: {
              escalationLevel: appraisalResult.escalation.level,
              escalationScore: appraisalResult.escalation.score,
              pressureScalar: appraisalResult.pressure.scalar,
              pressureSlope: appraisalResult.pressure.slope,
              moodCategory: appraisalResult.mood.category,
              collapseEvent: appraisalResult.collapse.event,
              postClarityActive: appraisalResult.postClarity.active,
              interventionToneMode: appraisalResult.intervention.toneMode,
              interventionPacingMode: appraisalResult.intervention.pacingMode,
            },
          }
        : {}),

      ...(appraisalOverride ? { appraisalOverride } : {}),
      ...(pacingHint ? { pacingHint } : {}),
      ...(validationIntensity ? { validationIntensity } : {}),
      ...(toneHint ? { toneHint } : {}),
      ...(validationHint ? { validationHint } : {}),
      ...(actionHint ? { actionHint } : {}),
      ...(interruptHint ? { interruptHint } : {}),
      ...(stepHint ? { stepHint } : {}),
      ...(questionBudgetHint ? { questionBudgetHint } : {}),
      ...(driftDetectedThisMessage ? { driftDetected: true as const } : {}),
      ...(overrideCooldownActiveThisMessage ? { overrideCooldownActive: true as const } : {}),
      ...(dwellResult.dwellActive ? { guidanceDwellActive: true as const, guidanceDwellMode: dwellResult.dwellMode } : {}),
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
    // ── Idempotent guard (ETV V1): prevents double-close / double ETV update ──
    if (featureFlags.etvV1Enabled) {
      if (!this.sessionOpen || this.messageCount === 0) {
        return { newETV: this.etvState.value };
      }
      this.sessionOpen = false;
      this.lastClosedSessionId = this.currentSessionId;
    } else {
      if (this.sessionEIVs.length === 0) {
        return { newETV: this.etvState.value };
      }
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

    const sessionId = this.currentSessionId ?? `session-${this.etvState.lastUpdated}`;

    DecisionLogger.logSessionEnd({
      sessionId,
      startETV: previousETV,
      endETV: newETV,
      meanSessionEIV: sessionMean,
      violationOccurred: this.sessionHasViolation,
      messageCount: this.messageCount,
      endedAt: Date.now(),
    });

    // ── ETV V1: parallel Beta-with-decay update (Phase 1 — log only) ──
    if (featureFlags.etvV1Enabled) {
      const now = Date.now();
      const summary = buildSessionSummary({
        sessionId,
        userId: 'default',
        startedAt: this.sessionStartedAt || now,
        endedAt: now,
        messageCount: this.messageCount,
        eivBuffer: this.sessionEIVs,
        aviBuffer: this.sessionAVIs,
        hasViolation: this.sessionHasViolation,
      });

      try {
        const { log } = ETVEngineV1.updateFromSession(summary);
        DecisionLogger.logETVUpdate({
          userId: log.userId,
          sessionId: log.sessionId,
          deltaHours: log.deltaHours,
          decay: log.decay,
          z_t: log.z_t,
          evidenceMass: log.evidenceMass,
          r_before: log.r_before,
          s_before: log.s_before,
          r_after: log.r_after,
          s_after: log.s_after,
          etvMean: log.etvMean,
          etvVar: log.etvVar,
          band: log.band,
          timestamp: log.timestamp,
        });
      } catch (err) {
        if (debugEnabled) {
          console.error('[LoRa::ETVv1] Update failed:', err);
        }
      }
    }

    // Reset session
    this.etvState = {
      value: newETV,
      sessionEIVs: [],
      messageCount: 0,
      lastUpdated: Date.now(),
    };

    this.sessionEIVs = [];
    this.sessionAVIs = [];
    this.sessionStartedAt = 0;
    this.sessionHasViolation = false;
    this.messageCount = 0;
    this.lastMessageTimestampMs = 0;
    this.currentSessionId = null;
    this.interpreter.reset();
    this.appraisalBridge?.reset();
    this.recentGuidanceModes = [];
    this.recentPacingHints = [];
    this.recentEscalationLevels = [];
    this.driftWarningActive = false;
    this.overrideCooldownRemaining = 0;
    this.lastStickyHints = {};
    this.hintHoldsRemaining = {};
    this.guidanceDwellRemaining = 0;
    this.guidanceDwellMode = null;

    return { newETV };
  }

  // ---------------------------------------------------
  // Guidance dwell lock
  // ---------------------------------------------------
  private applyGuidanceDwell(
    proposedMode: PromptProfile['guidanceMode'],
    collapseEvent: boolean,
  ): {
    mode: PromptProfile['guidanceMode'];
    dwellActive: boolean;
    dwellMode?: 'STABILIZE' | 'DE_ESCALATE';
  } {
    if (
      !featureFlags.guidanceDwellLockEnabled ||
      this.messageCount < this.minimumMessagesForAdaptiveControl
    ) {
      return { mode: proposedMode, dwellActive: false };
    }

    // Active dwell — enforce locked mode
    if (this.guidanceDwellRemaining > 0 && this.guidanceDwellMode !== null) {
      // Emergency escalation: collapse overrides DE_ESCALATE → STABILIZE
      if (this.guidanceDwellMode === 'DE_ESCALATE' && collapseEvent) {
        this.guidanceDwellMode = 'STABILIZE';
        this.guidanceDwellRemaining = 2; // current + next 2
        return { mode: 'STABILIZE', dwellActive: true, dwellMode: 'STABILIZE' };
      }
      this.guidanceDwellRemaining--;
      if (proposedMode === this.guidanceDwellMode) {
        return { mode: proposedMode, dwellActive: false };
      }
      return { mode: this.guidanceDwellMode, dwellActive: true, dwellMode: this.guidanceDwellMode };
    }

    // No active dwell — check if proposed mode should start one
    if (proposedMode === 'STABILIZE') {
      this.guidanceDwellMode = 'STABILIZE';
      this.guidanceDwellRemaining = 2;
      return { mode: proposedMode, dwellActive: false };
    }
    if (proposedMode === 'DE_ESCALATE') {
      this.guidanceDwellMode = 'DE_ESCALATE';
      this.guidanceDwellRemaining = 1;
      return { mode: proposedMode, dwellActive: false };
    }

    // Non-lockable mode — clear any expired dwell state
    this.guidanceDwellMode = null;
    this.guidanceDwellRemaining = 0;
    return { mode: proposedMode, dwellActive: false };
  }

  // ---------------------------------------------------
  // Drift monitor (observability-only)
  // ---------------------------------------------------
  private checkDrift(): boolean {
    const transitions = <T>(arr: T[]): number => {
      let count = 0;
      for (let i = 1; i < arr.length; i++) {
        if (arr[i] !== arr[i - 1]) count++;
      }
      return count;
    };

    if (transitions(this.recentGuidanceModes) >= 4) return true;
    if (transitions(this.recentPacingHints) >= 3) return true;
    if (transitions(this.recentEscalationLevels) >= 3) return true;
    return false;
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