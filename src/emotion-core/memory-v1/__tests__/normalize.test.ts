import {
  clamp,
  safeNumber,
  valenceTo01,
  tanh01,
  tanhSignedTo01,
  l2Normalize,
  applyDimSpec,
} from '../normalize';
import { MEMORY_V1_CONFIG } from '../constants';

describe('normalize – clamp', () => {
  it('returns lo when x < lo', () => {
    expect(clamp(-5, 0, 1)).toBe(0);
  });

  it('returns hi when x > hi', () => {
    expect(clamp(10, 0, 1)).toBe(1);
  });

  it('returns x when within range', () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });

  it('returns lo for NaN', () => {
    expect(clamp(NaN, 0, 1)).toBe(0);
  });

  it('returns lo for Infinity', () => {
    expect(clamp(Infinity, 0, 1)).toBe(0);
  });
});

describe('normalize – safeNumber', () => {
  it('returns fallback for NaN', () => {
    expect(safeNumber(NaN, 42)).toBe(42);
  });

  it('returns fallback for Infinity', () => {
    expect(safeNumber(Infinity, 7)).toBe(7);
  });

  it('returns fallback for -Infinity', () => {
    expect(safeNumber(-Infinity, 7)).toBe(7);
  });

  it('returns fallback for undefined', () => {
    expect(safeNumber(undefined, 3)).toBe(3);
  });

  it('returns fallback for null', () => {
    expect(safeNumber(null, 3)).toBe(3);
  });

  it('returns value for valid finite number', () => {
    expect(safeNumber(0.75, 0)).toBe(0.75);
  });

  it('returns 0 when 0 is a valid value', () => {
    expect(safeNumber(0, 99)).toBe(0);
  });
});

describe('normalize – valenceTo01', () => {
  it('maps -1 to 0', () => {
    expect(valenceTo01(-1)).toBeCloseTo(0, 10);
  });

  it('maps 0 to 0.5', () => {
    expect(valenceTo01(0)).toBeCloseTo(0.5, 10);
  });

  it('maps 1 to 1', () => {
    expect(valenceTo01(1)).toBeCloseTo(1, 10);
  });

  it('clamps out-of-range negative to 0', () => {
    expect(valenceTo01(-5)).toBe(0);
  });

  it('clamps out-of-range positive to 1', () => {
    expect(valenceTo01(5)).toBe(1);
  });
});

describe('normalize – tanh01', () => {
  it('returns ~0 for x=0', () => {
    expect(tanh01(0, 30)).toBeCloseTo(0, 5);
  });

  it('saturates toward 1 for large positive x', () => {
    const result = tanh01(200, 30, [0, 120]);
    expect(result).toBeGreaterThan(0.99);
    expect(result).toBeLessThanOrEqual(1);
  });

  it('clamps negative input to clamp range lower bound', () => {
    const result = tanh01(-50, 30, [0, 120]);
    expect(result).toBeCloseTo(0, 5);
  });

  it('returns value in [0,1] for moderate input', () => {
    const result = tanh01(30, 30);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(1);
    expect(result).toBeCloseTo(Math.tanh(1), 5);
  });
});

describe('normalize – tanhSignedTo01', () => {
  it('maps 0 to ~0.5', () => {
    expect(tanhSignedTo01(0, 15)).toBeCloseTo(0.5, 5);
  });

  it('maps large negative to value < 0.5', () => {
    const result = tanhSignedTo01(-60, 15, [-60, 60]);
    expect(result).toBeLessThan(0.5);
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it('maps large positive to value > 0.5', () => {
    const result = tanhSignedTo01(60, 15, [-60, 60]);
    expect(result).toBeGreaterThan(0.5);
    expect(result).toBeLessThanOrEqual(1);
  });

  it('stays within [0,1] for extreme values', () => {
    const result = tanhSignedTo01(99999, 15, [-60, 60]);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });
});

describe('normalize – l2Normalize', () => {
  it('returns zero vector for all-zero input', () => {
    const result = l2Normalize([0, 0, 0, 0], 1e-8);
    expect(result).toEqual([0, 0, 0, 0]);
  });

  it('produces unit norm for non-zero vector', () => {
    const result = l2Normalize([3, 4, 0], 1e-8);
    const norm = Math.sqrt(result.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1.0, 8);
  });

  it('preserves direction', () => {
    const result = l2Normalize([3, 4, 0], 1e-8);
    expect(result[0] / result[1]).toBeCloseTo(3 / 4, 8);
  });

  it('returns same length as input', () => {
    const result = l2Normalize([1, 2, 3, 4, 5], 1e-8);
    expect(result.length).toBe(5);
  });

  it('handles NaN values by treating as 0', () => {
    const result = l2Normalize([NaN, 0, 1], 1e-8);
    expect(Number.isFinite(result[0])).toBe(true);
    expect(Number.isFinite(result[2])).toBe(true);
    const norm = Math.sqrt(result.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1.0, 8);
  });

  it('returns zero vector when norm is below eps', () => {
    const tiny = 1e-12;
    const result = l2Normalize([tiny, tiny], 1e-8);
    expect(result).toEqual([0, 0]);
  });
});

describe('normalize – applyDimSpec', () => {
  const { DIM_SPECS } = MEMORY_V1_CONFIG;

  it('applies identity transform for eivValue (dim 0)', () => {
    expect(applyDimSpec(0.8, DIM_SPECS[0])).toBeCloseTo(0.8, 10);
  });

  it('applies valenceTo01 for valenceScore (dim 1)', () => {
    expect(applyDimSpec(-1, DIM_SPECS[1])).toBeCloseTo(0, 10);
    expect(applyDimSpec(0, DIM_SPECS[1])).toBeCloseTo(0.5, 10);
    expect(applyDimSpec(1, DIM_SPECS[1])).toBeCloseTo(1, 10);
  });

  it('returns fallback for undefined input', () => {
    expect(applyDimSpec(undefined, DIM_SPECS[0])).toBe(0.0);
    expect(applyDimSpec(undefined, DIM_SPECS[1])).toBe(0.5);
  });

  it('applies tanh01 for pressureScalar (dim 14)', () => {
    const result = applyDimSpec(60, DIM_SPECS[14]);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(1);
    expect(result).toBeCloseTo(Math.tanh(60 / 30), 5);
  });

  it('applies tanhSignedTo01 for pressureSlope (dim 15)', () => {
    const resultZero = applyDimSpec(0, DIM_SPECS[15]);
    expect(resultZero).toBeCloseTo(0.5, 5);

    const resultNeg = applyDimSpec(-30, DIM_SPECS[15]);
    expect(resultNeg).toBeLessThan(0.5);
  });
});
