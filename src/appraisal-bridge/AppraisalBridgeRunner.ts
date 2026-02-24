import type { LayerASnapshot, AppraisalResult } from './types';
import { mapAppraisalResult } from './mapAppraisalResult';

// ── Appraisal-lab engine imports (runtime) ──────────────────────────
import { updatePressureWithTime } from '../appraisal-lab/time-engine';
import { classifyFamily } from '../appraisal-lab/family-engine';
import type { FamilyVector as VFamilyVector } from '../appraisal-lab/vector-pressure-engine';
import {
  createVectorPressureState,
  updateVectorPressureState,
} from '../appraisal-lab/vector-pressure-engine';
import type { VectorPressureState } from '../appraisal-lab/vector-pressure-engine';
import {
  createPressureState,
  updatePressureState,
} from '../appraisal-lab/pressure-engine';
import type { PressureState } from '../appraisal-lab/pressure-engine';
import {
  createMoodState,
  updateMoodState,
  EmotionFamily,
} from '../appraisal-lab/mood-engine';
import type {
  MoodState,
  FamilyVector as MoodFamilyVector,
} from '../appraisal-lab/mood-engine';
import {
  createEscalationState,
  updateEscalationState,
} from '../appraisal-lab/escalation-engine';
import type { EscalationState } from '../appraisal-lab/escalation-engine';
import {
  createCollapseState,
  updateCollapseState,
  MoodCategory as CollapseMoodCategory,
} from '../appraisal-lab/collapse-engine';
import type { CollapseState } from '../appraisal-lab/collapse-engine';
import {
  createPostClarityState,
  updatePostClarityState,
} from '../appraisal-lab/post-clarity-engine';
import type {
  PostClarityState,
  CollapseDirection as PostCollapseDirection,
} from '../appraisal-lab/post-clarity-engine';
import { deriveInterventionPolicy } from '../appraisal-lab/intervention-policy-engine';

// ── Constants ───────────────────────────────────────────────────────

const BASELINE_LATENCY_SECONDS = 90;
const BURST_THRESHOLD_SECONDS = 2;
const SILENCE_THRESHOLD_SECONDS = 2100;

// ── Type conversion helpers (mirrors cross-module-stability/runner) ─

function toMoodFamilyVector(v: VFamilyVector): MoodFamilyVector {
  return {
    [EmotionFamily.JOY]: v.JOY,
    [EmotionFamily.ANGER]: v.ANGER,
    [EmotionFamily.FEAR]: v.FEAR,
    [EmotionFamily.SADNESS]: v.SADNESS,
    [EmotionFamily.SURPRISE]: v.SURPRISE,
    [EmotionFamily.DISGUST]: v.DISGUST,
  };
}

function toCollapseMoodCategory(input: string): CollapseMoodCategory {
  const valid: string[] = [
    'POSITIVE',
    'IRRITABLE',
    'ANXIOUS',
    'MELANCHOLIC',
    'ALERT',
    'AVERSIVE',
    'NEUTRAL',
  ];
  return valid.includes(input)
    ? (input as CollapseMoodCategory)
    : CollapseMoodCategory.NEUTRAL;
}

