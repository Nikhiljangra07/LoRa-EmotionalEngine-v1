import {
  CONF_SCALE,
  EPS,
  FORCE_SWITCH_DOM,
  MOOD_COOLDOWN_SECONDS,
  MOOD_MIN_SIGNAL,
  PRESSURE_NORM,
  SWITCH_ON_DOM,
  SWITCH_ON_GAP,
  TAU_MOOD_SECONDS,
} from "./constants";
import {
  EmotionFamily,
  MoodCategory,
  type FamilyVector,
  type MoodInputs,
  type MoodOutputs,
  type MoodState,
  type MoodVector,
} from "./types";

const FAMILY_ORDER: EmotionFamily[] = [
  EmotionFamily.JOY,
  EmotionFamily.ANGER,
  EmotionFamily.FEAR,
  EmotionFamily.SADNESS,
  EmotionFamily.SURPRISE,
  EmotionFamily.DISGUST,
];

const MOOD_ORDER: MoodCategory[] = [
  MoodCategory.POSITIVE,
  MoodCategory.IRRITABLE,
  MoodCategory.ANXIOUS,
  MoodCategory.MELANCHOLIC,
  MoodCategory.ALERT,
  MoodCategory.AVERSIVE,
  MoodCategory.NEUTRAL,
];

function asFinite(x: number, fallback = 0): number {
  return Number.isFinite(x) ? x : fallback;
}

function clamp(x: number, min: number, max: number): number {
  if (x < min) {
    return min;
  }
  if (x > max) {
    return max;
  }
  return x;
}

function clamp01(x: number): number {
  return clamp(asFinite(x, 0), 0, 1);
}

function zeroFamilyVector(): FamilyVector {
  return {
    [EmotionFamily.JOY]: 0,
    [EmotionFamily.ANGER]: 0,
    [EmotionFamily.FEAR]: 0,
    [EmotionFamily.SADNESS]: 0,
    [EmotionFamily.SURPRISE]: 0,
    [EmotionFamily.DISGUST]: 0,
  };
}

function equalMoodVector(): MoodVector {
  const v = 1 / MOOD_ORDER.length;
  return {
    [MoodCategory.POSITIVE]: v,
    [MoodCategory.IRRITABLE]: v,
    [MoodCategory.ANXIOUS]: v,
    [MoodCategory.MELANCHOLIC]: v,
    [MoodCategory.ALERT]: v,
    [MoodCategory.AVERSIVE]: v,
    [MoodCategory.NEUTRAL]: v,
  };
}

function sanitizeFamilyVector(input: FamilyVector): FamilyVector {
  return {
    [EmotionFamily.JOY]: Math.max(0, asFinite(input[EmotionFamily.JOY], 0)),
    [EmotionFamily.ANGER]: Math.max(0, asFinite(input[EmotionFamily.ANGER], 0)),
    [EmotionFamily.FEAR]: Math.max(0, asFinite(input[EmotionFamily.FEAR], 0)),
    [EmotionFamily.SADNESS]: Math.max(0, asFinite(input[EmotionFamily.SADNESS], 0)),
    [EmotionFamily.SURPRISE]: Math.max(0, asFinite(input[EmotionFamily.SURPRISE], 0)),
    [EmotionFamily.DISGUST]: Math.max(0, asFinite(input[EmotionFamily.DISGUST], 0)),
  };
}

function familyToMood(family: EmotionFamily): MoodCategory {
  switch (family) {
    case EmotionFamily.JOY:
      return MoodCategory.POSITIVE;
    case EmotionFamily.ANGER:
      return MoodCategory.IRRITABLE;
    case EmotionFamily.FEAR:
      return MoodCategory.ANXIOUS;
    case EmotionFamily.SADNESS:
      return MoodCategory.MELANCHOLIC;
    case EmotionFamily.SURPRISE:
      return MoodCategory.ALERT;
    case EmotionFamily.DISGUST:
      return MoodCategory.AVERSIVE;
    default:
      return MoodCategory.NEUTRAL;
  }
}

function normalizeMoodVector(raw: MoodVector): MoodVector {
  const sum = MOOD_ORDER.reduce((acc, mood) => acc + Math.max(0, asFinite(raw[mood], 0)), 0);
  if (sum <= EPS) {
    return equalMoodVector();
  }
  const out: Partial<MoodVector> = {};
  for (const mood of MOOD_ORDER) {
    out[mood] = clamp01(Math.max(0, asFinite(raw[mood], 0)) / sum);
  }
  return out as MoodVector;
}

