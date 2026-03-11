import {
  ESC_CRIT_LEVEL,
  ESC_CRIT_SCORE,
  MAX_POST_WINDOW_SECONDS,
  POST_WINDOW_SECONDS,
  PRESSURE_CRIT,
  REPEAT_HIGH,
  RING_BUFFER_N,
  RING_BUFFER_N_SUB,
  RELAPSE_EXTENSION_SECONDS,
  SPIRAL_THRESHOLD,
  SLOPE_CRIT,
  SUBSTITUTE_MUTEX_MARGIN,
  SUBSTITUTE_THRESHOLD,
  TAU_AGENCY_SECONDS,
  TAU_SPIRAL_SECONDS,
  TAU_SUBSTITUTE_SECONDS,
  URGENCY_GAIN_HIGH,
} from "./constants";
import type {
  PostClarityInputs,
  PostClarityOutputs,
  PostClarityState,
} from "./types";

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampInt(value: number, min: number, max: number): number {
  const safe = finiteOrZero(value);
  const truncated = Math.trunc(safe);
  return Math.max(min, Math.min(max, truncated));
}

export function createPostClarityState(): PostClarityState {
  return {
    agencyDeficit: 0,
    postModeUntilSeconds: 0,
    cooldownSeconds: 0,
    relapseCount: 0,
    n: 0,
    spiralScore: 0,
    substituteScore: 0,
    recentRepetition: [],
    recentUrgency: [],
    recentSeeking: [],
  };
}

