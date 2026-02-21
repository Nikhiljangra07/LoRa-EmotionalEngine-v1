import {
  computeTimeDeltas,
  updatePressureWithTime,
} from "../time-engine";
import { classifyFamily } from "../family-engine";
import {
  createVectorPressureState,
  updateVectorPressureState,
  type FamilyVector as VFamilyVector,
} from "../vector-pressure-engine";
import {
  createMoodState,
  updateMoodState,
  EmotionFamily,
  MoodCategory as MoodEngineCategory,
  type FamilyVector as MoodFamilyVector,
} from "../mood-engine";
import {
  createEscalationState,
  updateEscalationState,
  EscalationLevel,
} from "../escalation-engine";
import {
  createCollapseState,
  updateCollapseState,
  MoodCategory as CollapseMoodCategory,
} from "../collapse-engine";
import {
  createPostClarityState,
  updatePostClarityState,
} from "../post-clarity-engine";
import { deriveInterventionPolicy } from "../intervention-policy-engine";
import {
  BASELINE_LATENCY_SECONDS,
  HASH_OFFSET,
  HASH_PRIME,
  MAX_TRACE_SAMPLES,
  PRESSURE_CAP,
  TRACE_SAMPLE_EVERY_DEFAULT,
  VECTOR_PRESSURE_CAP,
} from "./constants";
import { createDeterministicPrng } from "./deterministic_prng";
import type { ScenarioResult, ScenarioSpec, StepTrace } from "./types";

type SyntheticStepSignals = {
  deltaMessageSeconds: number;
  valence: number;
  arousal: number;
  expressionStrength: number;
  capsRatio: number;
  punctuationHits: number;
  emojiHits: number;
  repetitionScore: number;
  questionMarks: number;
  validationSeekingScore: number;
  topicShiftScore: number;
  positiveReframeScore: number;
};

function fnv1a(input: string): string {
  let hash = HASH_OFFSET >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, HASH_PRIME) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function finiteOrZero(value: number, sanitizationTags: string[]): number {
  if (!Number.isFinite(value)) {
    sanitizationTags.push("HARNESS_SANITIZED_INPUT");
    return 0;
  }
  return value;
}

function asMoodVector(v: VFamilyVector): MoodFamilyVector {
  return {
    [EmotionFamily.JOY]: v.JOY,
    [EmotionFamily.ANGER]: v.ANGER,
    [EmotionFamily.FEAR]: v.FEAR,
    [EmotionFamily.SADNESS]: v.SADNESS,
    [EmotionFamily.SURPRISE]: v.SURPRISE,
    [EmotionFamily.DISGUST]: v.DISGUST,
  };
}

function asCollapseMoodCategory(input: string): CollapseMoodCategory {
  if (
    input === "POSITIVE" ||
    input === "IRRITABLE" ||
    input === "ANXIOUS" ||
    input === "MELANCHOLIC" ||
    input === "ALERT" ||
    input === "AVERSIVE" ||
    input === "NEUTRAL"
  ) {
    return input as CollapseMoodCategory;
  }
  return CollapseMoodCategory.NEUTRAL;
}