function toPostCollapseDirection(d: string): PostCollapseDirection {
  if (d === 'OUTWARD' || d === 'INWARD' || d === 'NONE') return d;
  return 'NONE';
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ── Runner ──────────────────────────────────────────────────────────

export class AppraisalBridgeRunner {
  private vectorState: VectorPressureState;
  private pressureState: PressureState;
  private moodState: MoodState;
  private escalationState: EscalationState;
  private collapseState: CollapseState;
  private postClarityState: PostClarityState;

  private scalarPressure = 0;
  private prevScalarPressure = 0;

  constructor() {
    this.vectorState = createVectorPressureState();
    this.pressureState = createPressureState(0);
    this.moodState = createMoodState();
    this.escalationState = createEscalationState();
    this.collapseState = createCollapseState();
    this.postClarityState = createPostClarityState();
  }

  reset(): void {
    this.vectorState = createVectorPressureState();
    this.pressureState = createPressureState(0);
    this.moodState = createMoodState();
    this.escalationState = createEscalationState();
    this.collapseState = createCollapseState();
    this.postClarityState = createPostClarityState();
    this.scalarPressure = 0;
    this.prevScalarPressure = 0;
  }

  step(snapshot: LayerASnapshot): AppraisalResult {
    const delta = Math.max(0, snapshot.deltaMessageSeconds);
    const valence = clamp(snapshot.valenceScore, -1, 1);
    const arousal = clamp(snapshot.arousalScore, 0, 1);
    const es = clamp(snapshot.expressionStrength, 0, 1);
    const eiv = clamp(snapshot.eivValue, 0, 1);

    const signals = snapshot.patternSignals ?? {
      capsRatio: 0,
      punctuationHits: 0,
      emojiHits: 0,
      repetitionScore: 0,
      questionMarks: 0,
    };

    // ── 1. Time ─────────────────────────────────────────────────────
    const timeOut = updatePressureWithTime(
      this.scalarPressure,
      delta,
      delta,
      BASELINE_LATENCY_SECONDS
    );
    const gain = Math.max(0, timeOut.gainModifier);
    const pressureAfterDecay = Math.max(0, timeOut.pressureAfterDecay);

    // ── 2. Family classification ────────────────────────────────────
    const familyOut = classifyFamily({
      valence,
      arousal,
      expressionStrength: es,
      signals: {
        capsRatio: clamp(signals.capsRatio, 0, 1),
        punctuationHits: Math.max(0, signals.punctuationHits),
        emojiHits: Math.max(0, signals.emojiHits),
        repetitionScore: clamp(signals.repetitionScore, 0, 1),
        questionMarks: Math.max(0, signals.questionMarks),
      },
      deltaMessageSeconds: delta,
      gain,
    });

    // ── 3. Vector pressure ──────────────────────────────────────────
    const prevVector = this.vectorState.pressureByFamily;
    const prevTotal = Math.max(
      1e-9,
      prevVector.JOY +
        prevVector.ANGER +
        prevVector.FEAR +
        prevVector.SADNESS +
        prevVector.SURPRISE +
        prevVector.DISGUST
    );
    const pressureAfterDecayByFamily: VFamilyVector = {
      JOY: pressureAfterDecay * (prevVector.JOY / prevTotal),
      ANGER: pressureAfterDecay * (prevVector.ANGER / prevTotal),
      FEAR: pressureAfterDecay * (prevVector.FEAR / prevTotal),
      SADNESS: pressureAfterDecay * (prevVector.SADNESS / prevTotal),
      SURPRISE: pressureAfterDecay * (prevVector.SURPRISE / prevTotal),
      DISGUST: pressureAfterDecay * (prevVector.DISGUST / prevTotal),
    };

    const vectorOut = updateVectorPressureState(this.vectorState, {
      pressureAfterDecayByFamily,
      familyWeights: {
        JOY: familyOut.familyWeights.JOY,
        ANGER: familyOut.familyWeights.ANGER,
        FEAR: familyOut.familyWeights.FEAR,
        SADNESS: familyOut.familyWeights.SADNESS,
        SURPRISE: familyOut.familyWeights.SURPRISE,
        DISGUST: familyOut.familyWeights.DISGUST,
      },
      confidence: clamp(familyOut.confidence * (0.4 + 0.6 * es), 0, 1),
      gain,
      deltaMessageSeconds: delta,
    });
    this.vectorState = vectorOut.state;

    // ── 4. Scalar pressure (slope + volatility for escalation) ──────
    // TEMP SURROGATE UNTIL LAYER-A ADAPTER IS WIRED:
    // activation derived from eivValue scaled by expressionStrength.
    const activation = eiv * (0.65 + 0.35 * es);

    const pressureOut = updatePressureState(this.pressureState, {
      pressureAfterDecay,
      gain,
      activation,
      deltaMessageSeconds: delta,
    });
    this.pressureState = pressureOut.state;
    this.prevScalarPressure = this.scalarPressure;
    this.scalarPressure = Math.max(0, pressureOut.outputs.pressure);

    // ── 5. Mood ─────────────────────────────────────────────────────
    const moodOut = updateMoodState(this.moodState, {
      familyWeights: toMoodFamilyVector(vectorOut.output.pressureByFamily),
      pressureVector: toMoodFamilyVector(vectorOut.output.pressureByFamily),
      deltaMessageSeconds: delta,
      escalationLevel: this.escalationState.level,
      isShock: vectorOut.output.isShock,
    });
    this.moodState = moodOut.state;

    // ── 6. Escalation ───────────────────────────────────────────────
    const escalationOut = updateEscalationState(this.escalationState, {
      slope: pressureOut.outputs.slope,
      volatility: pressureOut.outputs.volatility,
      isShock: pressureOut.outputs.isShock,
      pressure: this.scalarPressure,
      gain,
      deltaMessageSeconds: delta,
    });
    this.escalationState = escalationOut.state;

    // ── 7. Collapse ─────────────────────────────────────────────────
    const burstFlag = delta > 0 && delta < BURST_THRESHOLD_SECONDS && eiv > 0.55;
    const silenceFlag = delta > SILENCE_THRESHOLD_SECONDS;

    const collapseOut = updateCollapseState(this.collapseState, {
      escalationLevel: escalationOut.outputs.level,
      escalationScore: escalationOut.outputs.score,
      pressure: this.scalarPressure,
      pressureSlope: pressureOut.outputs.slope,
      moodCategory: toCollapseMoodCategory(moodOut.outputs.moodCategory),
      gain,
      deltaMessageSeconds: delta,
      burstFlag,
      silenceFlag,
      negValenceHint: valence,
    });
    this.collapseState = collapseOut.state;

    // ── 8. Post-clarity ─────────────────────────────────────────────
    const postOut = updatePostClarityState(this.postClarityState, {
      collapseEvent: collapseOut.outputs.collapseEvent,
      collapseDirection: toPostCollapseDirection(
        collapseOut.outputs.collapseDirection
      ),
      escalationLevel: escalationOut.outputs.level,
      escalationScore: escalationOut.outputs.score,
      pressure: this.scalarPressure,
      pressureSlope: pressureOut.outputs.slope,
      valence,
      deltaMessageSeconds: delta,
      repetitionScore: clamp(signals.repetitionScore, 0, 1),
      gain,
    });
    this.postClarityState = postOut.state;

    // ── 9. Intervention policy ──────────────────────────────────────
    const policy = deriveInterventionPolicy({
      escalationLevel: escalationOut.outputs.level,
      escalationScore: escalationOut.outputs.score,
      collapseEvent: collapseOut.outputs.collapseEvent,
      collapseDirection: collapseOut.outputs.collapseDirection,
      postModeActive: postOut.outputs.postModeActive,
      recoveryPath: postOut.outputs.recoveryPath,
      agencyDeficit: postOut.outputs.agencyDeficit,
      moodCategory: moodOut.outputs.moodCategory,
    });

    // ── 10. Map to frozen output ────────────────────────────────────
    return mapAppraisalResult({
      timestamp: snapshot.timestampMs,

      family: {
        dominantFamily: familyOut.dominantFamily,
        weights: { ...familyOut.familyWeights },
        confidence: familyOut.confidence,
      },

      pressure: {
        scalar: this.scalarPressure,
        slope: pressureOut.outputs.slope,
        volatility: pressureOut.outputs.volatility,
        isShock: pressureOut.outputs.isShock,
        byFamily: { ...vectorOut.output.pressureByFamily },
      },

      mood: {
        category: moodOut.outputs.moodCategory,
        dominance: moodOut.outputs.moodDominance,
        confidence: moodOut.outputs.moodConfidence,
      },

      escalation: {
        level: escalationOut.outputs.level,
        score: escalationOut.outputs.score,
        flags: {
          warmedUp: escalationOut.outputs.flags.warmedUp,
          isFlapping: escalationOut.outputs.flags.isFlapping,
          enteredCritical: escalationOut.outputs.flags.enteredCritical,
        },
      },

      collapse: {
        event: collapseOut.outputs.collapseEvent,
        severity: collapseOut.outputs.collapseSeverity,
        direction: collapseOut.outputs.collapseDirection,
      },

      postClarity: {
        active: postOut.outputs.postModeActive,
        agencyDeficit: postOut.outputs.agencyDeficit,
        isRelapse: postOut.outputs.isRelapse,
        recoveryPath: postOut.outputs.recoveryPath,
      },

      intervention: {
        toneMode: policy.toneMode,
        pacingMode: policy.pacingMode,
        validationMode: policy.validationMode,
        actionMode: policy.actionMode,
        interruptionLevel: policy.interruptionLevel,
        guardrails: [...policy.guardrails],
      },
    });
  }
}
