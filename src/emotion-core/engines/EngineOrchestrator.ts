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
import { PromptTemplateBuilder, classifyIntensity } from '../prompt/PromptTemplateBuilder';
import { DecisionLogger } from '../logging/DecisionLogger';
import type { MessageDecisionLog } from '../logging/DecisionLogger';
import { ClaudeResponder } from '../llm/ClaudeResponder';
import { EmotionalStateInterpreter } from '../processors/EmotionalStateInterpreter';
import { MOMENTUM_CONSTANTS } from '../config/momentum.constants';
import type { PromptProfile, PacingHint, ValidationIntensity, ToneHint, ValidationHint, ActionHint, InterruptHint, StepHint, QuestionBudgetHint, VolatilityState } from '../types/logging.types';
import { debugEnabled, decisionLogEnabled } from '../debug/debugGate';
import { featureFlags } from '../config/featureFlags';
import { AppraisalBridgeRunner } from '../../appraisal-bridge/AppraisalBridgeRunner';
import { resolveHints, type ResolvableHints } from './hintResolver';
import { applyHintStickiness, type StickyHints, type StickyHintKey } from './hintStickiness';
import { enforceHintSemanticCoherence } from './hintSemanticGuard';
import { mapLayerASnapshot } from '../../appraisal-bridge/mapLayerASnapshot';
import type { AppraisalResult } from '../../appraisal-bridge/types';
import { mapEkmanToDominant } from '../../appraisal-bridge/ekmanToDominant';
import { LatentPressureTracker } from '../../appraisal-bridge/latentPressureIndex';
import type { LPIResult } from '../../appraisal-bridge/latentPressureIndex';
import { VolatilityDirectionTracker } from '../../appraisal-bridge/volatilityDirection';
import type { VolatilityTrend } from '../../appraisal-bridge/volatilityDirection';
import { computeEkmanWeighting } from '../../appraisal-bridge/ekmanWeighting';
import type { EkmanWeightResult } from '../../appraisal-bridge/ekmanWeighting';
import { GradientEscalationTracker } from '../../appraisal-bridge/gradientEscalation';
import type { GradientEscalationResult, GradientEscalationState } from '../../appraisal-bridge/gradientEscalation';
import { AVIScorer } from '../scorers/AVIScorer';
import { fetchPerspectiveAnalysis } from '../analysis/perspectiveClient';
import type { PerspectiveAnalyzeResponse } from '../analysis/types';
import { ETVEngineV1, SESSION_GAP_MS, buildSessionSummary } from '../etv';
import type { SessionSummaryV1, ETVPolicy } from '../etv';
import type { MemoryV1State, ProcessMessageInput as MemoryProcessMessageInput, ProcessMessageOutput as MemoryProcessMessageOutput } from '../memory-v1/memoryV1EngineTypes';
import type { MemoryContext } from '../memory-v1/memoryContextTypes';
import type { StoredMemoryV1State, MemoryV1Storage } from '../memory-v1/storageTypes';
import type { DominantEmotion } from '../memory-v1/types';
import { createMemoryV1, processMessage as memV1ProcessMessage, endSession as memV1EndSession } from '../memory-v1/memoryV1Engine';
import { createJSONStorage } from '../memory-v1/storage';
import { createBuffer } from '../memory-v1/episodicBuffer';
import { makeMemoryConsolidateLog, makeMemoryServiceRetrieveLog, makeMemoryServiceSaveLog } from '../memory-v1/decisionLogs';
import { buildMemoryV1DebugSnapshot } from '../memory-v1/debugSnapshot';
import { getMemoryV1Policy } from '../memory-v1/policyMap';
import type { ETVBandHint } from '../memory-v1/policyTypes';
import type { MemoryService } from '../memory-v1/service/MemoryService';
import type { AnchorRecord, MemorySaveInput, EmotionBand, RetrieveContextOpts } from '../memory-v1/service/memoryTypes';
import { MAX_ANCHORS_IN_PROMPT } from '../memory-v1/factAnchorTypes';
import type { BootstrapMemory } from '../memory-v1/bootstrap/bootstrapMemory';
import { buildBootstrapContext } from '../memory-v1/bootstrap/bootstrapContext';
import { runPersonaEnforcer } from '../persona/personaEnforcer';
import type { PersonaEnforcerDebug } from '../persona/personaEnforcer';
import { applyIdentityRepetitionGuard } from '../config/identityConstants';
import { NarrativeStateEngine } from '../narrative/NarrativeStateEngine';
import type { NarrativeMomentumBlock } from '../narrative/NarrativeStateEngine';
import { buildResponseShapeContract } from '../prompt/ResponseShapeContract';
import type { ResponseShapeResult } from '../prompt/ResponseShapeContract';
import { isMaskedPressurePersistent } from './maskedPressurePersistence';
import { enforceIdentity } from '../policy/IdentityGuard';

type LLMAvailability = 'AVAILABLE' | 'UNAVAILABLE';

type LLMConfig = {
  maxResponseMs: number;
  maxAttempts: number;
  cooldownMs: number;
};

type LLMResponder = {
  generateResponse(
    systemPrompt: string,
    userMessage: string,
    options?: {
      signal?: AbortSignal;
      requestId?: string;
      sessionHistory?: import('../prompt/PromptTemplateBuilder').ChatTurn[];
    }
  ): Promise<string>;
};

const DEFAULT_LLM_CONFIG: LLMConfig = {
  maxResponseMs: 2500,
  maxAttempts: 2,
  cooldownMs: 15000,
};

/** Per-request abort timeout (env-configurable, default 18 s). */
const llmTimeoutMs = Math.max(
  1000,
  parseInt(process.env.LORA_LLM_TIMEOUT_MS || '', 10) || 18000
);

/**
 * When true, the LLM cooldown/fallback mechanism is disabled.
 * All provider failures surface as thrown errors instead of being
 * silently replaced with canned comfort text.
 * Activated via LORA_STRESS_TEST=1 — intended for stress-test runs
 * where silent fallback masks real failures.
 */
const stressTestMode = process.env.LORA_STRESS_TEST === '1';

import { writeSessionTrace } from '../../debug/sessionTrace';

const VALID_DOMINANT_EMOTIONS: ReadonlySet<string> = new Set([
  'JOY', 'SADNESS', 'ANGER', 'FEAR', 'CONTENTMENT', 'NEUTRAL',
]);

export class EngineOrchestrator {
  private etvState: ETVState;
  private sessionEIVs: number[] = [];
  private sessionAVIs: number[] = [];

  /** Return a copy of the session EIV curve (used by Memory V2 consolidation). */
  getSessionEIVs(): number[] {
    return [...this.sessionEIVs];
  }
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
  private readonly lpiTracker?: LatentPressureTracker;
  private readonly volatilityDirectionTracker?: VolatilityDirectionTracker;
  private readonly gradientEscalationTracker?: GradientEscalationTracker;
  private recentVolatilities: number[] = [];
  private lastMessageTimestampMs = 0;

  // ── Masked pressure persistence gate: ring buffer (max 4) for 2-of-4 trigger ──
  private maskedPressureHistory: boolean[] = [];

  // ── Idempotent session-close guard (ETV V1) ──
  private sessionOpen = false;
  private currentSessionId: string | null = null;
  private lastClosedSessionId: string | null = null;