function buildSignals(
  scenario: ScenarioSpec,
  i: number,
  prng: ReturnType<typeof createDeterministicPrng>
): SyntheticStepSignals {
  if (scenario.name === "SUITE_A_FAMILY_OSCILLATION") {
    const valenceSeq = [0.6, -0.6, -0.4, -0.7, 0.1, -0.8];
    const arousalSeq = [0.3, 0.8, 0.7, 0.4, 0.6, 0.5];
    const expressionSeq = [0.55, 0.9, 0.85, 0.65, 0.7, 0.75];
    const burst = i % 2 === 0;
    return {
      deltaMessageSeconds: burst ? 10 + (i % 3) * 10 : 90,
      valence: valenceSeq[i % valenceSeq.length],
      arousal: arousalSeq[i % arousalSeq.length],
      expressionStrength: expressionSeq[i % expressionSeq.length],
      capsRatio: burst ? 0.55 : 0.15,
      punctuationHits: burst ? 4 : 1,
      emojiHits: i % 5 === 0 ? 1 : 0,
      repetitionScore: burst ? 0.7 : 0.2,
      questionMarks: i % 4 === 0 ? 3 : 1,
      validationSeekingScore: 0.2,
      topicShiftScore: 0.2,
      positiveReframeScore: 0.2,
    };
  }

  if (scenario.name === "SUITE_B_ESC_SUB_CONFLICT") {
    if (i < 18) {
      return {
        deltaMessageSeconds: 90,
        valence: -0.1,
        arousal: 0.3,
        expressionStrength: 0.35,
        capsRatio: 0.05,
        punctuationHits: 1,
        emojiHits: 0,
        repetitionScore: 0.1,
        questionMarks: 1,
        validationSeekingScore: 0,
        topicShiftScore: 0,
        positiveReframeScore: 0,
      };
    }
    if (i < 32) {
      return {
        deltaMessageSeconds: 20,
        valence: -0.35,
        arousal: 0.78,
        expressionStrength: 0.82,
        capsRatio: 0.55,
        punctuationHits: 4,
        emojiHits: 0,
        repetitionScore: 0.35,
        questionMarks: 2,
        validationSeekingScore: 0.1,
        topicShiftScore: 0.1,
        positiveReframeScore: 0.1,
      };
    }
    if (i < 70) {
      return {
        deltaMessageSeconds: 55,
        valence: -0.2,
        arousal: 0.35,
        expressionStrength: 0.3,
        capsRatio: 0.08,
        punctuationHits: 1,
        emojiHits: 0,
        repetitionScore: 0.05,
        questionMarks: 1,
        validationSeekingScore: 0.95,
        topicShiftScore: 0.9,
        positiveReframeScore: 0.45,
      };
    }
    if (i < 78) {
      return {
        deltaMessageSeconds: 18,
        valence: -0.42,
        arousal: 0.84,
        expressionStrength: 0.88,
        capsRatio: 0.62,
        punctuationHits: 5,
        emojiHits: 0,
        repetitionScore: 0.22,
        questionMarks: 2,
        validationSeekingScore: 0.4,
        topicShiftScore: 0.3,
        positiveReframeScore: 0.2,
      };
    }
    return {
      deltaMessageSeconds: 120,
      valence: -0.05,
      arousal: 0.2,
      expressionStrength: 0.2,
      capsRatio: 0.05,
      punctuationHits: 1,
      emojiHits: 0,
      repetitionScore: 0.05,
      questionMarks: 1,
      validationSeekingScore: 0.2,
      topicShiftScore: 0.2,
      positiveReframeScore: 0.2,
    };
  }

  if (scenario.name === "SUITE_SANITIZE_MICRO") {
    if (i === 0) {
      return {
        deltaMessageSeconds: Number.NaN,
        valence: Number.POSITIVE_INFINITY,
        arousal: Number.NEGATIVE_INFINITY,
        expressionStrength: Number.NaN,
        capsRatio: Number.NaN,
        punctuationHits: Number.NaN,
        emojiHits: Number.NaN,
        repetitionScore: Number.NaN,
        questionMarks: Number.NaN,
        validationSeekingScore: Number.NaN,
        topicShiftScore: Number.NaN,
        positiveReframeScore: Number.NaN,
      };
    }
    return {
      deltaMessageSeconds: 30,
      valence: 0,
      arousal: 0.2,
      expressionStrength: 0.3,
      capsRatio: 0.1,
      punctuationHits: 1,
      emojiHits: 0,
      repetitionScore: 0.1,
      questionMarks: 1,
      validationSeekingScore: 0,
      topicShiftScore: 0,
      positiveReframeScore: 0,
    };
  }

  if (scenario.name === "SUITE_PRESSURE_DRIVEN_COLLAPSE_MICRO") {
    return {
      deltaMessageSeconds: i === 4 ? 5 : 40,
      valence: -0.1,
      arousal: 0.25,
      expressionStrength: 0.3,
      capsRatio: 0.1,
      punctuationHits: 1,
      emojiHits: 0,
      repetitionScore: 0.1,
      questionMarks: 1,
      validationSeekingScore: 0,
      topicShiftScore: 0,
      positiveReframeScore: 0,
    };
  }

  if (scenario.name === "SUITE_LONG_GAP_MICRO") {
    if (i === 0) {
      return {
        deltaMessageSeconds: 10,
        valence: 0.1,
        arousal: 0.2,
        expressionStrength: 0.2,
        capsRatio: 0.1,
        punctuationHits: 1,
        emojiHits: 0,
        repetitionScore: 0.1,
        questionMarks: 1,
        validationSeekingScore: 0,
        topicShiftScore: 0,
        positiveReframeScore: 0,
      };
    }
    if (i === 1) {
      return {
        deltaMessageSeconds: 315360000, // 10 years
        valence: -0.1,
        arousal: 0.3,
        expressionStrength: 0.4,
        capsRatio: 0.2,
        punctuationHits: 2,
        emojiHits: 0,
        repetitionScore: 0.1,
        questionMarks: 1,
        validationSeekingScore: 0,
        topicShiftScore: 0,
        positiveReframeScore: 0,
      };
    }
    return {
      deltaMessageSeconds: 15,
      valence: 0,
      arousal: 0.2,
      expressionStrength: 0.3,
      capsRatio: 0.1,
      punctuationHits: 1,
      emojiHits: 0,
      repetitionScore: 0.1,
      questionMarks: 1,
      validationSeekingScore: 0,
      topicShiftScore: 0,
      positiveReframeScore: 0,
    };
  }

  if (scenario.name === "SUITE_INWARD_COLLAPSE_MICRO") {
    return {
      deltaMessageSeconds: i === 16 ? 400 : 60,
      valence: -0.6,
      arousal: 0.2,
      expressionStrength: 0.25,
      capsRatio: 0.05,
      punctuationHits: 1,
      emojiHits: 0,
      repetitionScore: 0.1,
      questionMarks: 1,
      validationSeekingScore: 0.1,
      topicShiftScore: 0.1,
      positiveReframeScore: 0.1,
    };
  }

  const mix = prng.nextFloat01();
  let deltaMessageSeconds = 60 + Math.floor(prng.nextFloat01() * 121);
  if (mix < 0.35) {
    deltaMessageSeconds = 5 + Math.floor(prng.nextFloat01() * 26);
  } else if (mix > 0.92) {
    deltaMessageSeconds = 600 + Math.floor(prng.nextFloat01() * 6601);
  }
  if (i % 5000 === 0 && i > 0) {
    deltaMessageSeconds = 7200;
  }
  if (i % 5000 >= 200 && i % 5000 < 210) {
    deltaMessageSeconds = 12;
  }

  return {
    deltaMessageSeconds,
    valence: i % 5000 >= 200 && i % 5000 < 210 ? -0.45 : -1 + prng.nextFloat01() * 2,
    arousal: i % 5000 >= 200 && i % 5000 < 210 ? 0.85 : prng.nextFloat01(),
    expressionStrength: i % 5000 >= 200 && i % 5000 < 210 ? 0.9 : prng.nextFloat01(),
    capsRatio: i % 5000 >= 200 && i % 5000 < 210 ? 0.7 : prng.nextFloat01(),
    punctuationHits: i % 5000 >= 200 && i % 5000 < 210 ? 5 : Math.floor(prng.nextFloat01() * 7),
    emojiHits: Math.floor(prng.nextFloat01() * 4),
    repetitionScore: i % 5000 >= 200 && i % 5000 < 210 ? 0.6 : prng.nextFloat01(),
    questionMarks: i % 5000 >= 200 && i % 5000 < 210 ? 3 : Math.floor(prng.nextFloat01() * 5),
    validationSeekingScore: prng.nextFloat01(),
    topicShiftScore: prng.nextFloat01(),
    positiveReframeScore: prng.nextFloat01(),
  };
}

