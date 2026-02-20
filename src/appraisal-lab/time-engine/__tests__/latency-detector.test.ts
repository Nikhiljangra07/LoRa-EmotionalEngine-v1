import {
  computeGainModifier,
  detectBurst,
  detectSilence,
} from "../latency-detector";

describe("latency-detector", () => {
  test("detects burst when delta is much faster than baseline", () => {
    const baseline = 90;
    const delta = 30;
    expect(detectBurst(delta, baseline)).toBe(true);
  });

  test("detects silence when delta is much slower than baseline", () => {
    const baseline = 90;
    const delta = 200;
    expect(detectSilence(delta, baseline)).toBe(true);
  });

  test("neutral delta is neither burst nor silence", () => {
    const baseline = 90;
    const delta = 90;
    expect(detectBurst(delta, baseline)).toBe(false);
    expect(detectSilence(delta, baseline)).toBe(false);
  });

  test("computes gain modifier for burst, silence, and neutral", () => {
    const baseline = 90;
    expect(computeGainModifier(30, baseline)).toBe(1.3);
    expect(computeGainModifier(200, baseline)).toBe(0.8);
    expect(computeGainModifier(90, baseline)).toBe(1.0);
  });

  test("delta = 0 is detected as burst", () => {
    const baseline = 90;
    const delta = 0;
    expect(detectBurst(delta, baseline)).toBe(true);
  });

  test("very large delta is detected as silence", () => {
    const baseline = 90;
    const delta = 10000;
    expect(detectSilence(delta, baseline)).toBe(true);
  });
});
