import {
  EPS,
  K_UP_FAMILY,
  R_MAX,
  SHOCK_W_GAIN,
  SHOCK_W_THRESHOLD,
  VOL_WINDOW_N,
} from "./constants";
import type {
  Family,
  FamilyVector,
  VectorPressureInput,
  VectorPressureState,
  VectorPressureUpdateResult,
} from "./types";

const FAMILY_ORDER: Family[] = ["JOY", "ANGER", "FEAR", "SADNESS", "SURPRISE", "DISGUST"];
const EQUAL_WEIGHT = 1 / FAMILY_ORDER.length;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function zeroVector(): FamilyVector {
  return {
    JOY: 0,
    ANGER: 0,
    FEAR: 0,
    SADNESS: 0,
    SURPRISE: 0,
    DISGUST: 0,
  };
}

function equalWeightsVector(): FamilyVector {
  return {
    JOY: EQUAL_WEIGHT,
    ANGER: EQUAL_WEIGHT,
    FEAR: EQUAL_WEIGHT,
    SADNESS: EQUAL_WEIGHT,
    SURPRISE: EQUAL_WEIGHT,
    DISGUST: EQUAL_WEIGHT,
  };
}

function sanitizeNonNegative(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, value);
}

function sanitizeWeights(weights: FamilyVector): FamilyVector {
  return {
    JOY: sanitizeNonNegative(weights.JOY),
    ANGER: sanitizeNonNegative(weights.ANGER),
    FEAR: sanitizeNonNegative(weights.FEAR),
    SADNESS: sanitizeNonNegative(weights.SADNESS),
    SURPRISE: sanitizeNonNegative(weights.SURPRISE),
    DISGUST: sanitizeNonNegative(weights.DISGUST),
  };
}

function sanitizePressureVector(pressureByFamily: FamilyVector): FamilyVector {
  return {
    JOY: clamp(sanitizeNonNegative(pressureByFamily.JOY), 0, R_MAX),
    ANGER: clamp(sanitizeNonNegative(pressureByFamily.ANGER), 0, R_MAX),
    FEAR: clamp(sanitizeNonNegative(pressureByFamily.FEAR), 0, R_MAX),
    SADNESS: clamp(sanitizeNonNegative(pressureByFamily.SADNESS), 0, R_MAX),
    SURPRISE: clamp(sanitizeNonNegative(pressureByFamily.SURPRISE), 0, R_MAX),
    DISGUST: clamp(sanitizeNonNegative(pressureByFamily.DISGUST), 0, R_MAX),
  };
}

function sumVector(vector: FamilyVector): number {
  return (
    vector.JOY +
    vector.ANGER +
    vector.FEAR +
    vector.SADNESS +
    vector.SURPRISE +
    vector.DISGUST
  );
}

function pickDominant(pressureByFamily: FamilyVector): Family {
  let dominant: Family = FAMILY_ORDER[0];
  let best = pressureByFamily[dominant];

  for (const family of FAMILY_ORDER) {
    const current = pressureByFamily[family];
    if (current > best) {
      best = current;
      dominant = family;
    }
  }
  return dominant;
}

export function createVectorPressureState(initial?: Partial<FamilyVector>): VectorPressureState {
  const base = zeroVector();
  const seeded = initial
    ? sanitizePressureVector({
        JOY: initial.JOY ?? 0,
        ANGER: initial.ANGER ?? 0,
        FEAR: initial.FEAR ?? 0,
        SADNESS: initial.SADNESS ?? 0,
        SURPRISE: initial.SURPRISE ?? 0,
        DISGUST: initial.DISGUST ?? 0,
      })
    : base;

  return {
    pressureByFamily: seeded,
    prevPressureByFamily: seeded,
    prevWeights: equalWeightsVector(),
    deltasTotal: [],
    volatilityWindowSize: VOL_WINDOW_N,
  };
}

export function updateVectorPressureState(
  state: VectorPressureState,
  input: VectorPressureInput
): VectorPressureUpdateResult {
  const confidence = clamp01(input.confidence);
  const gain = sanitizeNonNegative(input.gain);
  const weights = sanitizeWeights(input.familyWeights);
  const pressureAfterDecay = sanitizePressureVector(input.pressureAfterDecayByFamily);
  const prevWeights = sanitizeWeights(state.prevWeights);
  const prevPressure = sanitizePressureVector(state.prevPressureByFamily);
  void input.deltaMessageSeconds;

  const nextPressure: FamilyVector = zeroVector();
  for (const family of FAMILY_ORDER) {
    const accumulated =
      pressureAfterDecay[family] + gain * K_UP_FAMILY * confidence * weights[family];
    nextPressure[family] = clamp(accumulated, 0, R_MAX);
  }

  let maxPositiveDeltaW = -Infinity;
  let shockFamily: Family = FAMILY_ORDER[0];
  for (const family of FAMILY_ORDER) {
    const deltaW = weights[family] - prevWeights[family];
    if (deltaW > maxPositiveDeltaW + EPS) {
      maxPositiveDeltaW = deltaW;
      shockFamily = family;
    }
  }

  const isShock = maxPositiveDeltaW > SHOCK_W_THRESHOLD;
  if (isShock) {
    const impulse = (maxPositiveDeltaW - SHOCK_W_THRESHOLD) * SHOCK_W_GAIN;
    nextPressure[shockFamily] = clamp(nextPressure[shockFamily] + impulse, 0, R_MAX);
  }

  const deltaPressureByFamily: FamilyVector = zeroVector();
  for (const family of FAMILY_ORDER) {
    const delta = nextPressure[family] - prevPressure[family];
    deltaPressureByFamily[family] = Number.isFinite(delta) ? delta : 0;
  }

  const totalPressure = clamp(sumVector(nextPressure), 0, R_MAX * FAMILY_ORDER.length);
  const prevTotalPressure = clamp(sumVector(prevPressure), 0, R_MAX * FAMILY_ORDER.length);
  const deltaTotal = Number.isFinite(totalPressure - prevTotalPressure)
    ? totalPressure - prevTotalPressure
    : 0;

  const windowSize = Math.max(1, Math.floor(sanitizeNonNegative(state.volatilityWindowSize)));
  const deltasTotal = [...state.deltasTotal, deltaTotal];
  if (deltasTotal.length > windowSize) {
    deltasTotal.shift();
  }

  const squaredSum = deltasTotal.reduce((sum, delta) => sum + delta * delta, 0);
  const volatilityTotal = deltasTotal.length > 0 ? squaredSum / deltasTotal.length : 0;
  const safeVolatility = Number.isFinite(volatilityTotal) ? volatilityTotal : 0;

  const dominantFamily = pickDominant(nextPressure);

  const nextState: VectorPressureState = {
    pressureByFamily: nextPressure,
    prevPressureByFamily: nextPressure,
    prevWeights: weights,
    deltasTotal,
    volatilityWindowSize: windowSize || VOL_WINDOW_N,
  };

  return {
    state: nextState,
    output: {
      pressureByFamily: nextPressure,
      deltaPressureByFamily,
      dominantFamily,
      totalPressure,
      volatilityTotal: safeVolatility,
      isShock,
    },
  };
}
