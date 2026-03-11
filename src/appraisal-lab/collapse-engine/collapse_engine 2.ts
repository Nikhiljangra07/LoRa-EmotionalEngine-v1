import {
  COOLDOWN_SECONDS,
  E_CRIT,
  EPS,
  P_CRIT,
  S_CRIT,
  SLOPE_CRIT,
} from "./constants";
import {
  CollapseDirection,
  MoodCategory,
  type CollapseInputs,
  type CollapseOutputs,
  type CollapseState,
} from "./types";

function asFinite(x: number, fallback: number): number {
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

function clampInt(x: number, min: number, max: number): number {
  const safe = Math.floor(asFinite(x, 0));
  return clamp(safe, min, max);
}

function isOutwardMood(mood: MoodCategory): boolean {
  return mood === MoodCategory.IRRITABLE || mood === MoodCategory.AVERSIVE;
}

function isInwardMood(mood: MoodCategory): boolean {
  return mood === MoodCategory.MELANCHOLIC || mood === MoodCategory.ANXIOUS;
}

export function createCollapseState(): CollapseState {
  return {
    inCollapse: false,
    lastEventAtN: -1,
    cooldownSeconds: 0,
    n: 0,
  };
}

export function updateCollapseState(
  state: CollapseState,
  input: CollapseInputs
): { state: CollapseState; outputs: CollapseOutputs } {
  const reasons: string[] = [];

  const E = clampInt(input.escalationLevel, 0, 3);
  const S = clamp01(input.escalationScore);
  const P = Math.max(0, asFinite(input.pressure, 0));
  const slope = asFinite(input.pressureSlope, 0);
  const dt = Math.max(0, asFinite(input.deltaMessageSeconds, 0));
  const gain = Math.max(0, asFinite(input.gain, 0));
  const silenceFlag = Boolean(input.silenceFlag ?? false);
  const burstFlag = Boolean(input.burstFlag ?? false);
  const negValenceHint = clamp(asFinite(input.negValenceHint ?? 0, 0), -1, 1);
  const moodCategory = input.moodCategory ?? MoodCategory.NEUTRAL;

  let cooldownSeconds = Math.max(0, asFinite(state.cooldownSeconds, 0) - dt);
  let inCollapse = Boolean(state.inCollapse);
  if (cooldownSeconds <= EPS) {
    cooldownSeconds = 0;
    inCollapse = false;
  }

  const trigEscCrit = E === E_CRIT && S >= S_CRIT;
  const trigPressureCrit = P >= P_CRIT && slope > 0;
  const trigScoreHard = S >= 0.98;
  const triggered = trigEscCrit || trigPressureCrit || trigScoreHard;

  if (trigEscCrit) {
    reasons.push("TRIG_ESC_CRIT");
  }
  if (trigPressureCrit) {
    reasons.push("TRIG_PRESSURE_CRIT");
  }
  if (trigScoreHard) {
    reasons.push("TRIG_SCORE_HARD");
  }

  const emergencyOverride = S >= 0.99 || P >= 1.2 * P_CRIT;
  const blockedByCooldown = cooldownSeconds > 0 && !emergencyOverride;
  const collapseEvent = triggered && !blockedByCooldown;

  if (blockedByCooldown && triggered) {
    reasons.push("COOLDOWN_BLOCK");
  }
  if (cooldownSeconds > 0 && emergencyOverride) {
    reasons.push("COOLDOWN_OVERRIDE");
  }

  const sevEsc = S;
  const sevP = clamp01(P / P_CRIT);
  const sevSlope = clamp01(slope / SLOPE_CRIT);
  const severityRaw = 0.5 * sevEsc + 0.3 * sevP + 0.2 * sevSlope;
  const collapseSeverity = collapseEvent ? clamp01(Math.max(0.6, severityRaw)) : 0;

  let collapseDirection = CollapseDirection.NONE;
  if (collapseEvent) {
    const outwardByGainBurst = gain >= 1.15 || burstFlag;
    const outwardByMood = isOutwardMood(moodCategory);
    const outwardBySlopePressure = slope > 0 && P >= 0.8 * P_CRIT;
    const outwardByNegValence = negValenceHint <= -0.5;
    const outwardCount =
      Number(outwardByGainBurst) +
      Number(outwardByMood) +
      Number(outwardBySlopePressure) +
      Number(outwardByNegValence);

    const inwardByGainSilenceDt = gain <= 0.9 || silenceFlag || dt >= 300;
    const inwardByMood = isInwardMood(moodCategory);
    const inwardBySlopePressure = slope <= 0 && P >= 0.7 * P_CRIT;
    const inwardCount =
      Number(inwardByGainSilenceDt) + Number(inwardByMood) + Number(inwardBySlopePressure);

    if (outwardCount >= 2 && outwardCount > inwardCount) {
      collapseDirection = CollapseDirection.OUTWARD;
    } else if (inwardCount >= 2 && inwardCount > outwardCount) {
      collapseDirection = CollapseDirection.INWARD;
    } else {
      collapseDirection = dt >= 300 ? CollapseDirection.INWARD : CollapseDirection.OUTWARD;
    }

    if (outwardByGainBurst) {
      reasons.push("DIR_OUTWARD_GAIN_BURST");
    }
    if (outwardByMood) {
      reasons.push("DIR_OUTWARD_MOOD");
    }
    if (outwardBySlopePressure) {
      reasons.push("DIR_OUTWARD_SLOPE_PRESSURE");
    }
    if (outwardByNegValence) {
      reasons.push("DIR_OUTWARD_NEG_VALENCE");
    }
    if (inwardByGainSilenceDt) {
      reasons.push("DIR_INWARD_GAIN_SILENCE_DT");
    }
    if (inwardByMood) {
      reasons.push("DIR_INWARD_MOOD");
    }
    if (inwardBySlopePressure) {
      reasons.push("DIR_INWARD_SLOPE_PRESSURE");
    }
  }

  if (collapseEvent) {
    inCollapse = true;
    cooldownSeconds = COOLDOWN_SECONDS;
  }

  if (!collapseEvent) {
    reasons.push("NO_EVENT");
  }

  const nextState: CollapseState = {
    inCollapse,
    lastEventAtN: collapseEvent ? state.n : asFinite(state.lastEventAtN, -1),
    cooldownSeconds: asFinite(Math.max(0, cooldownSeconds), 0),
    n: Math.max(0, Math.floor(asFinite(state.n, 0))) + 1,
  };

  const outputs: CollapseOutputs = {
    collapseEvent,
    collapseSeverity: asFinite(clamp01(collapseSeverity), 0),
    collapseDirection,
    reasons,
  };

  return { state: nextState, outputs };
}
