/**
 * Volatility Direction — Tracks whether session volatility is rising,
 * falling, or stable compared to the previous turn's AVI.
 *
 * Provides directional force for hint modulation: rising volatility
 * tightens guidance, falling volatility permits relaxation.
 */

export type VolatilityTrend = 'RISING' | 'FALLING' | 'STABLE';

const DIRECTION_THRESHOLD = 0.02;

export interface VolatilityDirectionResult {
  trend: VolatilityTrend;
  delta: number;
  previous: number;
  current: number;
}

export class VolatilityDirectionTracker {
  private previousAVI: number | null = null;

  reset(): void {
    this.previousAVI = null;
  }

  step(currentAVI: number): VolatilityDirectionResult {
    const previous = this.previousAVI ?? currentAVI;
    const delta = currentAVI - previous;
    this.previousAVI = currentAVI;

    let trend: VolatilityTrend;
    if (delta > DIRECTION_THRESHOLD) {
      trend = 'RISING';
    } else if (delta < -DIRECTION_THRESHOLD) {
      trend = 'FALLING';
    } else {
      trend = 'STABLE';
    }

    return { trend, delta, previous, current: currentAVI };
  }
}

export { DIRECTION_THRESHOLD };