  private activeExecution?: symbol;
  private lastDecision?: {
    eiv: ReturnType<typeof EIVScorer.calculate>;
    prompt: string;
    llmOutput: string;
    deepAnalysis?: boolean;
    deepMeta?: {
      conflict_summary?: string;
      dominance?: string;
      dimensions_detected?: string[];
      frameworks_evaluated?: number;
      combinations_scored?: number;
      formation_chosen?: string;
      formation_reasoning?: string;
      processing_time_ms?: number;
    };
    debug: {
      etv: number;
      band: string;
      anchorsUsed: number;
      schemasUsed: number;
      degraded: { falkor: boolean; chroma: boolean };
      stmTurns?: number;
      behaviorMode?: {
        band: string;
        intensityLevel: 'low' | 'medium' | 'high';
        anchorIntegration: boolean;
        degradedMode: boolean;
      };
      relational?: {
        intent: string;
        confidence: number;
      };
      bootstrapActive?: boolean;
      bootstrapInjected?: boolean;
      personaEnforcer?: PersonaEnforcerDebug;
    };
  };

  private readonly minimumMessagesForAdaptiveControl = 3;

  private overrideCooldownRemaining = 0;

  // ── Hint stickiness (hysteresis, gated by hintStickinessEnabled) ──
  private lastStickyHints: StickyHints = {};
  private hintHoldsRemaining: Partial<Record<StickyHintKey, number>> = {};

  // ── Deep analysis offer tracking ──
  private deepAnalysisPending: boolean = false;
  private deepAnalysisOffered: boolean = false;

  /** Mark whether a deep analysis has been accepted/declined by the user. */
  setDeepAnalysisPending(pending: boolean): void {
    this.deepAnalysisPending = pending;
  }

  /** Check whether LoRa should offer a deep analysis to the user this turn. */
  shouldOfferDeepAnalysis(): boolean {
    if (this.deepAnalysisOffered) return false;
    if (this.deepAnalysisPending) return false;
    if (this.messageCount < 3) return false;
    if (this.sessionEIVs.length === 0) return false;
    const avgEIV = this.sessionEIVs.reduce((a, b) => a + b, 0) / this.sessionEIVs.length;
    // Trigger on emotional intensity OR sustained analytical engagement
    // EIV > 0.3 = emotionally complex problem
    // messageCount >= 5 = user keeps digging (analytically complex, low EIV)
    return avgEIV > 0.3 || this.messageCount >= 5;
  }

  /** Mark that the deep analysis offer was made this session. */
  markDeepAnalysisOffered(): void {
    this.deepAnalysisOffered = true;
    this.deepAnalysisPending = true;
  }

  /** Whether the engine is waiting for the user to accept/decline a deep analysis offer. */
  isDeepAnalysisPending(): boolean {
    return this.deepAnalysisPending;
  }

  // ── Memory V2 retrieval context (set by chat.route before processMessage) ──
  private memoryV2Context: {
    matchedSessions: Array<{ similarity: number }>;
    relatedFacts: Array<{ type: string; value: string; confidence: number }>;
    responseMode: 'silent' | 'subtle' | 'direct';
    topSimilarity: number;
  } | null = null;

  /** Set V2 memory context before calling processMessage */
  setMemoryV2Context(ctx: typeof this.memoryV2Context): void {
    this.memoryV2Context = ctx;
  }

  // ── Guidance dwell lock (gated by guidanceDwellLockEnabled) ──
  private guidanceDwellRemaining: number = 0;
  private guidanceDwellMode: 'STABILIZE' | 'DE_ESCALATE' | null = null;

  // ── Drift monitor (observability-only, gated by driftMonitorEnabled) ──
  private readonly driftWindowSize = 10;
  private recentGuidanceModes: string[] = [];
  private recentPacingHints: (string | undefined)[] = [];
  private recentEscalationLevels: number[] = [];
  private driftWarningActive = false;

  private readonly userId: string;
  private sessionCounter = 0;
  private lastEtvPolicy: ETVPolicy | null = null;

  // ── Memory V1 (gated by memoryV1Enabled / memoryV1ShadowEnabled) ──
  private memoryV1State?: MemoryV1State;
  private memoryV1Storage?: MemoryV1Storage;
  private readonly memoryV1BaseDir = '.lora/memory-v1';

  // ── Memory Service — dual DB pipeline (gated by memoryServiceEnabled) ──
  /** False by default. Forced to false when NODE_ENV === 'test'. */
  private readonly memoryServiceEnabled: boolean;
  private readonly memoryService?: MemoryService;
  private readonly bootstrapMemory?: BootstrapMemory;
  private chromaDegraded = false;
  private falkorDegraded = false;
  private degradedLogged = { chroma: false, falkor: false, dual: false };

  // ── Narrative State Engine (gated by narrativeStateEngineEnabled) ──
  private narrativeEngine?: NarrativeStateEngine;

  constructor(
    initialETV: number = MASTER_CONSTANTS.engineDefaults.initialETV,
    llmConfig: Partial<LLMConfig> = {},
    responderFactory: () => LLMResponder = () =>
      new ClaudeResponder(),
    options: { userId?: string; memoryService?: MemoryService; bootstrapMemory?: BootstrapMemory } = {},
  ) {
    // userId is mandatory to guarantee memory isolation between users.
    // Do not allow fallback identities like 'anonymous'.
    if (!options.userId) {
      throw new Error('EngineOrchestrator requires a valid userId for memory isolation.');
    }
    this.userId = options.userId;
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
      this.lpiTracker = new LatentPressureTracker();
      this.volatilityDirectionTracker = new VolatilityDirectionTracker();
      this.gradientEscalationTracker = new GradientEscalationTracker();
    }
    this.memoryServiceEnabled =
      process.env.NODE_ENV === 'test' ? false : featureFlags.memoryServiceEnabled;
    if (this.memoryServiceEnabled && options.memoryService) {
      this.memoryService = options.memoryService;
    }
    if (featureFlags.bootstrapMemoryEnabled && options.bootstrapMemory) {
      this.bootstrapMemory = options.bootstrapMemory;
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
    signalPacket?: SignalPacket,
    sessionHistory?: import('../prompt/PromptTemplateBuilder').ChatTurn[],
    perspectiveMode?: 'quick' | 'deep',
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
      this.sessionCounter += 1;
      this.currentSessionId = `sess-${this.userId}-${messageTimestampMs}-${this.sessionCounter}`;
      this.sessionOpen = true;

      if (featureFlags.etvV1Enabled && this.lastEtvPolicy === null) {
        try {
          this.lastEtvPolicy = ETVEngineV1.getPolicy(this.userId);
        } catch { /* storage not yet initialized — will populate after first session */ }
      }

      if (featureFlags.memoryV1Enabled || featureFlags.memoryV1ShadowEnabled) {
        this.initMemoryV1();
      }
    }
    this.messageCount += 1;

    // 1. Assemble EIV components
    const components =
      EIVComponentAssembler.assemble(analyzerOutputs);

    // 2. Calculate EIV — ONCE per message (single source of truth)
    const eivResult = EIVScorer.calculate(components, analyzerOutputs.enhanced);

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

    // ── Per-message volatility (rolling window = 5) ──
    const sessionVolatility = EngineOrchestrator.computeSessionVolatility(this.sessionEIVs);

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

