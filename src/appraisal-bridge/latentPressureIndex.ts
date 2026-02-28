/**
 * Latent Pressure Index (LPI) — Detects masked distress.
 *
 * Identifies low-intensity negative signals that fly under explicit
 * escalation thresholds: minimizing phrases ("fine", "whatever"),
 * low arousal + negative valence, and volatility drift.
 *
 * Output: 0–1, EMA-smoothed over the last 5 turns.
 */

const MINIMIZING_PHRASES: ReadonlySet<string> = new Set([
  'fine',
  'whatever',
  "doesn't matter",
  'doesnt matter',
  "don't care",
  'dont care',
  'just tired',
  "it's okay",
  'its okay',
  "it's fine",
  'its fine',
  'not a big deal',
  'forget it',
  'never mind',
  'nevermind',
  'i guess',
]);

const LPI_EMA_ALPHA = 0.35;
const LPI_THRESHOLD = 0.45;
const VOLATILITY_DRIFT_WINDOW = 3;

export interface LPIInput {
  messageText: string;
  valenceScore: number;
  valenceConfidence: number;
  arousalScore: number;
  recentVolatilities: readonly number[];
}

export interface LPIResult {
  raw: number;
  smoothed: number;
  maskedPressure: boolean;
  components: {
    minimizingScore: number;
    valenceNegConfidence: number;
    lowArousalNegValence: number;
    volatilityDrift: number;
  };
}

function countMinimizingPhrases(text: string): number {
  const lower = text.toLowerCase();
  let count = 0;
  for (const phrase of MINIMIZING_PHRASES) {
    if (lower.includes(phrase)) count++;
  }
  return count;
}

function computeVolatilityDrift(recentVolatilities: readonly number[]): number {
  if (recentVolatilities.length < 2) return 0;
  const window = recentVolatilities.slice(-VOLATILITY_DRIFT_WINDOW);
  if (window.length < 2) return 0;

  let totalDrift = 0;
  for (let i = 1; i < window.length; i++) {
    totalDrift += Math.abs(window[i] - window[i - 1]);
  }
  return Math.min(totalDrift / (window.length - 1), 1);
}

export function computeRawLPI(input: LPIInput): number {
  const minimizingCount = countMinimizingPhrases(input.messageText);
  const minimizingScore = Math.min(minimizingCount * 0.3, 0.6);

  const isNegativeValence = input.valenceScore < -0.1;
  const valenceNegConfidence = isNegativeValence
    ? input.valenceConfidence * 0.5
    : 0;

  const isLowArousal = input.arousalScore < 0.35;
  const lowArousalNegValence =
    isLowArousal && isNegativeValence ? 0.25 : 0;

  const volatilityDrift = computeVolatilityDrift(input.recentVolatilities) * 0.3;

  const raw = Math.min(
    minimizingScore + valenceNegConfidence + lowArousalNegValence + volatilityDrift,
    1,
  );

  return raw;
}

export class LatentPressureTracker {
  private smoothedLPI = 0;
  private turnCount = 0;

  reset(): void {
    this.smoothedLPI = 0;
    this.turnCount = 0;
  }

  step(input: LPIInput, currentEscalationLevel: number): LPIResult {
    const raw = computeRawLPI(input);

    if (this.turnCount === 0) {
      this.smoothedLPI = raw;
    } else {
      this.smoothedLPI =
        LPI_EMA_ALPHA * raw + (1 - LPI_EMA_ALPHA) * this.smoothedLPI;
    }
    this.turnCount++;

    const maskedPressure =
      this.smoothedLPI > LPI_THRESHOLD && currentEscalationLevel < 1;

    return {
      raw,
      smoothed: this.smoothedLPI,
      maskedPressure,
      components: {
        minimizingScore: Math.min(countMinimizingPhrases(input.messageText) * 0.3, 0.6),
        valenceNegConfidence: input.valenceScore < -0.1 ? input.valenceConfidence * 0.5 : 0,
        lowArousalNegValence: input.arousalScore < 0.35 && input.valenceScore < -0.1 ? 0.25 : 0,
        volatilityDrift: computeVolatilityDrift(input.recentVolatilities) * 0.3,
      },
    };
  }

  get currentSmoothed(): number {
    return this.smoothedLPI;
  }
}

export { LPI_THRESHOLD, LPI_EMA_ALPHA };
