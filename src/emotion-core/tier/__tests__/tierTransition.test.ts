import { computeTierTransition } from '../tierTransition';
import type { TierStateStored } from '../TierState';

function makeState(overrides: Partial<TierStateStored> = {}): TierStateStored {
  return {
    userId: 'test-user',
    currentTier: 'TIER_1',
    sessionCount: 0,
    etvTrajectory: [],
    escalationCount: 0,
    lastTransitionAt: Date.now(),
    ...overrides,
  };
}

describe('computeTierTransition', () => {
  it('returns TIER_1 when sessionCount < 2', () => {
    expect(computeTierTransition(makeState({ sessionCount: 0 }), 0.6)).toBe('TIER_1');
    expect(computeTierTransition(makeState({ sessionCount: 1 }), 0.9)).toBe('TIER_1');
  });

  it('returns TIER_2 when sessionCount >= 2 and etvMean >= 0.35', () => {
    expect(computeTierTransition(makeState({ sessionCount: 2 }), 0.35)).toBe('TIER_2');
    expect(computeTierTransition(makeState({ sessionCount: 3 }), 0.4)).toBe('TIER_2');
  });

  it('returns TIER_3 when sessionCount >= 4 and etvMean >= 0.5', () => {
    expect(computeTierTransition(makeState({ sessionCount: 4 }), 0.5)).toBe('TIER_3');
    expect(computeTierTransition(makeState({ sessionCount: 10 }), 0.8)).toBe('TIER_3');
  });

  it('TIER_3 takes priority over TIER_2 when both thresholds met', () => {
    expect(computeTierTransition(makeState({ sessionCount: 5 }), 0.6)).toBe('TIER_3');
  });

  it('remains at current tier when no promotion threshold met', () => {
    const state = makeState({ sessionCount: 3, currentTier: 'TIER_2' });
    expect(computeTierTransition(state, 0.2)).toBe('TIER_2');
  });

  it('remains at TIER_1 when sessionCount >= 2 but etvMean too low', () => {
    const state = makeState({ sessionCount: 3, currentTier: 'TIER_1' });
    expect(computeTierTransition(state, 0.1)).toBe('TIER_1');
  });
});
