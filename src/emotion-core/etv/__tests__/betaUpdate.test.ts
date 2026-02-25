import { applyDecay, applyEvidence, computeDerived, toFullState } from '../betaUpdate';
import { ETV_CONFIG } from '../constants';
import type { ETVStateStored } from '../types';

function makeState(overrides: Partial<ETVStateStored> = {}): ETVStateStored {
  return {
    userId: 'test',
    r: 5,
    s: 5,
    lastSessionEndedAt: Date.now() - 3_600_000,
    updatedAt: Date.now() - 3_600_000,
    ...overrides,
  };
}

describe('computeDerived', () => {
  test('mean = r / (r + s)', () => {
    const d = computeDerived(3, 7);
    expect(d.etvMean).toBeCloseTo(0.3, 8);
  });

  test('variance matches Beta formula', () => {
    const r = 3, s = 7;
    const n = r + s;
    const expected = (r * s) / (n * n * (n + 1));
    const d = computeDerived(r, s);
    expect(d.etvVar).toBeCloseTo(expected, 12);
  });

  test('effectiveN = r + s', () => {
    expect(computeDerived(4.5, 3.2).effectiveN).toBeCloseTo(7.7, 8);
  });
});

describe('applyDecay', () => {
  test('zero idle → decay = 1, counts unchanged', () => {
    const st = makeState({ r: 10, s: 10 });
    const { state, decay } = applyDecay(st, 0);
    expect(decay).toBe(1);
    expect(state.r).toBe(10);
    expect(state.s).toBe(10);
  });

  test('H days idle → counts halved', () => {
    const halfLifeHours = ETV_CONFIG.decayHalfLifeDays * 24;
    const st = makeState({ r: 10, s: 10 });
    const { state, decay } = applyDecay(st, halfLifeHours);
    expect(decay).toBeCloseTo(0.5, 4);
    expect(state.r).toBeCloseTo(5, 4);
    expect(state.s).toBeCloseTo(5, 4);
  });

  test('extreme idle → counts floored at epsilon', () => {
    const st = makeState({ r: 1, s: 1 });
    const { state } = applyDecay(st, 365 * 24);
    expect(state.r).toBeGreaterThanOrEqual(ETV_CONFIG.epsilonFloor);
    expect(state.s).toBeGreaterThanOrEqual(ETV_CONFIG.epsilonFloor);
  });

  test('negative idle (clock skew) → no decay', () => {
    const st = makeState({ r: 10, s: 10 });
    const { state, decay } = applyDecay(st, -5);
    expect(decay).toBe(1);
    expect(state.r).toBe(10);
    expect(state.s).toBe(10);
  });

  test('decay floor enforced', () => {
    const st = makeState({ r: 1, s: 1 });
    const { decay } = applyDecay(st, 100_000);
    expect(decay).toBeGreaterThanOrEqual(ETV_CONFIG.decayFloor);
  });
});

describe('applyEvidence', () => {
  test('z_t = 1 → r increases by M, s unchanged', () => {
    const before = makeState({ r: 5, s: 5 });
    const after = applyEvidence(before, 1.0, 1.0);
    expect(after.r).toBe(6);
    expect(after.s).toBe(5);
  });

  test('z_t = 0 → s increases by M, r unchanged', () => {
    const before = makeState({ r: 5, s: 5 });
    const after = applyEvidence(before, 0.0, 1.0);
    expect(after.r).toBe(5);
    expect(after.s).toBe(6);
  });

  test('z_t = 0.6, M = 1 → sum increases by 1', () => {
    const before = makeState({ r: 5, s: 5 });
    const after = applyEvidence(before, 0.6, 1.0);
    expect(after.r + after.s).toBeCloseTo(11, 8);
    expect(after.r).toBeCloseTo(5.6, 8);
    expect(after.s).toBeCloseTo(5.4, 8);
  });
});

describe('toFullState', () => {
  test('merges stored fields with derived', () => {
    const stored = makeState({ r: 1.5, s: 2.5 });
    const full = toFullState(stored);
    expect(full.etvMean).toBeCloseTo(0.375, 6);
    expect(full.effectiveN).toBeCloseTo(4.0, 6);
    expect(full.userId).toBe('test');
  });
});