export function updatePostClarityState(
  state: PostClarityState,
  input: PostClarityInputs
): { state: PostClarityState; outputs: PostClarityOutputs } {
  // STEP 1 - sanitize inputs
  const escalationLevel = clampInt(input.escalationLevel, 0, 3);
  const escalationScore = clamp01(finiteOrZero(input.escalationScore));
  const pressure = Math.max(0, finiteOrZero(input.pressure));
  const pressureSlope = finiteOrZero(input.pressureSlope);
  const valence = clamp(finiteOrZero(input.valence), -1, 1);
  const deltaMessageSeconds = Math.max(0, finiteOrZero(input.deltaMessageSeconds));

  // STEP 2 - advance timers
  const nextN = state.n + 1;
  let postModeUntilSeconds = Math.max(
    0,
    finiteOrZero(state.postModeUntilSeconds) - deltaMessageSeconds
  );
  const cooldownSeconds = Math.max(
    0,
    finiteOrZero(state.cooldownSeconds) - deltaMessageSeconds
  );

  // STEP 3 - collapse trigger
  let trigger = false;
  if (input.collapseEvent === true) {
    trigger = true;
  } else if (
    escalationLevel === ESC_CRIT_LEVEL &&
    escalationScore >= ESC_CRIT_SCORE
  ) {
    trigger = true;
  } else if (pressure >= PRESSURE_CRIT && pressureSlope > 0) {
    trigger = true;
  }

  // STEP 4 - agency impulse
  let impulse = 0;
  if (trigger) {
    const negValenceWeight = Math.max(0, -valence);
    const sevEsc = escalationScore;
    const sevP = clamp01(pressure / PRESSURE_CRIT);
    const sevSlope = clamp01(pressureSlope / SLOPE_CRIT);

    const impulseRaw =
      0.5 * sevEsc + 0.3 * sevP + 0.2 * sevSlope + 0.2 * negValenceWeight;
    impulse = clamp01(impulseRaw);
  }

  // STEP 5 - agency update (EMA decay)
  const decayFactor = Math.exp(-deltaMessageSeconds / TAU_AGENCY_SECONDS);
  const agencyDeficit = clamp01(
    clamp01(finiteOrZero(state.agencyDeficit)) * decayFactor +
      (trigger ? impulse : 0)
  );

  // STEP 6 - post mode window
  let isRelapse = false;
  let relapseCount = Math.max(0, clampInt(state.relapseCount, 0, Number.MAX_SAFE_INTEGER));

  if (trigger) {
    if (postModeUntilSeconds > 0) {
      isRelapse = true;
      relapseCount += 1;
      postModeUntilSeconds = Math.min(
        MAX_POST_WINDOW_SECONDS,
        postModeUntilSeconds + RELAPSE_EXTENSION_SECONDS
      );
    } else {
      postModeUntilSeconds = POST_WINDOW_SECONDS;
    }
  }

  // STEP 7 - outputs
  const postModeActive = postModeUntilSeconds > 0;
  const reasons: string[] = [];
  if (trigger) {
    reasons.push("TRIGGER");
  }
  if (isRelapse) {
    reasons.push("RELAPSE");
  }
  if (postModeActive) {
    reasons.push("POST_MODE_ACTIVE");
  }

  // PASS 2 - spiral evidence logic
  const rep = clamp01(finiteOrZero(input.repetitionScore ?? 0));
  const gain = Math.max(0, finiteOrZero(input.gain ?? 1));

  const previousRepetition = Array.isArray(state.recentRepetition)
    ? state.recentRepetition
    : [];
  const previousUrgency = Array.isArray(state.recentUrgency) ? state.recentUrgency : [];

  const recentRepetition = [...previousRepetition, rep];
  if (recentRepetition.length > RING_BUFFER_N) {
    recentRepetition.shift();
  }

  const recentUrgency = [...previousUrgency, gain];
  if (recentUrgency.length > RING_BUFFER_N) {
    recentUrgency.shift();
  }

  const repImpulse = rep > REPEAT_HIGH ? rep : 0;
  const urgencyImpulse = gain >= URGENCY_GAIN_HIGH ? clamp01(gain - 1) : 0;
  const slopeImpulse = pressureSlope > 0 && postModeUntilSeconds > 0
    ? clamp01(pressureSlope / 0.2)
    : 0;

  const spiralImpulseRaw =
    0.5 * repImpulse + 0.3 * urgencyImpulse + 0.2 * slopeImpulse;
  const spiralImpulse = clamp01(spiralImpulseRaw);

  const decaySpiral = Math.exp(-deltaMessageSeconds / TAU_SPIRAL_SECONDS);
  const spiralScore = clamp01(
    clamp01(finiteOrZero(state.spiralScore)) * decaySpiral + spiralImpulse
  );

  // PASS 3 - substitute evidence logic
  const seek = clamp01(finiteOrZero(input.validationSeekingScore ?? 0));
  const shift = clamp01(finiteOrZero(input.topicShiftScore ?? 0));
  const reframe = clamp01(finiteOrZero(input.positiveReframeScore ?? 0));

  const previousSeeking = Array.isArray(state.recentSeeking) ? state.recentSeeking : [];
  const recentSeeking = [...previousSeeking, seek];
  if (recentSeeking.length > RING_BUFFER_N_SUB) {
    recentSeeking.shift();
  }

  const seekImpulse = seek;
  const shiftImpulse = shift;
  const reframeImpulse = reframe;

  const subImpulseRaw =
    0.45 * seekImpulse + 0.35 * shiftImpulse + 0.2 * reframeImpulse;
  const subImpulse = clamp01(subImpulseRaw);

  const decaySub = Math.exp(-deltaMessageSeconds / TAU_SUBSTITUTE_SECONDS);
  const substituteScore = clamp01(
    clamp01(finiteOrZero(state.substituteScore)) * decaySub + subImpulse
  );

  // PASS 3 - arbitration with conservative tie handling
  const spiralActive =
    postModeUntilSeconds > 0 && spiralScore >= SPIRAL_THRESHOLD;
  const subActive =
    postModeUntilSeconds > 0 && substituteScore >= SUBSTITUTE_THRESHOLD;

  let recoveryPath: "SPIRAL" | "SUBSTITUTE" | "UNKNOWN" = "UNKNOWN";
  if (spiralActive && !subActive) {
    recoveryPath = "SPIRAL";
  } else if (subActive && !spiralActive) {
    recoveryPath = "SUBSTITUTE";
  } else if (spiralActive && subActive) {
    if (spiralScore >= substituteScore + SUBSTITUTE_MUTEX_MARGIN) {
      recoveryPath = "SPIRAL";
    } else if (substituteScore >= spiralScore + SUBSTITUTE_MUTEX_MARGIN) {
      recoveryPath = "SUBSTITUTE";
    } else {
      recoveryPath = "UNKNOWN";
      reasons.push("RECOVERY_AMBIGUOUS");
    }
  }

  if (recoveryPath === "SPIRAL") {
    reasons.push("SPIRAL_ACTIVE");
  } else if (recoveryPath === "SUBSTITUTE") {
    reasons.push("SUBSTITUTE_ACTIVE");
  }

  const nextState: PostClarityState = {
    agencyDeficit,
    postModeUntilSeconds,
    cooldownSeconds,
    relapseCount,
    n: nextN,
    spiralScore,
    substituteScore,
    recentRepetition,
    recentUrgency,
    recentSeeking,
  };

  return {
    state: nextState,
    outputs: {
      postModeActive,
      agencyDeficit,
      isRelapse,
      reasons,
      recoveryPath,
    },
  };
}
