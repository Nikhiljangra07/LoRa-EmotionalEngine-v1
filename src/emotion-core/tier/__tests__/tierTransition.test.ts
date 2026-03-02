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

describe('computeTierTransition — deterministic session-based progression', () => {
  it('sessionCount 0 → TIER_1', () => {
    expect(computeTierTransition(makeState({ sessionCount: 0 }))).toBe('TIER_1');
  });

  it('sessionCount 1 → TIER_1', () => {
    expect(computeTierTransition(makeState({ sessionCount: 1 }))).toBe('TIER_1');
  });

  it('sessionCount 2 → TIER_2', () => {
    expect(computeTierTransition(makeState({ sessionCount: 2 }))).toBe('TIER_2');
  });

  it('sessionCount 3 → TIER_2', () => {
    expect(computeTierTransition(makeState({ sessionCount: 3 }))).toBe('TIER_2');
  });

  it('sessionCount 4 → TIER_2', () => {
    expect(computeTierTransition(makeState({ sessionCount: 4 }))).toBe('TIER_2');
  });

  it('sessionCount 5 → TIER_3', () => {
    expect(computeTierTransition(makeState({ sessionCount: 5 }))).toBe('TIER_3');
  });

  it('sessionCount 10 → TIER_3', () => {
    expect(computeTierTransition(makeState({ sessionCount: 10 }))).toBe('TIER_3');
  });

  it('no EIV/ETV input required — function takes only state', () => {
    // Signature should not require etvMean; calling with state is sufficient.
    const tier = computeTierTransition(makeState({ sessionCount: 2 }));
    expect(tier).toBe('TIER_2');
  });

  it('currentTier field in state does not affect output', () => {
    expect(computeTierTransition(makeState({ sessionCount: 3, currentTier: 'TIER_1' }))).toBe('TIER_2');
    expect(computeTierTransition(makeState({ sessionCount: 6, currentTier: 'TIER_2' }))).toBe('TIER_3');
  });
});
