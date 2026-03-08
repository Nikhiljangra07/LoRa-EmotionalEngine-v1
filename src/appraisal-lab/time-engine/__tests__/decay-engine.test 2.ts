import {
  TAU_SHORT_SECONDS,
  applyTimeDecay,
  exponentialDecay,
} from "../decay-engine";

describe("decay-engine", () => {
  test("delta = 0 applies no decay", () => {
    const value = 10;
    const result = exponentialDecay(value, 0, TAU_SHORT_SECONDS);
    expect(result).toBe(value);
  });

  test("delta = TAU_SHORT_SECONDS decays to ~0.3679 * value", () => {
    const value = 10;
    const result = exponentialDecay(value, TAU_SHORT_SECONDS, TAU_SHORT_SECONDS);
    expect(result).toBeCloseTo(3.679, 3);
  });

  test("delta = 3 * TAU_SHORT_SECONDS decays to ~0.0498 * value", () => {
    const value = 10;
    const result = applyTimeDecay(value, 3 * TAU_SHORT_SECONDS, TAU_SHORT_SECONDS);
    expect(result).toBeCloseTo(0.498, 3);
  });

  test("negative values decay correctly", () => {
    const value = -10;
    const result = exponentialDecay(value, TAU_SHORT_SECONDS, TAU_SHORT_SECONDS);
    expect(result).toBeCloseTo(-3.679, 3);
  });

  test("large delta approaches zero", () => {
    const value = 10;
    const deltaSeconds = 24 * 60 * 60;
    const result = applyTimeDecay(value, deltaSeconds, TAU_SHORT_SECONDS);
    expect(result).toBeCloseTo(0, 3);
  });
});
