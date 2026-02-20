import {
  DEFAULT_BASELINE_LATENCY_SECONDS,
  SESSION_THRESHOLD_SECONDS,
  TAU_LONG_SECONDS,
  TAU_SHORT_SECONDS,
  updatePressureWithTime,
} from "..";

const BASE_PRESSURE = 100;
const BASELINE = DEFAULT_BASELINE_LATENCY_SECONDS;

describe("time-physics integration", () => {
  test("scenario 1: rapid burst (delta = 10s)", () => {
    const result = updatePressureWithTime(BASE_PRESSURE, 10, 10, BASELINE);

    expect(result.gainModifier).toBe(1.3);
    expect(result.pressureAfterDecay).toBeLessThan(BASE_PRESSURE);
    expect(result.pressureAfterDecay).toBeGreaterThan(0);
    expect(Number.isFinite(result.pressureAfterDecay)).toBe(true);
  });

  test("scenario 2: normal gap (delta = baseline)", () => {
    const result = updatePressureWithTime(
      BASE_PRESSURE,
      BASELINE,
      BASELINE,
      BASELINE
    );

    expect(result.gainModifier).toBe(1.0);
    expect(result.pressureAfterDecay).toBeLessThan(BASE_PRESSURE);
    expect(Number.isFinite(result.pressureAfterDecay)).toBe(true);
  });

  test("scenario 3: silence (delta = 300s)", () => {
    const result = updatePressureWithTime(BASE_PRESSURE, 300, 300, BASELINE);

    expect(result.gainModifier).toBe(0.8);
    expect(result.pressureAfterDecay).toBeLessThan(BASE_PRESSURE * 0.8);
    expect(result.pressureAfterDecay).toBeGreaterThan(0);
    expect(Number.isFinite(result.pressureAfterDecay)).toBe(true);
  });

  test("scenario 4: long silence (delta = 7200s)", () => {
    const delta = 7200;
    const result = updatePressureWithTime(BASE_PRESSURE, delta, delta, BASELINE);
    const expectedAfterSession = BASE_PRESSURE * Math.exp(-delta / TAU_LONG_SECONDS);
    const expectedAfterMessage =
      expectedAfterSession * Math.exp(-delta / TAU_SHORT_SECONDS);

    expect(result.gainModifier).toBe(0.8);
    expect(result.pressureAfterDecay).toBeCloseTo(expectedAfterMessage, 10);
    expect(result.pressureAfterDecay).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(result.pressureAfterDecay)).toBe(true);
  });

  test("scenario 5: session boundary trigger", () => {
    const deltaSession = SESSION_THRESHOLD_SECONDS + 1;
    const deltaMessage = 5;
    const result = updatePressureWithTime(
      BASE_PRESSURE,
      deltaMessage,
      deltaSession,
      BASELINE
    );
    const expectedAfterSession =
      BASE_PRESSURE * Math.exp(-deltaSession / TAU_LONG_SECONDS);
    const expectedAfterMessage =
      expectedAfterSession * Math.exp(-deltaMessage / TAU_SHORT_SECONDS);

    expect(result.gainModifier).toBe(1.3);
    expect(result.pressureAfterDecay).toBeLessThan(BASE_PRESSURE);
    expect(result.pressureAfterDecay).toBeCloseTo(expectedAfterMessage, 10);
    expect(Number.isFinite(result.pressureAfterDecay)).toBe(true);
  });

  test("scenario 6: very large gap (24h)", () => {
    const result = updatePressureWithTime(BASE_PRESSURE, 86400, 86400, BASELINE);

    expect(result.gainModifier).toBe(0.8);
    expect(result.pressureAfterDecay).toBeGreaterThanOrEqual(0);
    expect(result.pressureAfterDecay).toBeLessThan(0.01);
    expect(Number.isFinite(result.pressureAfterDecay)).toBe(true);
    expect(Number.isNaN(result.pressureAfterDecay)).toBe(false);
  });

  test("global stability sweep", () => {
    for (let i = 0; i < 200; i += 1) {
      const randomDelta = (i * 997.0) % 200000;
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

  test("mathematical integrity at delta = 0", () => {
    const result = updatePressureWithTime(BASE_PRESSURE, 0, 0, BASELINE);

    expect(result.pressureAfterDecay).toBe(BASE_PRESSURE);
    expect(result.gainModifier).toBe(1.3);
  });
});
