/**
 * TIME ENGINE STRESS VALIDATED
 * - Exponential decay stable
 * - No NaN/Infinity
 * - No negative leakage
 * - No architecture coupling
 */
import {
  DEFAULT_BASELINE_LATENCY_SECONDS,
  SESSION_THRESHOLD_SECONDS,
  updatePressureWithTime,
} from "..";

const BASE_PRESSURE = 100;
const BASELINE = DEFAULT_BASELINE_LATENCY_SECONDS;

describe("time-engine stress", () => {
  test("stress 1: large iterative decay (1000 cycles)", () => {
    let pressure = BASE_PRESSURE;

    for (let i = 0; i < 1000; i += 1) {
      const result = updatePressureWithTime(pressure, 60, 60);
      pressure = result.pressureAfterDecay;

      expect(Number.isFinite(pressure)).toBe(true);
      expect(pressure).toBeGreaterThanOrEqual(0);
    }

    expect(pressure).toBeLessThan(BASE_PRESSURE);
  });

  test("stress 2: delta fuzzing (10,000 runs)", () => {
    for (let i = 0; i < 10000; i += 1) {
      // Deterministic pseudo-randomized sweep over [0, 200000).
      const randomDelta = (i * 7919.0) % 200000;

      const result = updatePressureWithTime(
        BASE_PRESSURE,
        randomDelta,
        randomDelta
      );

      expect(Number.isFinite(result.pressureAfterDecay)).toBe(true);
      expect(result.pressureAfterDecay).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(result.gainModifier)).toBe(true);
    }
  });

  test("stress 3A: extreme edge case delta = 0", () => {
    const resultZero = updatePressureWithTime(BASE_PRESSURE, 0, 0);

    expect(resultZero.pressureAfterDecay).toBe(BASE_PRESSURE);
    expect(Number.isFinite(resultZero.pressureAfterDecay)).toBe(true);
    expect(resultZero.gainModifier).toBe(1.3);
  });

  test("stress 3B: extreme edge case delta = 10 years", () => {
    const tenYearsSeconds = 10 * 365 * 24 * 60 * 60;
    const resultHuge = updatePressureWithTime(
      BASE_PRESSURE,
      tenYearsSeconds,
      tenYearsSeconds
    );

    expect(resultHuge.pressureAfterDecay).toBeGreaterThanOrEqual(0);
    expect(resultHuge.pressureAfterDecay).toBeLessThan(0.000001);
    expect(Number.isNaN(resultHuge.pressureAfterDecay)).toBe(false);
    expect(Number.isFinite(resultHuge.pressureAfterDecay)).toBe(true);
  });

  test("stress 4: micro float precision", () => {
    const tinyDelta = 0.000001;
    const resultTiny = updatePressureWithTime(
      BASE_PRESSURE,
      tinyDelta,
      tinyDelta
    );

    expect(resultTiny.pressureAfterDecay).toBeLessThan(BASE_PRESSURE);
    expect(resultTiny.pressureAfterDecay).toBeGreaterThan(0);
    expect(Number.isFinite(resultTiny.pressureAfterDecay)).toBe(true);
  });

  test("stress 5: high pressure value", () => {
    const resultLarge = updatePressureWithTime(1_000_000, 60, 60);

    expect(Number.isFinite(resultLarge.pressureAfterDecay)).toBe(true);
    expect(resultLarge.pressureAfterDecay).toBeGreaterThan(0);
    expect(resultLarge.pressureAfterDecay).toBeLessThan(1_000_000);
  });

  test("stress 6: boundary transition sanity around session threshold", () => {
    const before = updatePressureWithTime(
      BASE_PRESSURE,
      BASELINE,
      SESSION_THRESHOLD_SECONDS
    );
    const after = updatePressureWithTime(
      BASE_PRESSURE,
      BASELINE,
      SESSION_THRESHOLD_SECONDS + 1
    );

    expect(before.pressureAfterDecay).toBeGreaterThan(after.pressureAfterDecay);
    expect(Number.isFinite(before.pressureAfterDecay)).toBe(true);
    expect(Number.isFinite(after.pressureAfterDecay)).toBe(true);
  });

  test("optional performance loop (50,000 updates)", () => {
    let pressure = BASE_PRESSURE;

    for (let i = 0; i < 50000; i += 1) {
      const result = updatePressureWithTime(pressure, 30, 30);
      pressure = result.pressureAfterDecay;
    }

    expect(Number.isFinite(pressure)).toBe(true);
    expect(pressure).toBeGreaterThanOrEqual(0);
  });

  test("final stability assertion block", () => {
    const result = updatePressureWithTime(BASE_PRESSURE, BASELINE, BASELINE);

    expect(result.pressureAfterDecay).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(result.pressureAfterDecay)).toBe(false);
    expect(result.pressureAfterDecay).not.toBe(Infinity);
    expect(result.pressureAfterDecay).not.toBe(-Infinity);
  });
});