export function runScenario(seed: number, scenario: ScenarioSpec): ScenarioResult {
  const prng = createDeterministicPrng(seed);

  let vectorState = createVectorPressureState();
  let moodState = createMoodState();
  let escalationState = createEscalationState();
  let collapseState = createCollapseState();
  let postState = createPostClarityState();

  const traceSample: StepTrace[] = [];
  const sampleEvery = Math.max(1, scenario.traceSampleEvery ?? TRACE_SAMPLE_EVERY_DEFAULT);

  let currentTs = 1_800_000_000;
  let prevMsgTs = currentTs;
  let prevSessionTs = currentTs;

  let scalarPressure = 0;
  let prevScalarPressure = 0;
  let prevMoodCategory = moodState.moodCategory;

  let collapseCount = 0;
  let firstCollapseIndex: number | null = null;
  let criticalSteps = 0;
  let postModeSteps = 0;
  let moodCategoryChanges = 0;
  let maxEscalationLevel = 0;
  let maxEscalationScore = 0;
  let maxScalarPressure = 0;
  let maxVectorPressure = 0;
  let maxFamilyPressure = 0;
  let everSubstitute = false;
  let everSpiral = false;
  let sanitizationCount = 0;
  let collapseWithCalmEscalationCount = 0;
  let collapseWithHighEscalationCount = 0;

  for (let i = 0; i < scenario.steps; i += 1) {
    const sanitizationTags: string[] = [];
    const sig = buildSignals(scenario, i, prng);

    const deltaMessageSeconds = Math.max(
      0,
      finiteOrZero(sig.deltaMessageSeconds, sanitizationTags)
    );
    currentTs += deltaMessageSeconds;
    const deltas = computeTimeDeltas(currentTs, prevMsgTs, prevSessionTs);
    prevMsgTs = currentTs;
    prevSessionTs = currentTs;

    const timeOut = updatePressureWithTime(
      scalarPressure,
      deltas.deltaMessage,
      deltas.deltaSession,
      BASELINE_LATENCY_SECONDS
    );
    const gain = Math.max(0, finiteOrZero(timeOut.gainModifier, sanitizationTags));
    const pressureAfterDecay = Math.max(
      0,
      finiteOrZero(timeOut.pressureAfterDecay, sanitizationTags)
    );

    const valence = clamp(finiteOrZero(sig.valence, sanitizationTags), -1, 1);
    const arousal = clamp(finiteOrZero(sig.arousal, sanitizationTags), 0, 1);
    const expressionStrength = clamp(
      finiteOrZero(sig.expressionStrength, sanitizationTags),
      0,
      1
    );
    const capsRatio = clamp(finiteOrZero(sig.capsRatio, sanitizationTags), 0, 1);
    const punctuationHits = Math.max(
      0,
      finiteOrZero(sig.punctuationHits, sanitizationTags)
    );
    const emojiHits = Math.max(0, finiteOrZero(sig.emojiHits, sanitizationTags));
    const repetitionScore = clamp(
      finiteOrZero(sig.repetitionScore, sanitizationTags),
      0,
      1
    );
    const questionMarks = Math.max(
      0,
      finiteOrZero(sig.questionMarks, sanitizationTags)
    );
    const validationSeekingScore = clamp(
      finiteOrZero(sig.validationSeekingScore, sanitizationTags),
      0,
      1
    );
    const topicShiftScore = clamp(
      finiteOrZero(sig.topicShiftScore, sanitizationTags),
      0,
      1
    );
    const positiveReframeScore = clamp(
      finiteOrZero(sig.positiveReframeScore, sanitizationTags),
      0,
      1
    );

    const familyOut = classifyFamily({
      valence,
      arousal,
      expressionStrength,
      signals: {
        capsRatio,
        punctuationHits,
        emojiHits,
        repetitionScore,
        questionMarks,
      },
      deltaMessageSeconds: deltas.deltaMessage,
      gain,
    });

    const prevVector = vectorState.pressureByFamily;
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

    const vectorOut = updateVectorPressureState(vectorState, {
      pressureAfterDecayByFamily,
      familyWeights: {
        JOY: familyOut.familyWeights.JOY,
        ANGER: familyOut.familyWeights.ANGER,
        FEAR: familyOut.familyWeights.FEAR,
        SADNESS: familyOut.familyWeights.SADNESS,
        SURPRISE: familyOut.familyWeights.SURPRISE,
        DISGUST: familyOut.familyWeights.DISGUST,
      },
      confidence: clamp(familyOut.confidence * (0.4 + 0.6 * expressionStrength), 0, 1),
      gain,
      deltaMessageSeconds: deltas.deltaMessage,
    });
    vectorState = vectorOut.state;

    scalarPressure = Math.max(0, finiteOrZero(vectorOut.output.totalPressure, sanitizationTags));
    const slope =
      deltas.deltaMessage > 0 ? (scalarPressure - prevScalarPressure) / deltas.deltaMessage : 0;
    prevScalarPressure = scalarPressure;

    const moodOut = updateMoodState(moodState, {
      familyWeights: asMoodVector(vectorOut.output.pressureByFamily),
      pressureVector: asMoodVector(vectorOut.output.pressureByFamily),
      deltaMessageSeconds: deltas.deltaMessage,
      escalationLevel: escalationState.level,
      isShock: vectorOut.output.isShock,
    });
    moodState = moodOut.state;

    let escalationSlope = 0;
    let escalationVolatility = 0;
    let escalationShock = false;
    if (scenario.name === "SUITE_A_FAMILY_OSCILLATION") {
      if (i === 120 || i === 360) {
        escalationSlope = 0.008;
        escalationVolatility = 0.015;
        escalationShock = true;
      }
    } else if (scenario.name === "SUITE_B_ESC_SUB_CONFLICT") {
      if (i === 24) {
        escalationSlope = 0.01;
        escalationVolatility = 0.02;
        escalationShock = true;
      } else if (i === 72) {
        escalationSlope = 0.008;
        escalationVolatility = 0.015;
        escalationShock = true;
      }
    } else if (scenario.name === "SUITE_C_LONG_SESSION_STABILITY") {
      if (i % 5000 >= 200 && i % 5000 < 206) {
        escalationSlope = 0.008;
        escalationVolatility = 0.014;
        escalationShock = i % 2 === 0;
      }
    } else if (scenario.name === "SUITE_INWARD_COLLAPSE_MICRO") {
      if (i === 16) {
        escalationSlope = 0.01;
        escalationVolatility = 0.02;
        escalationShock = true;
      }
    }

    const escalationOut = updateEscalationState(escalationState, {
      slope: escalationSlope,
      volatility: escalationVolatility,
      isShock: escalationShock,
      pressure: scalarPressure,
      gain,
      deltaMessageSeconds: deltas.deltaMessage,
    });
    escalationState = escalationOut.state;

    const collapsePressure =
      scenario.name === "SUITE_PRESSURE_DRIVEN_COLLAPSE_MICRO" && i === 4
        ? 13.5
        : scalarPressure;
    const collapseSlope =
      scenario.name === "SUITE_PRESSURE_DRIVEN_COLLAPSE_MICRO" && i === 4
        ? 0.2
        : scenario.name === "SUITE_INWARD_COLLAPSE_MICRO" && i === 16
          ? -0.1
        : slope;
    const collapseMoodCategoryInput =
      scenario.name === "SUITE_SANITIZE_MICRO" && i === 0
        ? "__UNKNOWN__"
        : scenario.name === "SUITE_INWARD_COLLAPSE_MICRO" && i === 16
          ? "ANXIOUS"
        : moodOut.outputs.moodCategory;

    const collapseOut = updateCollapseState(collapseState, {
      escalationLevel: escalationOut.outputs.level,
      escalationScore: escalationOut.outputs.score,
      pressure: collapsePressure,
      pressureSlope: collapseSlope,
      moodCategory: asCollapseMoodCategory(collapseMoodCategoryInput),
      gain,
      deltaMessageSeconds: deltas.deltaMessage,
      burstFlag: gain > 1,
      silenceFlag: gain < 1,
      negValenceHint: valence,
    });
    collapseState = collapseOut.state;

    const collapseDirectionForPost =
      collapseOut.outputs.collapseDirection === "NONE"
        ? "NONE"
        : collapseOut.outputs.collapseDirection === "OUTWARD"
          ? "OUTWARD"
          : "INWARD";

    const postOut = updatePostClarityState(postState, {
      collapseEvent: collapseOut.outputs.collapseEvent,
      collapseDirection: collapseDirectionForPost,
      escalationLevel: escalationOut.outputs.level,
      escalationScore: escalationOut.outputs.score,
      pressure: collapsePressure,
      pressureSlope: collapseSlope,
      valence,
      deltaMessageSeconds: deltas.deltaMessage,
      repetitionScore,
      gain,
      validationSeekingScore,
      topicShiftScore,
      positiveReframeScore,
    });
    postState = postOut.state;

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

    // Hard invariants.
    const checkNumbers = [
      deltas.deltaMessage,
      deltas.deltaSession,
      gain,
      pressureAfterDecay,
      scalarPressure,
      vectorOut.output.totalPressure,
      vectorOut.output.volatilityTotal,
      slope,
      escalationOut.outputs.score,
      postOut.outputs.agencyDeficit,
      collapseState.cooldownSeconds,
      postState.postModeUntilSeconds,
      postState.cooldownSeconds,
    ];
    if (scenario.faultInjection === "NON_FINITE_OUTPUT" && i === 0) {
      checkNumbers[0] = Number.NaN;
    }
    if (scenario.faultInjection === "NEGATIVE_PRESSURE" && i === 0) {
      scalarPressure = -1;
      vectorOut.output.totalPressure = -1;
    }
    if (scenario.faultInjection === "NEGATIVE_FAMILY" && i === 0) {
      vectorOut.output.pressureByFamily.JOY = -1;
    }
    if (scenario.faultInjection === "NEGATIVE_TIMER" && i === 0) {
      collapseState.cooldownSeconds = -1;
    }
    if (scenario.faultInjection === "PRESSURE_CAP" && i === 0) {
      scalarPressure = PRESSURE_CAP + 1;
    }
    for (const value of checkNumbers) {
      if (!Number.isFinite(value)) {
        throw new Error(`Non-finite output at step ${i}`);
      }
    }
    if (scalarPressure < 0 || vectorOut.output.totalPressure < 0) {
      throw new Error(`Negative pressure at step ${i}`);
    }
    if (
      vectorOut.output.pressureByFamily.JOY < 0 ||
      vectorOut.output.pressureByFamily.ANGER < 0 ||
      vectorOut.output.pressureByFamily.FEAR < 0 ||
      vectorOut.output.pressureByFamily.SADNESS < 0 ||
      vectorOut.output.pressureByFamily.SURPRISE < 0 ||
      vectorOut.output.pressureByFamily.DISGUST < 0
    ) {
      throw new Error(`Negative family pressure at step ${i}`);
    }
    if (collapseState.cooldownSeconds < 0 || postState.postModeUntilSeconds < 0 || postState.cooldownSeconds < 0) {
      throw new Error(`Negative timer at step ${i}`);
    }
    if (scalarPressure > PRESSURE_CAP || vectorOut.output.totalPressure > VECTOR_PRESSURE_CAP) {
      throw new Error(`Pressure cap exceeded at step ${i}`);
    }

    if (moodOut.outputs.moodCategory !== prevMoodCategory) {
      moodCategoryChanges += 1;
    }
    prevMoodCategory = moodOut.outputs.moodCategory;

    if (escalationOut.outputs.level === EscalationLevel.CRITICAL) {
      criticalSteps += 1;
    }
    if (postOut.outputs.postModeActive) {
      postModeSteps += 1;
    }
    if (collapseOut.outputs.collapseEvent) {
      collapseCount += 1;
      if (firstCollapseIndex === null) {
        firstCollapseIndex = i;
      }
      if (escalationOut.outputs.level < EscalationLevel.RISING && escalationOut.outputs.score < 0.5) {
        collapseWithCalmEscalationCount += 1;
      }
      if (escalationOut.outputs.level >= EscalationLevel.RISING || escalationOut.outputs.score >= 0.5) {
        collapseWithHighEscalationCount += 1;
      }
    }
    if (postOut.outputs.recoveryPath === "SUBSTITUTE") {
      everSubstitute = true;
    }
    if (postOut.outputs.recoveryPath === "SPIRAL") {
      everSpiral = true;
    }

    maxEscalationLevel = Math.max(maxEscalationLevel, escalationOut.outputs.level);
    maxEscalationScore = Math.max(maxEscalationScore, escalationOut.outputs.score);
    maxScalarPressure = Math.max(maxScalarPressure, scalarPressure);
    maxVectorPressure = Math.max(maxVectorPressure, vectorOut.output.totalPressure);
    maxFamilyPressure = Math.max(
      maxFamilyPressure,
      vectorOut.output.pressureByFamily.JOY,
      vectorOut.output.pressureByFamily.ANGER,
      vectorOut.output.pressureByFamily.FEAR,
      vectorOut.output.pressureByFamily.SADNESS,
      vectorOut.output.pressureByFamily.SURPRISE,
      vectorOut.output.pressureByFamily.DISGUST
    );
    sanitizationCount += sanitizationTags.length;

    if (i % sampleEvery === 0 && traceSample.length < MAX_TRACE_SAMPLES) {
      traceSample.push({
        i,
        deltaMessageSeconds: deltas.deltaMessage,
        deltaSessionSeconds: deltas.deltaSession,
        gain,
        familyTop: familyOut.dominantFamily,
        familyConfidence: familyOut.confidence,
        moodCategory: moodOut.outputs.moodCategory,
        moodConfidence: moodOut.outputs.moodConfidence,
        scalarPressure,
        vectorTotalPressure: vectorOut.output.totalPressure,
        vectorDominantFamily: vectorOut.output.dominantFamily,
        escalationLevel: escalationOut.outputs.level,
        escalationScore: escalationOut.outputs.score,
        collapseEvent: collapseOut.outputs.collapseEvent,
        collapseDirection: collapseOut.outputs.collapseDirection,
        collapseReasons: [...collapseOut.outputs.reasons],
        postModeActive: postOut.outputs.postModeActive,
        recoveryPath: postOut.outputs.recoveryPath,
        postReasons: [...postOut.outputs.reasons],
        interruptionLevel: policy.interruptionLevel,
        policyMovesTags: [
          policy.toneMode,
          policy.pacingMode,
          policy.validationMode,
          policy.actionMode,
          ...policy.guardrails,
        ],
        sanitizationTags,
      });
    }
  }

  const summary = {
    collapseCount,
    firstCollapseIndex,
    criticalSteps,
    fractionCritical: scenario.steps > 0 ? criticalSteps / scenario.steps : 0,
    postModeSteps,
    postModeFraction: scenario.steps > 0 ? postModeSteps / scenario.steps : 0,
    moodCategoryChanges,
    maxEscalationLevel,
    maxEscalationScore,
    maxScalarPressure,
    maxVectorPressure,
    maxFamilyPressure,
    everSubstitute,
    everSpiral,
    sanitizationCount,
    collapseWithCalmEscalationCount,
    collapseWithHighEscalationCount,
  };

  const hashInput = JSON.stringify({
    scenario: scenario.name,
    seed,
    summary,
    sample: traceSample.map((s) => ({
      i: s.i,
      e: s.escalationLevel,
      c: s.collapseEvent,
      p: s.scalarPressure,
      r: s.recoveryPath,
      il: s.interruptionLevel,
    })),
  });

  return {
    scenario: scenario.name,
    seed,
    steps: scenario.steps,
    summaryHash: fnv1a(hashInput),
    summary,
    traceSample,
  };
}
