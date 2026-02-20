import {
  ALPHA_V,
  BETA_H,
  CRIT_OFF_K,
  CRIT_OFF_M,
  EPS,
  ESC_OFF_K,
  ESC_OFF_M,
  ESC_ON_K,
  ESC_ON_M,
  FLAP_CHANGES_THRESHOLD,
  FLAP_WINDOW,
  MIN_WARMUP,
  RISE_OFF_K,
  RISE_OFF_M,
  RISE_ON_K,
  RISE_ON_M,
  R_MAX,
  W_BASELINE,
  Z_CALM_MAX,
  Z_CRIT,
  Z_ESC,
  Z_ESC_EXIT,
  Z_WARN,
  Z_WARN_EXIT,
} from "./constants";
import { EscalationLevel, type EscalationInput, type EscalationOutput, type EscalationState } from "./types";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function pushRing<T>(buffer: T[], value: T, maxLen: number): T[] {
  if (buffer.length < maxLen) {
    return [...buffer, value];
  }
  return [...buffer.slice(1), value];
}

function countTrue(values: boolean[]): number {
  let total = 0;
  for (let i = 0; i < values.length; i += 1) {
    if (values[i]) {
      total += 1;
    }
  }
  return total;
}

function kOfM(values: boolean[], k: number): boolean {
  return countTrue(values) >= k;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function mad(values: number[], med: number): number {
  if (values.length === 0) {
    return EPS;
  }
  const deviations = values.map((v) => Math.abs(v - med));
  return Math.max(median(deviations), EPS);
}

function countLevelChanges(levels: EscalationLevel[]): number {
  if (levels.length < 2) {
    return 0;
  }
  let changes = 0;
  for (let i = 1; i < levels.length; i += 1) {
    if (levels[i] !== levels[i - 1]) {
      changes += 1;
    }
  }
  return changes;
}

export function createEscalationState(): EscalationState {
  return {
    level: EscalationLevel.CALM,
    nSamples: 0,
    slopeBuf: [],
    volBuf: [],
    levelBuf: [],
    score: 0,
    r: 0,
    warnHits: [],
    escHits: [],
    calmHits: [],
    escExitHits: [],
    critExitHits: [],
  };
}

export function updateEscalationState(
  state: EscalationState,
  input: EscalationInput
): { state: EscalationState; outputs: EscalationOutput } {
  const slope = finiteOrZero(input.slope);
  const volatility = finiteOrZero(input.volatility);
  const isShock = Boolean(input.isShock);

  const nextSlopeBuf = pushRing(state.slopeBuf, slope, W_BASELINE);
  const nextVolBuf = pushRing(state.volBuf, volatility, W_BASELINE);
  const nSamples = state.nSamples + 1;

  const notWarmed = nSamples < MIN_WARMUP;
  if (notWarmed) {
    const warmupState: EscalationState = {
      ...state,
      level: EscalationLevel.CALM,
      nSamples,
      slopeBuf: nextSlopeBuf,
      volBuf: nextVolBuf,
      levelBuf: pushRing(state.levelBuf, EscalationLevel.CALM, FLAP_WINDOW),
      score: 0,
      r: 0,
      warnHits: pushRing(state.warnHits, false, RISE_ON_M),
      escHits: pushRing(state.escHits, false, ESC_ON_M),
      calmHits: pushRing(state.calmHits, true, RISE_OFF_M),
      escExitHits: pushRing(state.escExitHits, true, ESC_OFF_M),
      critExitHits: pushRing(state.critExitHits, true, CRIT_OFF_M),
    };

    return {
      state: warmupState,
      outputs: {
        level: EscalationLevel.CALM,
        score: 0,
        r: 0,
        reasons: [],
        flags: {
          warmedUp: false,
          isFlapping: false,
          enteredCritical: false,
        },
      },
    };
  }

  const medianSlope = median(nextSlopeBuf);
  const medianVol = median(nextVolBuf);
  const madSlopeEff = mad(nextSlopeBuf, medianSlope);
  const madVolEff = mad(nextVolBuf, medianVol);

  const zSlope = 0.6745 * ((slope - medianSlope) / madSlopeEff);
  const zVol = 0.6745 * ((volatility - medianVol) / madVolEff);
  const zSlopePos = Math.max(zSlope, 0);
  const zVolPos = Math.max(zVol, 0);

  const shockBoost = isShock ? BETA_H : 0;
  const rawR = Math.max(zSlopePos, ALPHA_V * zVolPos, shockBoost);
  const r = clamp(finiteOrZero(rawR), 0, R_MAX);
  const score = clamp01(r / Z_CRIT);

  const warnHit = r >= Z_WARN;
  const escHit = r >= Z_ESC;
  const calmHit = r < Z_CALM_MAX;
  const escExitHit = r <= Z_WARN_EXIT;
  const critExitHit = r <= Z_ESC_EXIT;

  const warnHits = pushRing(state.warnHits, warnHit, RISE_ON_M);
  const escHits = pushRing(state.escHits, escHit, ESC_ON_M);
  const calmHits = pushRing(state.calmHits, calmHit, RISE_OFF_M);
  const escExitHits = pushRing(state.escExitHits, escExitHit, ESC_OFF_M);
  const critExitHits = pushRing(state.critExitHits, critExitHit, CRIT_OFF_M);

  const warnPersist = kOfM(warnHits, RISE_ON_K);
  const escPersist = kOfM(escHits, ESC_ON_K);
  const calmPersist = kOfM(calmHits, RISE_OFF_K);
  const escExitPersist = kOfM(escExitHits, ESC_OFF_K);
  const critExitPersist = kOfM(critExitHits, CRIT_OFF_K);
  const shockEsc = isShock && r >= Z_WARN;

  let nextLevel = state.level;
  let persistentPromotion = false;

  if (state.level === EscalationLevel.CRITICAL) {
    if (critExitPersist) {
      nextLevel = EscalationLevel.ESCALATED;
    }
  } else if (state.level === EscalationLevel.ESCALATED) {
    if (r >= Z_CRIT) {
      nextLevel = EscalationLevel.CRITICAL;
    } else if (escExitPersist) {
      nextLevel = EscalationLevel.RISING;
    }
  } else if (state.level === EscalationLevel.RISING) {
    if (r >= Z_CRIT) {
      nextLevel = EscalationLevel.CRITICAL;
    } else if (escPersist || shockEsc) {
      nextLevel = EscalationLevel.ESCALATED;
      persistentPromotion = escPersist;
    } else if (calmPersist) {
      nextLevel = EscalationLevel.CALM;
    }
  } else {
    if (r >= Z_CRIT) {
      nextLevel = EscalationLevel.CRITICAL;
    } else if (escPersist || shockEsc) {
      nextLevel = EscalationLevel.ESCALATED;
      persistentPromotion = escPersist;
    } else if (warnPersist) {
      nextLevel = EscalationLevel.RISING;
      persistentPromotion = true;
    }
  }

  const reasons: string[] = [];
  if (zSlopePos >= Z_WARN) {
    reasons.push("SLOPE_HIGH");
  }
  if (ALPHA_V * zVolPos >= Z_WARN) {
    reasons.push("VOL_HIGH");
  }
  if (isShock) {
    reasons.push("SHOCK");
  }
  if (persistentPromotion && nextLevel > state.level) {
    reasons.push("PERSISTENT");
  }

  const levelBuf = pushRing(state.levelBuf, nextLevel, FLAP_WINDOW);
  const levelChanges = countLevelChanges(levelBuf);
  const isFlapping = levelChanges >= FLAP_CHANGES_THRESHOLD;
  const enteredCritical =
    state.level !== EscalationLevel.CRITICAL &&
    nextLevel === EscalationLevel.CRITICAL;

  const nextState: EscalationState = {
    level: nextLevel,
    nSamples,
    slopeBuf: nextSlopeBuf,
    volBuf: nextVolBuf,
    levelBuf,
    score,
    r,
    warnHits,
    escHits,
    calmHits,
    escExitHits,
    critExitHits,
  };

  return {
    state: nextState,
    outputs: {
      level: nextLevel,
      score,
      r,
      reasons,
      flags: {
        warmedUp: true,
        isFlapping,
        enteredCritical,
      },
    },
  };
}
