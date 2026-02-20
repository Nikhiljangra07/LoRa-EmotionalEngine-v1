import { TAU_LONG_SECONDS } from "../decay-engine";
import { applySessionDecay, isNewSession } from "../session-boundary";

describe("session-boundary", () => {
  describe("isNewSession", () => {
    test("delta = 0 -> false", () => {
      expect(isNewSession(0)).toBe(false);
    });

    test("delta = 3599 -> false", () => {
      expect(isNewSession(3599)).toBe(false);
    });

    test("delta = 3600 -> false", () => {
      expect(isNewSession(3600)).toBe(false);
    });

    test("delta = 3601 -> true", () => {
      expect(isNewSession(3601)).toBe(true);
    });

    test("delta = 10000 -> true", () => {
      expect(isNewSession(10000)).toBe(true);
    });
  });

  describe("applySessionDecay", () => {
    test("delta = 0 -> unchanged pressure", () => {
      const previousPressure = 100;
      const result = applySessionDecay(previousPressure, 0, TAU_LONG_SECONDS);
      expect(result).toBe(100);
    });

    test("delta = tauLongSeconds -> ~36.79", () => {
      const previousPressure = 100;
      const result = applySessionDecay(
        previousPressure,
        TAU_LONG_SECONDS,
        TAU_LONG_SECONDS
      );
      expect(result).toBeCloseTo(36.79, 2);
    });

    test("delta = 3 * tauLongSeconds -> ~4.98", () => {
      const previousPressure = 100;
      const result = applySessionDecay(
        previousPressure,
        3 * TAU_LONG_SECONDS,
        TAU_LONG_SECONDS
      );
      expect(result).toBeCloseTo(4.98, 2);
    });
  });
});