    // ── Wire Ekman family → EmotionalState (appraisal bridge only) ──
    if (!emotionalStateOverride && appraisalResult) {
      const ekman = mapEkmanToDominant(
        appraisalResult.family.dominantFamily,
        appraisalResult.family.confidence,
      );
      if (ekman) {
        emotionalState.ekmanDominant = ekman.ekmanDominant;
        emotionalState.ekmanConfidence = ekman.ekmanConfidence;
      }
    }

    // ── LPI + Volatility Direction + Gradient Escalation (appraisal bridge) ──
    // Bridge OFF: do not compute or update any appraisal-derived state.
    let lpiResult: LPIResult | undefined;
    let volatilityTrend: VolatilityTrend | undefined;
    let gradientEscalation: GradientEscalationResult | undefined;
    let maskedPressurePersistent = false;

    if (this.appraisalBridge && appraisalResult) {
      this.recentVolatilities.push(sessionVolatility.value);
      if (this.recentVolatilities.length > 10) {
        this.recentVolatilities = this.recentVolatilities.slice(-10);
      }

      if (this.lpiTracker) {
        const messageText = signalPacket?.messageText ?? '';
        lpiResult = this.lpiTracker.step(
          {
            messageText,
            valenceScore: analyzerOutputs.valence.score,
            valenceConfidence: analyzerOutputs.valence.confidence,
            arousalScore: analyzerOutputs.arousal.score,
            recentVolatilities: this.recentVolatilities,
          },
          appraisalResult.escalation.level,
        );
      }

      if (this.volatilityDirectionTracker) {
        const vdResult = this.volatilityDirectionTracker.step(sessionVolatility.value);
        volatilityTrend = vdResult.trend;
      }

      if (this.gradientEscalationTracker) {
        gradientEscalation = this.gradientEscalationTracker.step(
          appraisalResult.escalation.level,
          lpiResult?.smoothed ?? 0,
          volatilityTrend ?? 'STABLE',
        );
      }

      // Masked pressure persistence: ring buffer (max 4) for 2-of-4 gate — only when bridge ON
      this.maskedPressureHistory.push(lpiResult?.maskedPressure ?? false);
      while (this.maskedPressureHistory.length > 4) {
        this.maskedPressureHistory.shift();
      }
      maskedPressurePersistent = isMaskedPressurePersistent(this.maskedPressureHistory);
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

    // ── LORA_DEBUG_EIV: enhanced signal diagnostics ──
    if (process.env.LORA_DEBUG_EIV === '1' && analyzerOutputs.enhanced) {
      const e = analyzerOutputs.enhanced;
      console.log('[LoRa::EIV_DEBUG]', {
        semanticScore: e.semanticScore,
        arousalScore: e.arousalScore,
        capsRatio: e.capsWeight,
        repetitionWeight: e.repetitionWeight,
        volatility: sessionVolatility.value,
        eiv: eivResult.value,
        eivTier: getEIVTier(eivResult.value),
      });
    }

    // 5. Message-level decision context (pre-LLM)
    // ── Enhanced arousal / valence classification for guidanceMode ──
    const AROUSAL_TH = MASTER_CONSTANTS.eiv.enhancedArousalThresholds;
    const VALENCE_TH = MASTER_CONSTANTS.eiv.enhancedValenceThresholds;
    const enhancedArousalLevel: 'LOW' | 'MEDIUM' | 'HIGH' = analyzerOutputs.enhanced
      ? (analyzerOutputs.enhanced.arousalScore > AROUSAL_TH.highMinExclusive ? 'HIGH'
        : analyzerOutputs.enhanced.arousalScore >= AROUSAL_TH.mediumMinInclusive ? 'MEDIUM' : 'LOW')
      : emotionalState.arousal;
    const enhancedValence: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' = analyzerOutputs.enhanced
      ? (analyzerOutputs.enhanced.semanticScore < VALENCE_TH.negativeMaxExclusive ? 'NEGATIVE'
        : analyzerOutputs.enhanced.semanticScore > VALENCE_TH.positiveMinExclusive ? 'POSITIVE' : 'NEUTRAL')
      : emotionalState.valence;
    const eivTier = getEIVTier(eivResult.value);

    let guidanceMode: PromptProfile['guidanceMode'];
    if (eivTier === 'high' || eivTier === 'extreme' || enhancedArousalLevel === 'HIGH') {
      guidanceMode = 'ENERGY_MATCH';
    } else if (enhancedValence === 'NEGATIVE' && eivTier === 'moderate') {
      guidanceMode = 'STABILIZING';
    } else if (sessionVolatility.state === 'HIGH') {
      guidanceMode = 'CONTAINMENT';
    } else {
      guidanceMode = 'CALM_NEUTRAL';
    }

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
      } else if (lpiResult?.maskedPressure && gradientEscalation && gradientEscalation.numericLevel < 3) {
        guidanceMode = 'STABILIZING';
        appraisalOverride = 'MASKED_PRESSURE_OVERRIDE';
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

    // ── Masked pressure persistence gate (2-of-4 rolling window) ──
    // Focus + next step — no therapy/grief language. Respects dwell lock.
    if (
      featureFlags.appraisalBridgeModeEnabled &&
      maskedPressurePersistent &&
      !dwellResult.dwellActive &&
      this.messageCount >= this.minimumMessagesForAdaptiveControl &&
      appraisalResult
    ) {
      const alreadyStabilizing = guidanceMode === 'STABILIZE' || guidanceMode === 'DE_ESCALATE' || guidanceMode === 'STABILIZING';
      if (!alreadyStabilizing) {
        guidanceMode = 'STABILIZING';
      }
      const escalationLevel = gradientEscalation?.numericLevel ?? appraisalResult.escalation.level;
      questionBudgetHint = escalationLevel >= 3 ? 'ZERO' : 'ONE';
      if (!alreadyStabilizing) {
        actionHint = 'OFFER_STEPS';
      } else if (guidanceMode === 'STABILIZING' && actionHint === undefined) {
        actionHint = 'OFFER_STEPS';
      }
    }

    // ── Volatility direction influence on hints ──
    if (volatilityTrend === 'RISING' && (emotionalState.arousal === 'MEDIUM' || emotionalState.arousal === 'HIGH')) {
      if (!validationIntensity || validationIntensity === 'MEDIUM') {
        validationIntensity = 'HIGH';
      }
      if (!questionBudgetHint) {
        questionBudgetHint = 'ONE';
      } else if (questionBudgetHint === 'ONE') {
        questionBudgetHint = 'ZERO';
      }
    }

    if (volatilityTrend === 'FALLING' && !appraisalOverride && !dwellResult.dwellActive) {
      if (guidanceMode === 'STABILIZE') {
        guidanceMode = 'STABILIZING';
      } else if (guidanceMode === 'STABILIZING') {
        guidanceMode = 'CALM_NEUTRAL';
      }
    }

    // ── Ekman weighting influence on hints ──
    let ekmanWeightResult: EkmanWeightResult | undefined;
    if (this.appraisalBridge && emotionalState.ekmanDominant) {
      ekmanWeightResult = computeEkmanWeighting(
        emotionalState.ekmanDominant,
        emotionalState.ekmanConfidence,
        { pacingHint, validationIntensity, interruptHint, questionBudgetHint },
      );
      if (ekmanWeightResult.applied) {
        const m = ekmanWeightResult.modifiers;
        if (m.pacingHint) pacingHint = m.pacingHint;
        if (m.validationIntensity) validationIntensity = m.validationIntensity;
        if (m.interruptHint) interruptHint = m.interruptHint;
        if (m.questionBudgetHint) questionBudgetHint = m.questionBudgetHint;
        if (m.preferEnergyMatch && guidanceMode === 'CALM_NEUTRAL') {
          guidanceMode = 'ENERGY_MATCH';
        }
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

    // Relational routing is handled only in the route layer. Engine does not perform relational detection.

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

    // ── Memory V1: per-message processing ──
    let memoryContext: MemoryContext | undefined;
    let memoryV1Result: MemoryProcessMessageOutput | null = null;
    if (
      (featureFlags.memoryV1Enabled || featureFlags.memoryV1ShadowEnabled) &&
      this.memoryV1State
    ) {
      const memPolicy = this.lastEtvPolicy
        ? getMemoryV1Policy(this.lastEtvPolicy.band.replace('BAND_', 'B') as ETVBandHint)
        : undefined;
      memoryV1Result = this.processMemoryV1Message(
        eivResult.value,
        analyzerOutputs,
        emotionalState,
        momentum,
        appraisalResult,
        messageTimestampMs,
        memPolicy,
      );
      memoryContext = memoryV1Result?.memoryContext ?? undefined;
    }

    // ── Memory Service: dual DB retrieval (gated by memoryServiceEnabled) ──
    let memServiceAnchors: AnchorRecord[] = [];
    let memServiceDegraded = { falkor: false, chroma: false };
    let memServiceSemanticCount = 0;

    if (featureFlags.memoryServiceEnabled && this.memoryService) {
      try {
        const currentBandRaw = this.lastEtvPolicy?.band.replace('BAND_', 'B');
        const retrieveBand = (currentBandRaw === 'B0' || currentBandRaw === 'B1' || currentBandRaw === 'B2' || currentBandRaw === 'B3' || currentBandRaw === 'B4')
          ? currentBandRaw as EmotionBand
          : 'B0' as EmotionBand;

        const retrieveOpts: RetrieveContextOpts = {
          emotionVec: [
            analyzerOutputs.valence.score,
            analyzerOutputs.arousal.score,
            analyzerOutputs.expressionStrength.score,
            Math.min(
              analyzerOutputs.valence.confidence,
              analyzerOutputs.arousal.confidence,
              analyzerOutputs.expressionStrength.confidence,
            ),
          ],
          nowMs: messageTimestampMs,
          band: retrieveBand,
          skipAnchors: !featureFlags.factAnchorEnabled,
        };

        const msResult = await this.memoryService.retrieveContext(this.userId, userMessage, retrieveOpts);
        memServiceDegraded = msResult.degraded;
        memServiceSemanticCount = msResult.semantic.length;

        if (featureFlags.factAnchorEnabled) {
          memServiceAnchors = msResult.anchors.slice(0, MAX_ANCHORS_IN_PROMPT);
        }

        if (msResult.degraded.falkor) this.falkorDegraded = true;
        if (msResult.degraded.chroma) this.chromaDegraded = true;

        if (msResult.degraded.falkor && msResult.degraded.chroma && !this.degradedLogged.dual) {
          this.degradedLogged.dual = true;
          if (decisionLogEnabled) {
            console.log('[LoRa::MemoryDualFail]', JSON.stringify({
              userId: this.userId, sessionId: this.currentSessionId, tsMs: Date.now(),
            }));
          }
        } else if (msResult.degraded.chroma && !this.degradedLogged.chroma) {
          this.degradedLogged.chroma = true;
          if (decisionLogEnabled) {
            console.log('[LoRa::MemoryChromaFail]', JSON.stringify({
              userId: this.userId, sessionId: this.currentSessionId, tsMs: Date.now(),
            }));
          }
        } else if (msResult.degraded.falkor && !this.degradedLogged.falkor) {
          this.degradedLogged.falkor = true;
          if (decisionLogEnabled) {
            console.log('[LoRa::MemoryFalkorFail]', JSON.stringify({
              userId: this.userId, sessionId: this.currentSessionId, tsMs: Date.now(),
            }));
          }
        }

        if (decisionLogEnabled) {
          const log = makeMemoryServiceRetrieveLog({
            userId: this.userId,
            sessionId: this.currentSessionId ?? undefined,
            messageId: `msg-${this.messageCount}`,
            tsMs: Date.now(),
            anchorCount: msResult.anchors.length,
            semanticCount: msResult.semantic.length,
            degraded: msResult.degraded,
            band: retrieveBand,
          });
          console.log('[LoRa::MemoryServiceRetrieve]', JSON.stringify(log));
        }
      } catch {
        memServiceDegraded = { falkor: true, chroma: true };
        this.falkorDegraded = true;
        this.chromaDegraded = true;
        if (!this.degradedLogged.dual) {
          this.degradedLogged.dual = true;
          if (decisionLogEnabled) {
            console.log('[LoRa::MemoryServiceError]', JSON.stringify({
              userId: this.userId, sessionId: this.currentSessionId, tsMs: Date.now(),
            }));
          }
        }
      }
    }

    // ── Bootstrap Memory: addMessage + conditional context injection ──
    const structuredEmpty = memServiceAnchors.length === 0 && memServiceSemanticCount === 0;
    let bootstrapContextStr: string | undefined;
    const bootstrapActive = featureFlags.bootstrapMemoryEnabled && !!this.bootstrapMemory;

    if (bootstrapActive) {
      const emotionVec = [
        analyzerOutputs.valence.score,
        analyzerOutputs.arousal.score,
        analyzerOutputs.expressionStrength.score,
        Math.min(
          analyzerOutputs.valence.confidence,
          analyzerOutputs.arousal.confidence,
          analyzerOutputs.expressionStrength.confidence,
        ),
      ];
      this.bootstrapMemory!.addMessage(
        this.userId,
        userMessage,
        'user',
        emotionVec,
        eivResult.value,
        this.sessionCounter,
        messageTimestampMs,
      );

      if (structuredEmpty) {
        const state = this.bootstrapMemory!.getState(this.userId);
        const ctx = buildBootstrapContext(state);
        if (ctx) bootstrapContextStr = ctx;
      }
    }

    // 6. Build prompt (PURE)
    const currentBand = (this.lastEtvPolicy?.band ?? 'B0') as import('../memory-v1/service/memoryTypes').EmotionBand;
    const currentEiv = eivResult.value;

    // ── Persona Enforcer: deterministic override for identity/relational queries ──
    if (featureFlags.personaEnforcerEnabled) {
      const enforcerResult = runPersonaEnforcer({
        userText: userMessage,
        band: currentBand,
        intensityLevel: classifyIntensity(currentEiv),
        userId: this.userId,
        relationalResult: undefined,
      });

      if (enforcerResult.override) {
        const lastAssistant = sessionHistory?.filter((t) => t.role === 'assistant').pop()?.text;
        const finalOverride =
          enforcerResult.debug.kind === 'identity_override'
            ? applyIdentityRepetitionGuard(enforcerResult.override, lastAssistant)
            : enforcerResult.override;

        if (bootstrapActive && finalOverride) {
          this.bootstrapMemory!.addMessage(
            this.userId,
            finalOverride,
            'assistant',
            undefined,
            undefined,
            this.sessionCounter,
            Date.now(),
          );
        }

        const guardedOverride = enforceIdentity(finalOverride);

        const overrideResult = {
          eiv: eivResult,
          prompt: '(persona enforcer override)',
          llmOutput: guardedOverride,
          debug: {
            etv: this.lastEtvPolicy?.etvMean ?? this.etvState.value,
            band: this.lastEtvPolicy?.band ?? 'B0',
            anchorsUsed: memServiceAnchors.length,
            schemasUsed: memServiceSemanticCount,
            degraded: { falkor: this.falkorDegraded, chroma: this.chromaDegraded },
            stmTurns: sessionHistory?.length ?? 0,
            behaviorMode: {
              band: currentBand,
              intensityLevel: classifyIntensity(currentEiv),
              anchorIntegration: memServiceAnchors.length > 0,
              degradedMode: memServiceDegraded.falkor || memServiceDegraded.chroma,
            },
            ...(bootstrapActive ? { bootstrapActive: true, bootstrapInjected: !!bootstrapContextStr } : {}),
            personaEnforcer: enforcerResult.debug,
          },
        };
        this.lastDecision = overrideResult;
        return overrideResult;
      }
    }

    // Name onboarding disabled for MVP — name is captured naturally via fact extraction
    // when the user includes it in conversation ("I'm Nikhil", "call me X").

    // ── Narrative State Engine: advance per-message (feature-flagged) ──
    let narrativeMomentum: NarrativeMomentumBlock | undefined;
    if (featureFlags.narrativeStateEngineEnabled) {
      if (!this.narrativeEngine) {
        this.narrativeEngine = new NarrativeStateEngine();
      }
      this.narrativeEngine.advance({ userText: userMessage, eiv: eivResult.value });
      narrativeMomentum = this.narrativeEngine.toMomentumBlock();
    }

    // ── Response Shape Contract: structural reply guidance (feature-flagged) ──
    let responseShapeContract: ResponseShapeResult | undefined;
    if (featureFlags.responseShapeContractEnabled && narrativeMomentum) {
      responseShapeContract = buildResponseShapeContract({
        band: currentBand,
        guidanceMode,
        narrative: {
          phase: narrativeMomentum.currentPhase,
          strategy: narrativeMomentum.suggestedStrategy,
          theme: narrativeMomentum.dominantTheme,
          trajectory: narrativeMomentum.emotionalTrajectory,
        },
        intensityLevel: classifyIntensity(currentEiv),
      });
    }

    // ── Multi-Perspective Engine (external Python microservice) ──
    let perspectiveAnalysis: PerspectiveAnalyzeResponse | null = null;
    if (featureFlags.multiPerspectiveEnabled) {
      try {
        perspectiveAnalysis = await fetchPerspectiveAnalysis(
          userMessage,
          sessionHistory,
          undefined,
          perspectiveMode,
        );
      } catch (err) {
        // Swallow — LoRa works without perspectives
        console.warn('[LoRa::Perspective] Unexpected error:', err);
      }
    }

    // ── Deep reasoning: clarification needed (question too ambiguous) ──
    if (perspectiveMode === 'deep' && perspectiveAnalysis?.needs_clarification && perspectiveAnalysis.clarification_question) {
      console.log('[LoRa::DeepReasoning] question ambiguous — asking clarification');

      this.messageCount++;
      this.lastMessageTimestampMs = Date.now();

      const decision = {
        eiv: eivResult,
        prompt: '[deep_reasoning: clarification needed]',
        llmOutput: perspectiveAnalysis.clarification_question,
        deepClarification: true as const,
        debug: {
          etv: this.lastEtvPolicy?.etvMean ?? this.etvState.value,
          band: this.lastEtvPolicy?.band ?? 'B0',
          anchorsUsed: memServiceAnchors.length,
          schemasUsed: memServiceSemanticCount,
          degraded: { falkor: this.falkorDegraded, chroma: this.chromaDegraded },
          stmTurns: sessionHistory?.length ?? 0,
        },
      };

      this.lastDecision = decision;
      this.activeExecution = undefined;
      return decision;
    }

    // ── Deep reasoning mode: synthesis IS the reply, skip LLM call ──
    if (perspectiveMode === 'deep' && perspectiveAnalysis?.synthesis) {
      const guardedSynthesis = enforceIdentity(perspectiveAnalysis.synthesis);

      console.log(
        `[LoRa::DeepReasoning] synthesis received — ` +
        `${guardedSynthesis.length} chars, ` +
        `formation=${perspectiveAnalysis.formation_chosen}, ` +
        `dominance=${perspectiveAnalysis.dominance}, ` +
        `engine=${perspectiveAnalysis.processing_time_ms}ms`,
      );

      this.messageCount++;
      this.lastMessageTimestampMs = Date.now();

      const decision = {
        eiv: eivResult,
        prompt: '[deep_reasoning: synthesis used directly]',
        llmOutput: guardedSynthesis,
        deepAnalysis: true as const,
        deepMeta: {
          conflict_summary: perspectiveAnalysis.conflict_summary,
          dominance: perspectiveAnalysis.dominance,
          dimensions_detected: perspectiveAnalysis.dimensions_detected,
          frameworks_evaluated: perspectiveAnalysis.frameworks_evaluated,
          combinations_scored: perspectiveAnalysis.combinations_scored,
          formation_chosen: perspectiveAnalysis.formation_chosen,
          formation_reasoning: perspectiveAnalysis.formation_reasoning,
          processing_time_ms: perspectiveAnalysis.processing_time_ms,
        },
        debug: {
          etv: this.lastEtvPolicy?.etvMean ?? this.etvState.value,
          band: this.lastEtvPolicy?.band ?? 'B0',
          anchorsUsed: memServiceAnchors.length,
          schemasUsed: memServiceSemanticCount,
          degraded: { falkor: this.falkorDegraded, chroma: this.chromaDegraded },
          stmTurns: sessionHistory?.length ?? 0,
        },
      };

      this.lastDecision = decision;
      this.activeExecution = undefined;
      return decision;
    }

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
      ...(this.lastEtvPolicy ? { etvPolicy: this.lastEtvPolicy } : {}),
      ...(memoryContext && (featureFlags.memoryV1Enabled || featureFlags.memoryV1ShadowEnabled)
        ? { memoryContext }
        : {}),
      ...(memServiceAnchors.length > 0 ? { relevantAnchors: memServiceAnchors } : {}),
      ...(memServiceDegraded.falkor || memServiceDegraded.chroma
        ? { degraded: memServiceDegraded }
        : {}),
      band: currentBand,
      eiv: currentEiv,
      ...(sessionHistory && sessionHistory.length > 0 ? { sessionHistory } : {}),
      ...(bootstrapContextStr ? { bootstrapContext: bootstrapContextStr } : {}),
      ...(narrativeMomentum ? { narrativeMomentum } : {}),
      ...(responseShapeContract ? { responseShapeContract } : {}),
      volatility: { value: sessionVolatility.value, state: sessionVolatility.state },
      ...(appraisalResult ? {
        signalContext: {
          escalationLevel: gradientEscalation?.numericLevel ?? appraisalResult.escalation.level,
          collapseEvent: appraisalResult.collapse.event,
          pressureScalar: appraisalResult.pressure.scalar,
          pressureVolatility: appraisalResult.pressure.volatility,
          moodCategory: appraisalResult.mood.category,
          moodDominance: appraisalResult.mood.dominance,
          agencyDeficit: appraisalResult.postClarity.agencyDeficit,
          maskedPressure: lpiResult?.maskedPressure,
          maskedPressurePersistent,
          volatilityTrend,
          escalationState: gradientEscalation?.state,
          escalationTrend: gradientEscalation?.trend,
          ekmanInfluenceApplied: ekmanWeightResult?.applied,
        },
      } : {}),
      userId: this.userId,
      messageId: `msg-${this.messageCount}`,
      ...(perspectiveAnalysis && perspectiveAnalysis.perspectives.length > 0 ? {
        perspectiveAnalysis: {
          perspectives: perspectiveAnalysis.perspectives.map(p => ({
            framework: p.framework,
            label: p.label,
            condensed: p.condensed,
            strength: p.strength,
          })),
          // Only pass tension/decision_point if they have content (deep mode)
          ...(perspectiveAnalysis.tension ? { tension: perspectiveAnalysis.tension } : {}),
          ...(perspectiveAnalysis.decision_point ? { decision_point: perspectiveAnalysis.decision_point } : {}),
        },
      } : {}),
      ...(this.memoryV2Context && this.memoryV2Context.relatedFacts.length > 0 ? {
        memoryV2: this.memoryV2Context,
      } : {}),
      ...(() => {
        const offerDeep = featureFlags.perspectiveDeepModeEnabled && this.shouldOfferDeepAnalysis();
        if (offerDeep) this.markDeepAnalysisOffered();
        return offerDeep ? { deepAnalysisOfferHint: true } : {};
      })(),
    });

    // ── Memory V1: debug snapshot (zero behavior impact) ──
    if (featureFlags.memoryV1DebugEnabled && memoryV1Result) {
      try {
        const encoderMode: 'baseline' | 'enhanced' =
          appraisalResult && featureFlags.appraisalBridgeEnabled ? 'enhanced' : 'baseline';
        const snapshot = buildMemoryV1DebugSnapshot({
          userId: this.userId,
          sessionId: this.currentSessionId ?? undefined,
          messageId: `msg-${this.messageCount}`,
          encoderMode,
          wroteEpisode: memoryV1Result.salience.shouldWrite,
          noMatch: memoryV1Result.retrievalResult.noMatch,
          topSchemaIds: memoryV1Result.retrievalResult.topSchemaIds,
          winnerSchemaId: memoryV1Result.retrievalResult.winnerId ?? null,
          memoryContext: memoryContext ? {
            sessionPattern: memoryContext.sessionPattern,
            confidenceLevel: memoryContext.confidenceLevel,
          } : null,
          etvPolicy: this.lastEtvPolicy ? { band: this.lastEtvPolicy.band } : null,
        });
        console.log('[LoRa::MemoryV1Debug]', JSON.stringify(snapshot));
      } catch {
        // Debug must never crash the pipeline
      }
    }

    const systemPrompt = prompt;
    const rawUserMessage = userMessage ?? '';

    if (process.env.LORA_DEBUG_PROMPT_SIGNALS === '1') {
      console.log('[LoRa::PromptSignals]', {
        ekmanDominant: emotionalState.ekmanDominant ?? 'none',
        ekmanConfidence: emotionalState.ekmanConfidence ?? 0,
        volatility: sessionVolatility.state,
        volatilityValue: +sessionVolatility.value.toFixed(4),
        volatilityTrend: volatilityTrend ?? 'none',
        escalation: appraisalResult?.escalation.level ?? 0,
        gradientEscalation: gradientEscalation?.state ?? 'none',
        escalationTrend: gradientEscalation?.trend ?? 'none',
        lpi: lpiResult ? +lpiResult.smoothed.toFixed(4) : 0,
        maskedPressure: lpiResult?.maskedPressure ?? false,
        ekmanInfluence: ekmanWeightResult?.applied ?? false,
        guidanceMode,
      });
    }

    if (debugEnabled) {
      console.log('[LoRa::Audit][Prompt] role separation', {
        systemPromptLength: systemPrompt.length,
        userMessageLength: rawUserMessage.length,
      });
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
      systemPrompt,
      rawUserMessage,
      decision,
      fallbackContext,
      sessionHistory,
    );

    // ── Bootstrap Memory: record assistant reply summary ──
    if (bootstrapActive && llmOutput) {
      this.bootstrapMemory!.addMessage(
        this.userId,
        llmOutput,
        'assistant',
        undefined,
        undefined,
        this.sessionCounter,
        Date.now(),
      );
    }

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

      avi: {
        value: sessionVolatility.value,
        state: sessionVolatility.state,
      },

      ...(emotionalState.ekmanDominant ? {
        ekman: {
          dominant: emotionalState.ekmanDominant,
          confidence: emotionalState.ekmanConfidence ?? 0,
        },
      } : {}),

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
      ...(this.appraisalBridge && appraisalResult && lpiResult
        ? { lpi: { raw: lpiResult.raw, smoothed: lpiResult.smoothed, maskedPressure: lpiResult.maskedPressure } }
        : {}),
      ...(this.appraisalBridge && appraisalResult && maskedPressurePersistent ? { maskedPressurePersistent: true } : {}),
      ...(this.appraisalBridge && appraisalResult && volatilityTrend ? { volatilityTrend } : {}),
      ...(this.appraisalBridge && appraisalResult && gradientEscalation
        ? { gradientEscalation: { state: gradientEscalation.state, numericLevel: gradientEscalation.numericLevel, trend: gradientEscalation.trend } }
        : {}),
      ...(ekmanWeightResult?.applied ? { ekmanInfluenceApplied: true } : {}),
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

    // ── Memory Service: save (fire-and-forget, gated by memoryServiceEnabled) ──
    if (featureFlags.memoryServiceEnabled && this.memoryService) {
      const currentBandRaw = this.lastEtvPolicy?.band.replace('BAND_', 'B');
      const band = (currentBandRaw === 'B0' || currentBandRaw === 'B1' || currentBandRaw === 'B2' || currentBandRaw === 'B3' || currentBandRaw === 'B4')
        ? currentBandRaw as EmotionBand
        : undefined;

      const saveInput: MemorySaveInput = {
        userId: this.userId,
        messageId: `msg-${this.messageCount}`,
        content: userMessage,
        timestamp: messageTimestampMs,
        emotion: {
          valence: analyzerOutputs.valence.score,
          arousal: analyzerOutputs.arousal.score,
          expressionStrength: analyzerOutputs.expressionStrength.score,
          inferenceReliability: Math.min(
            analyzerOutputs.valence.confidence,
            analyzerOutputs.arousal.confidence,
            analyzerOutputs.expressionStrength.confidence,
          ),
        },
        metrics: {
          etv: this.etvState.value * 100,
          eiv: eivResult.value * 100,
          ...(band ? { band } : {}),
        },
        sessionId: this.currentSessionId ?? undefined,
        emotionVec: [
          analyzerOutputs.valence.score,
          analyzerOutputs.arousal.score,
          analyzerOutputs.expressionStrength.score,
          Math.min(
            analyzerOutputs.valence.confidence,
            analyzerOutputs.arousal.confidence,
            analyzerOutputs.expressionStrength.confidence,
          ),
        ],
      };

      const sessionIdCapture = this.currentSessionId;
      this.memoryService.saveMessage(saveInput).then((result) => {
        if (decisionLogEnabled) {
          const log = makeMemoryServiceSaveLog({
            userId: this.userId,
            sessionId: sessionIdCapture ?? undefined,
            messageId: saveInput.messageId,
            tsMs: Date.now(),
            ok: result.ok,
            wroteFalkor: result.wroteFalkor,
            wroteChroma: result.wroteChroma,
            degraded: result.degraded,
          });
          console.log('[LoRa::MemoryServiceSave]', JSON.stringify(log));
        }
      }).catch(() => {
        // Save failure must never surface
      });
    }

    const guardedLlmOutput = enforceIdentity(llmOutput);

    const result = {
      eiv: eivResult,
      prompt,
      llmOutput: guardedLlmOutput,
      debug: {
        etv: this.lastEtvPolicy?.etvMean ?? this.etvState.value,
        band: this.lastEtvPolicy?.band ?? 'B0',
        anchorsUsed: memServiceAnchors.length,
        schemasUsed: memServiceSemanticCount,
        degraded: { falkor: this.falkorDegraded, chroma: this.chromaDegraded },
        stmTurns: sessionHistory?.length ?? 0,
        behaviorMode: {
          band: currentBand,
          intensityLevel: classifyIntensity(currentEiv),
          anchorIntegration: memServiceAnchors.length > 0,
          degradedMode: memServiceDegraded.falkor || memServiceDegraded.chroma,
        },
        ...(bootstrapActive ? { bootstrapActive: true, bootstrapInjected: !!bootstrapContextStr } : {}),
        ...(featureFlags.personaEnforcerEnabled ? { personaEnforcer: { triggered: false, kind: 'none' as const } } : {}),
        ...(responseShapeContract ? { responseShapeContract: { enabled: true, contractId: responseShapeContract.contractId } } : {}),
        systemPromptLength: systemPrompt.length,
        userMessageLength: rawUserMessage.length,
      },
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
      (this.sessionEIVs.length || 1);

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

    // ── ETV V1: parallel Beta-with-decay update; summary.eivMean feeds tier when both enabled ──
    let sessionSummary: import('../etv').SessionSummaryV1 | undefined;
    if (featureFlags.etvV1Enabled) {
      const now = Date.now();
      sessionSummary = buildSessionSummary({
        sessionId,
        userId: this.userId,
        startedAt: this.sessionStartedAt || now,
        endedAt: now,
        messageCount: this.messageCount,
        eivBuffer: this.sessionEIVs,
        aviBuffer: this.sessionAVIs,
        hasViolation: this.sessionHasViolation,
      });

      try {
        const { policy, log } = ETVEngineV1.updateFromSession(sessionSummary!);
        this.lastEtvPolicy = policy;
        DecisionLogger.logETVUpdateV1({
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
          effectiveN: log.effectiveN,
          riskAdjusted: log.riskAdjusted,
          conf: log.conf,
          messageCount: log.messageCount,
          eivMean: log.eivMean,
          aviMean: log.aviMean,
        });
      } catch (err) {
        if (debugEnabled) {
          console.error('[LoRa::ETVv1] Update failed:', err);
        }
      }
    }

    // ── Memory V1: consolidate and persist ──
    if (
      (featureFlags.memoryV1Enabled || featureFlags.memoryV1ShadowEnabled) &&
      this.memoryV1State &&
      this.memoryV1Storage
    ) {
      try {
        const nowMs = Date.now();
        const endResult = memV1EndSession(this.memoryV1State, nowMs);
        this.memoryV1State = endResult.nextState;

        const storedState: StoredMemoryV1State = {
          version: 1,
          userId: this.userId,
          savedAtMs: nowMs,
          schemas: endResult.nextState.schemas.schemas,
          episodic: [],
          rifGuard: endResult.nextState.rifGuard,
        };
        this.memoryV1Storage.save(storedState);

        if (decisionLogEnabled) {
          const cr = endResult.consolidationResult;
          const log = makeMemoryConsolidateLog({
            userId: this.userId,
            sessionId: sessionId,
            tsMs: nowMs,
            createdCount: cr.createdSchemaIds.length,
            mergedCount: cr.mergedPairs.length,
            prunedCount: cr.prunedSchemaIds.length,
            episodesEvicted: 0,
            totalSchemas: cr.updatedSchemas.length,
            totalEpisodes: 0,
            noveltyFlag: cr.noveltyFlag,
          });
          console.log(`[LoRa::Memory]`, JSON.stringify(log));
        }
      } catch {
        if (debugEnabled) {
          console.error('[LoRa::MemoryV1] endSession consolidation failed');
        }
      }
    }

    // ── Fact Anchor lifecycle maintenance (fire-and-forget, gated) ──
    if (this.memoryServiceEnabled && this.memoryService) {
      const maintainSessionId = sessionId;
      const maintainNowMs = Date.now();
      this.memoryService.maintainAnchors(this.userId, maintainSessionId, maintainNowMs).catch(() => {
        if (!this.degradedLogged.falkor) {
          this.falkorDegraded = true;
          this.degradedLogged.falkor = true;
        }
      });
    }

    // ── Bootstrap Memory: increment session + graduation check ──
    if (featureFlags.bootstrapMemoryEnabled && this.bootstrapMemory) {
      try {
        const nowMs = Date.now();
        this.bootstrapMemory.incrementSession(this.userId, nowMs);
        if (this.bootstrapMemory.shouldGraduate(this.userId, featureFlags.bootstrapMemorySessionThreshold)) {
          const graduation = this.bootstrapMemory.graduate(this.userId);
          if (graduation.graduated && debugEnabled) {
            console.log('[LoRa::Bootstrap] Graduated', {
              userId: this.userId,
              candidates: graduation.anchorCandidates.length,
              purged: graduation.purged,
            });
          }
        }
      } catch {
        if (debugEnabled) {
          console.error('[LoRa::Bootstrap] endSession error');
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
    this.deepAnalysisPending = false;
    this.deepAnalysisOffered = false;
    this.overrideCooldownRemaining = 0;
    this.lastStickyHints = {};
    this.hintHoldsRemaining = {};
    this.guidanceDwellRemaining = 0;
    this.guidanceDwellMode = null;
    this.chromaDegraded = false;
    this.falkorDegraded = false;
    this.degradedLogged = { chroma: false, falkor: false, dual: false };
    this.narrativeEngine?.reset();

    return { newETV };
  }

  /**
   * Purge all user data including bootstrap memory.
   * Call this in addition to MemoryService.purgeUser() when deleting a user.
   */
  purgeBootstrapData(): void {
    if (this.bootstrapMemory) {
      this.bootstrapMemory.purge(this.userId);
    }
  }

  // ---------------------------------------------------
  // Memory V1 helpers
  // ---------------------------------------------------
  private initMemoryV1(): void {
    if (!this.memoryV1Storage) {
      this.memoryV1Storage = createJSONStorage(this.memoryV1BaseDir);
    }
    try {
      const stored = this.memoryV1Storage.load(this.userId);
      this.memoryV1State = stored
        ? {
            userId: stored.userId,
            episodic: createBuffer(),
            schemas: { userId: stored.userId, schemas: stored.schemas, maxSchemas: 20 },
            rifGuard: stored.rifGuard,
          }
        : createMemoryV1(this.userId);
    } catch {
      this.memoryV1State = createMemoryV1(this.userId);
    }
  }

  private processMemoryV1Message(
    eivValue: number,
    analyzerOutputs: AnalyzerOutputs,
    emotionalState: EmotionalState,
    momentum: { confidence: number; valenceBias: number; arousalBias: number },
    appraisalResult: AppraisalResult | undefined,
    timestampMs: number,
    memPolicy?: import('../memory-v1/policyTypes').MemoryV1Policy,
  ): MemoryProcessMessageOutput | null {
    if (!this.memoryV1State) return null;

    const dominant = emotionalState.dominant;
    const dominantEmotion: DominantEmotion | undefined =
      VALID_DOMINANT_EMOTIONS.has(dominant)
        ? (dominant as DominantEmotion)
        : undefined;

    const avi = AVIScorer.computeAVI(this.sessionEIVs);

    const input: MemoryProcessMessageInput = {
      encoderInput: {
        eivValue,
        valenceScore: analyzerOutputs.valence.score,
        arousalScore: analyzerOutputs.arousal.score,
        expressionStrength: analyzerOutputs.expressionStrength.score,
        dominantEmotion,
        avi,
        valenceBias: momentum.valenceBias,
        arousalBias: momentum.arousalBias,
        momentumConfidence: momentum.confidence,
        ...(appraisalResult && featureFlags.appraisalBridgeEnabled
          ? {
              appraisalBridgeEnabled: true,
              pressureScalar: appraisalResult.pressure.scalar,
              pressureSlope: appraisalResult.pressure.slope,
              pressureVolatility: appraisalResult.pressure.volatility,
              escalationScore: appraisalResult.escalation.score,
              collapseSeverity: appraisalResult.collapse.event ? 1.0 : 0.0,
            }
          : {}),
      },
      eventId: `msg-${this.messageCount}`,
      timestampMs,
      ...(memPolicy ? { policy: memPolicy } : {}),
    };

    try {
      const result = memV1ProcessMessage(this.memoryV1State, input);
      this.memoryV1State = result.nextState;
      return result;
    } catch {
      return null;
    }
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

  /** Debug/test only: masked pressure history length. Bridge OFF must keep this 0. */
  getDebugMaskedPressureHistoryLength(): number {
    return this.maskedPressureHistory.length;
  }

  private getResponder(): LLMResponder {
    if (!this.responder) {
      this.responder = this.responderFactory();
    }
    return this.responder;
  }

  private async generateLLMResponse(
    systemPrompt: string,
    userMessage: string,
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
    },
    sessionHistory?: import('../prompt/PromptTemplateBuilder').ChatTurn[],
  ): Promise<string> {
    const now = Date.now();
    if (this.llmAvailability === 'UNAVAILABLE') {
      if (stressTestMode) {
        this.llmAvailability = 'AVAILABLE';
        this.llmCooldownUntil = null;
        this.llmCooldownStartedAt = null;
        console.warn('[LORA_STRESS_TEST] cooldown bypassed');
        this.logLLMEvent('cooldown_bypassed_stress_test');
      } else if (
        this.llmCooldownUntil !== null &&
        now >= this.llmCooldownUntil
      ) {
        this.llmAvailability = 'AVAILABLE';
        this.llmCooldownUntil = null;
        this.llmCooldownStartedAt = null;
        this.logLLMEvent('cooldown_exit');
      } else {
        const normalizedUserText = fallbackContext.userText.toLowerCase();
        const quickQuestionPatterns = [
          'should i',
          'what do you think',
          'what would you do',
          'how do i',
        ];
        const pastRecoveryThreshold =
          this.llmCooldownStartedAt !== null &&
          this.llmCooldownUntil !== null &&
          now >=
            this.llmCooldownStartedAt +
              (this.llmCooldownUntil - this.llmCooldownStartedAt) *
                MASTER_CONSTANTS.llm.cooldownRetryRecoveryRatio;
        const shouldAttemptDuringCooldown =
          pastRecoveryThreshold ||
          normalizedUserText.includes('?') ||
          quickQuestionPatterns.some((pattern) =>
            normalizedUserText.includes(pattern)
          ) ||
          fallbackContext.userText.length <=
            MASTER_CONSTANTS.llm.quickMessageMaxChars;

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
        const payload = {
          signal: controller.signal,
          requestId,
          sessionHistory: sessionHistory ?? [],
        };
        if (process.env.NODE_ENV === 'test') {
          console.log(Object.keys(payload));
        }
        const response = await this.getResponder().generateResponse(
          systemPrompt,
          userMessage,
          payload
        );
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

    if (stressTestMode) {
      const errMsg = lastError instanceof Error ? lastError.message : String(lastError ?? 'LLM retries exhausted');
      console.warn('[LORA_STRESS_TEST] fallback prevented — retries exhausted, surfacing real error');
      throw new Error(`LLM retries exhausted (${attempts} attempts): ${errMsg}`);
    }

    // If already in cooldown (recovery attempt failed), don't extend — let original timer expire.
    const alreadyInCooldown = this.llmAvailability === 'UNAVAILABLE' && this.llmCooldownUntil !== null;
    if (!alreadyInCooldown) {
      this.llmAvailability = 'UNAVAILABLE';
      this.llmCooldownStartedAt = now;
      const cooldownMs = this.llmConfig.cooldownMs;
      this.llmCooldownUntil = now + cooldownMs;
      this.logLLMEvent('cooldown_entry', {
        cooldownUntil: this.llmCooldownUntil,
      });
    } else {
      this.logLLMEvent('cooldown_recovery_failed', {
        cooldownUntil: this.llmCooldownUntil,
      });
    }
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

  static computeSessionVolatility(
    eivBuffer: readonly number[],
    windowSize: number = MASTER_CONSTANTS.eiv.volatility.windowSize,
  ): { value: number; state: VolatilityState } {
    if (eivBuffer.length < 2) return { value: 0, state: 'LOW' };
    const start = Math.max(0, eivBuffer.length - windowSize);
    const window = eivBuffer.slice(start);
    if (window.length < 2) return { value: 0, state: 'LOW' };

    let sumAbsDiffs = 0;
    for (let i = 1; i < window.length; i++) {
      sumAbsDiffs += Math.abs(window[i] - window[i - 1]);
    }
    const volatility = sumAbsDiffs / (window.length - 1);

    const VOL = MASTER_CONSTANTS.eiv.volatility;
    let state: VolatilityState;
    if (volatility > VOL.highMinExclusive) state = 'HIGH';
    else if (volatility >= VOL.mediumMinInclusive) state = 'MEDIUM';
    else state = 'LOW';

    return { value: volatility, state };
  }

  private static fallbackResponse(): string {
    if (stressTestMode) {
      console.warn('[LORA_STRESS_TEST] fallback prevented');
      throw new Error(
        'LLM fallback triggered during stress test — this masks real provider failures. ' +
        'The canned response would have been returned instead of a real LLM reply.',
      );
    }
    return 'Connection interrupted. State your question again and I will address it directly.';
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
      return 'Narrow it down: what is the one specific decision you need to make right now?';
    }

    if ((isHighArousal || strongExpressivity) && isNegative) {
      return 'State the problem in one sentence. What exactly broke down?';
    }

    if (isHighArousal && isPositive) {
      return 'Good. What is the next concrete step from here?';
    }

    return 'What specifically do you need to work through right now?';
  }
}