function topTwoMoods(vector: MoodVector): {
  top1: MoodCategory;
  top1Weight: number;
  top2: MoodCategory;
  top2Weight: number;
} {
  let top1 = MOOD_ORDER[0];
  let top2 = MOOD_ORDER[1];
  let top1Weight = vector[top1];
  let top2Weight = vector[top2];

  if (top2Weight > top1Weight) {
    const tempMood = top1;
    const tempWeight = top1Weight;
    top1 = top2;
    top1Weight = top2Weight;
    top2 = tempMood;
    top2Weight = tempWeight;
  }

  for (let i = 2; i < MOOD_ORDER.length; i += 1) {
    const mood = MOOD_ORDER[i];
    const w = vector[mood];
    if (w > top1Weight) {
      top2 = top1;
      top2Weight = top1Weight;
      top1 = mood;
      top1Weight = w;
    } else if (w > top2Weight) {
      top2 = mood;
      top2Weight = w;
    }
  }

  return { top1, top1Weight, top2, top2Weight };
}

function primingReason(mood: MoodCategory): string | null {
  switch (mood) {
    case MoodCategory.POSITIVE:
      return "PRIME_JOY";
    case MoodCategory.IRRITABLE:
      return "PRIME_ANGER";
    case MoodCategory.ANXIOUS:
      return "PRIME_FEAR";
    case MoodCategory.MELANCHOLIC:
      return "PRIME_SADNESS";
    case MoodCategory.ALERT:
      return "PRIME_SURPRISE";
    case MoodCategory.AVERSIVE:
      return "PRIME_DISGUST";
    case MoodCategory.NEUTRAL:
    default:
      return null;
  }
}

export function createMoodState(initial?: Partial<MoodState>): MoodState {
  const initialEMA = initial?.moodEMA
    ? sanitizeFamilyVector(initial.moodEMA as FamilyVector)
    : zeroFamilyVector();
  const moodCategory = initial?.moodCategory ?? MoodCategory.NEUTRAL;
  const prevMoodCategory = initial?.prevMoodCategory ?? MoodCategory.NEUTRAL;
  const lastDominantFamily = initial?.lastDominantFamily ?? EmotionFamily.SURPRISE;
  const cooldownSeconds = Math.max(0, asFinite(initial?.cooldownSeconds ?? 0, 0));
  const n = Math.max(0, Math.floor(asFinite(initial?.n ?? 0, 0)));

  return {
    moodEMA: initialEMA,
    moodCategory,
    prevMoodCategory,
    lastDominantFamily,
    cooldownSeconds,
    n,
  };
}

