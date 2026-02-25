import { AVIScorer } from '../AVIScorer';

describe('AVIScorer', () => {
  // AVI-1: AVI is in [0, 1] for all inputs
  test('avi.boundedness — AVI in [0, 1] for 10k random EIV buffers', () => {
    for (let i = 0; i < 10_000; i++) {
      const len = Math.floor(Math.random() * 20) + 1;
      const buf = Array.from({ length: len }, () => Math.random());
      const avi = AVIScorer.computeAVI(buf);
      expect(avi).toBeGreaterThanOrEqual(0);
      expect(avi).toBeLessThanOrEqual(1);
    }
  });

  // AVI-3: AVI = 0 when all EIV values are identical
  test('avi.zeroOnConstant — constant EIV stream produces AVI = 0', () => {
    const buf = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    expect(AVIScorer.computeAVI(buf)).toBe(0);
  });

  // AVI-2: AVI = 0 when fewer than 2 values exist
  test('avi.zeroOnEmpty — fewer than 2 values produces AVI = 0', () => {
    expect(AVIScorer.computeAVI([])).toBe(0);
    expect(AVIScorer.computeAVI([0.5])).toBe(0);
  });

  // Stable vs volatile
  test('avi.stableVsVolatile — stable stream < volatile stream', () => {
    const stable = [0.15, 0.18, 0.14, 0.16, 0.19, 0.15, 0.17, 0.14];
    const volatile_ = [0.20, 0.70, 0.15, 0.80, 0.10, 0.75, 0.20, 0.65];
    expect(AVIScorer.computeAVI(stable)).toBeLessThan(AVIScorer.computeAVI(volatile_));
  });

  // AVI-4: Monotonicity — increasing RMSSD produces non-decreasing AVI
  test('avi.monotonicity — larger swings produce higher AVI', () => {
    const small = [0.5, 0.51, 0.5, 0.51, 0.5, 0.51, 0.5, 0.51];
    const medium = [0.3, 0.6, 0.3, 0.6, 0.3, 0.6, 0.3, 0.6];
    const large = [0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0];

    const aviSmall = AVIScorer.computeAVI(small);
    const aviMedium = AVIScorer.computeAVI(medium);
    const aviLarge = AVIScorer.computeAVI(large);

    expect(aviSmall).toBeLessThanOrEqual(aviMedium);
    expect(aviMedium).toBeLessThanOrEqual(aviLarge);
  });

  // AVI-5: Determinism — same buffer produces identical AVI
  test('avi.determinism — same buffer produces identical result', () => {
    const buf = [0.1, 0.4, 0.2, 0.8, 0.3, 0.7, 0.15, 0.6];
    const a = AVIScorer.computeAVI(buf);
    const b = AVIScorer.computeAVI(buf);
    expect(a).toBe(b);
  });

  // Worked examples from the Gap Closure Plan (Section 2.3)
  test('avi.workedExamples — examples A, B, C produce expected values', () => {
    // Example A: Calm, stable session → AVI ≈ 0.062
    const exA = [0.15, 0.18, 0.14, 0.16, 0.19, 0.15, 0.17, 0.14];
    expect(AVIScorer.computeAVI(exA)).toBeCloseTo(0.062, 2);

    // Example B: Steadily escalating → AVI ≈ 0.200
    const exB = [0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80];
    expect(AVIScorer.computeAVI(exB)).toBeCloseTo(0.200, 2);

    // Example C: Volatile, oscillating → AVI = 1.000
    const exC = [0.20, 0.70, 0.15, 0.80, 0.10, 0.75, 0.20, 0.65];
    expect(AVIScorer.computeAVI(exC)).toBeGreaterThanOrEqual(0.95);
  });
});
