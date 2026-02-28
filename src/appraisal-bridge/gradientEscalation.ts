/**
 * Gradient Escalation — Soft-state escalation with confirmation and de-escalation rules.
 *
 * States: CALM → TENSION → RISING → ESCALATED → CRITICAL
 *
 * Rules:
 *   - Escalation requires 2-turn confirmation unless LPI > 0.6
 *   - De-escalation requires volatility FALLING for 2 consecutive turns
 *   - Produces escalationTrend: UP / DOWN / FLAT
 */

import type { VolatilityTrend } from './volatilityDirection';

export type GradientEscalationState =
  | 'CALM'
  | 'TENSION'
  | 'RISING'
  | 'ESCALATED'
  | 'CRITICAL';

export type EscalationTrend = 'UP' | 'DOWN' | 'FLAT';

const STATE_ORDER: readonly GradientEscalationState[] = [
  'CALM',
  'TENSION',
  'RISING',
  'ESCALATED',
  'CRITICAL',
];

function stateIndex(s: GradientEscalationState): number {
  return STATE_ORDER.indexOf(s);
}

export interface GradientEscalationResult {
  state: GradientEscalationState;
  numericLevel: number;
  trend: EscalationTrend;
  confirmedTurns: number;
}

/**
 * Maps raw appraisal escalation.level (0–3) to candidate gradient state.
 */
function rawLevelToCandidate(level: number, lpiSmoothed: number): GradientEscalationState {
  if (lpiSmoothed > 0.45 && level === 0) return 'TENSION';
  if (level === 0) return 'CALM';
  if (level === 1) return 'RISING';
  if (level === 2) return 'ESCALATED';
  return 'CRITICAL';
}

export class GradientEscalationTracker {
  private currentState: GradientEscalationState = 'CALM';
  private pendingState: GradientEscalationState | null = null;
  private confirmationCount = 0;
  private consecutiveFallingVolatility = 0;
  private previousState: GradientEscalationState = 'CALM';

  reset(): void {
    this.currentState = 'CALM';
    this.pendingState = null;
    this.confirmationCount = 0;
    this.consecutiveFallingVolatility = 0;
    this.previousState = 'CALM';
  }

  step(
    rawEscalationLevel: number,
    lpiSmoothed: number,
    volatilityTrend: VolatilityTrend,
  ): GradientEscalationResult {
    this.previousState = this.currentState;

    if (volatilityTrend === 'FALLING') {
      this.consecutiveFallingVolatility++;
    } else {
      this.consecutiveFallingVolatility = 0;
    }

    const candidate = rawLevelToCandidate(rawEscalationLevel, lpiSmoothed);
    const candidateIdx = stateIndex(candidate);
    const currentIdx = stateIndex(this.currentState);

    if (candidateIdx > currentIdx) {
      const skipConfirmation = lpiSmoothed > 0.6;
      if (skipConfirmation) {
        this.currentState = candidate;
        this.pendingState = null;
        this.confirmationCount = 0;
      } else if (this.pendingState === candidate) {
        this.confirmationCount++;
        if (this.confirmationCount >= 2) {
          this.currentState = candidate;
          this.pendingState = null;
          this.confirmationCount = 0;
        }
      } else {
        this.pendingState = candidate;
        this.confirmationCount = 1;
      }
    } else if (candidateIdx < currentIdx) {
      if (this.consecutiveFallingVolatility >= 2) {
        const newIdx = Math.max(currentIdx - 1, candidateIdx);
        this.currentState = STATE_ORDER[newIdx];
        this.pendingState = null;
        this.confirmationCount = 0;
      }
    } else {
      this.pendingState = null;
      this.confirmationCount = 0;
    }

    const newIdx = stateIndex(this.currentState);
    const prevIdx = stateIndex(this.previousState);
    let trend: EscalationTrend;
    if (newIdx > prevIdx) trend = 'UP';
    else if (newIdx < prevIdx) trend = 'DOWN';
    else trend = 'FLAT';

    return {
      state: this.currentState,
      numericLevel: newIdx,
      trend,
      confirmedTurns: this.confirmationCount,
    };
  }

  get current(): GradientEscalationState {
    return this.currentState;
  }
}