export function updateMoodState(
  state: MoodState,
  inputs: MoodInputs
): { state: MoodState; outputs: MoodOutputs } {
  const reasons: string[] = [];
  const weights = sanitizeFamilyVector(inputs.familyWeights);
  const pressures = sanitizeFamilyVector(inputs.pressureVector);
  const deltaMessageSeconds = Math.max(0, asFinite(inputs.deltaMessageSeconds, 0));
  const escalationLevel = clamp(asFinite(inputs.escalationLevel ?? 0, 0), 0, 3);
  const isShock = Boolean(inputs.isShock ?? false);

  if (deltaMessageSeconds === 0) {
    reasons.push("DELTA_ZERO");
  }
  if (escalationLevel > 0) {
    reasons.push("ESC_LEVEL_PRESENT");
  }
  if (isShock) {
    reasons.push("SHOCK_PRESENT");
  }

  const alpha = clamp01(1 - Math.exp(-deltaMessageSeconds / TAU_MOOD_SECONDS));
  const nextEMA: FamilyVector = zeroFamilyVector();
  for (const family of FAMILY_ORDER) {
    const drive = clamp01(weights[family]) * clamp01(pressures[family] / PRESSURE_NORM);
    nextEMA[family] = asFinite((1 - alpha) * state.moodEMA[family] + alpha * drive, 0);
  }

  const rawMoodVector: MoodVector = {
    [MoodCategory.POSITIVE]: nextEMA[EmotionFamily.JOY],
    [MoodCategory.IRRITABLE]: nextEMA[EmotionFamily.ANGER],
    [MoodCategory.ANXIOUS]: nextEMA[EmotionFamily.FEAR],
    [MoodCategory.MELANCHOLIC]: nextEMA[EmotionFamily.SADNESS],
    [MoodCategory.ALERT]: nextEMA[EmotionFamily.SURPRISE],
    [MoodCategory.AVERSIVE]: nextEMA[EmotionFamily.DISGUST],
    [MoodCategory.NEUTRAL]: 0,
  };

  const signalSum =
    rawMoodVector[MoodCategory.POSITIVE] +
    rawMoodVector[MoodCategory.IRRITABLE] +
    rawMoodVector[MoodCategory.ANXIOUS] +
    rawMoodVector[MoodCategory.MELANCHOLIC] +
    rawMoodVector[MoodCategory.ALERT] +
    rawMoodVector[MoodCategory.AVERSIVE];

  let moodVector: MoodVector;
  let candidateMood: MoodCategory;
  if (signalSum < MOOD_MIN_SIGNAL) {
    reasons.push("SIGNAL_WEAK");
    moodVector = equalMoodVector();
    candidateMood = MoodCategory.NEUTRAL;
  } else {
    moodVector = normalizeMoodVector(rawMoodVector);
    const ranked = topTwoMoods(moodVector);
    candidateMood = ranked.top1;
  }

  const ranked = topTwoMoods(moodVector);
  const top1Weight = asFinite(ranked.top1Weight, 0);
  const top2Weight = asFinite(ranked.top2Weight, 0);
  const gap = Math.max(0, top1Weight - top2Weight);

  const baseCanSwitch = top1Weight >= SWITCH_ON_DOM && gap >= SWITCH_ON_GAP;
  const cooldownRemaining = Math.max(0, asFinite(state.cooldownSeconds, 0) - deltaMessageSeconds);
  const inCooldown = cooldownRemaining > 0;

  let nextMood = state.moodCategory;
  let switched = false;
  if (candidateMood === MoodCategory.NEUTRAL) {
    nextMood = state.moodCategory === MoodCategory.NEUTRAL ? MoodCategory.NEUTRAL : state.moodCategory;
  } else if (candidateMood === state.moodCategory) {
    nextMood = state.moodCategory;
  } else if (inCooldown) {
    if (top1Weight >= FORCE_SWITCH_DOM) {
      nextMood = candidateMood;
      switched = true;
      reasons.push("FORCE_SWITCH");
    } else {
      reasons.push("SWITCH_BLOCKED_COOLDOWN");
    }
  } else if (baseCanSwitch) {
    nextMood = candidateMood;
    switched = true;
  } else {
    reasons.push("SWITCH_BLOCKED_HYSTERESIS");
  }

  let nextCooldown = cooldownRemaining;
  if (switched) {
    nextCooldown = MOOD_COOLDOWN_SECONDS;
    reasons.push("MOOD_SWITCH");
  }

  if (nextMood === MoodCategory.NEUTRAL && signalSum >= MOOD_MIN_SIGNAL) {
    nextMood = state.moodCategory;
  }

  const confidenceBase = clamp01(gap * CONF_SCALE);
  const moodConfidence = asFinite(confidenceBase, 0);
  const moodDominance = clamp01(top1Weight);

  let dominantFamily = EmotionFamily.JOY;
  let bestFamilyScore = nextEMA[dominantFamily];
  for (const family of FAMILY_ORDER) {
    const score = nextEMA[family];
    if (score > bestFamilyScore) {
      dominantFamily = family;
      bestFamilyScore = score;
    }
  }

  const prime = primingReason(nextMood);
  if (prime) {
    reasons.push(prime);
  }
  reasons.push(`MOOD_${nextMood}`);

  const normalizedMoodVector = normalizeMoodVector(moodVector);

  const nextState: MoodState = {
    moodEMA: nextEMA,
    moodCategory: nextMood,
    prevMoodCategory: state.moodCategory,
    lastDominantFamily: dominantFamily,
    cooldownSeconds: asFinite(nextCooldown, 0),
    n: state.n + 1,
  };

  const outputs: MoodOutputs = {
    moodCategory: nextMood,
    moodVector: normalizedMoodVector,
    moodDominance: asFinite(moodDominance, 0),
    moodConfidence: asFinite(moodConfidence, 0),
    reasons,
  };

  return { state: nextState, outputs };
}
