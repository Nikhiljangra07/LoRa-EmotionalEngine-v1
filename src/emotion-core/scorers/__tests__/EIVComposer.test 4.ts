import { readFileSync } from "fs";
import path from "path";
import { composeEIV } from "../EIVComposer";
import { MASTER_CONSTANTS } from "../../config/master.constants";

const CONSTANTS = MASTER_CONSTANTS.eivCompositionConstants;

const baseInputs = {
  es: { score: 0.6, confidence: 0.8 },
  valence: { score: 0.4, confidence: 0.7 },
  arousal: { score: 0.4, confidence: 0.7 },
};

describe("EIVComposer", () => {
  test("hierarchical compression keeps ES from fabricating intensity", () => {
    const nearFloor = composeEIV({
      es: { score: 1, confidence: 1 },
      valence: { score: 0, confidence: CONSTANTS.CONF.MIN },
      arousal: { score: CONSTANTS.BASE_FLOOR_GATE, confidence: CONSTANTS.CONF.MIN },
    });

    const maxGain =
      CONSTANTS.ES_GAIN_MAX_DELTA *
      CONSTANTS.LOW_BASE_GAIN_SCALE *
      1 *
      1;

    expect(nearFloor.value).toBeLessThanOrEqual(
      nearFloor.base * (1 + maxGain)
    );
  });

  test("confidence-weighted aggregation favors higher confidence", () => {
    const lowConf = composeEIV({
      es: { score: 0, confidence: CONSTANTS.CONF.MIN },
      valence: { score: 0.6, confidence: CONSTANTS.CONF.MIN },
      arousal: { score: 0.6, confidence: CONSTANTS.CONF.MIN },
    });

    const highConf = composeEIV({
      es: { score: 0, confidence: CONSTANTS.CONF.MAX },
      valence: { score: 0.6, confidence: CONSTANTS.CONF.MAX },
      arousal: { score: 0.6, confidence: CONSTANTS.CONF.MAX },
    });

    expect(highConf.base).toBeGreaterThan(lowConf.base);
  });

  test("orthogonality preserved via absolute valence", () => {
    const positive = composeEIV({
      ...baseInputs,
      valence: { score: 0.6, confidence: 0.7 },
    });
    const negative = composeEIV({
      ...baseInputs,
      valence: { score: -0.6, confidence: 0.7 },
    });
    expect(positive.base).toBeCloseTo(negative.base, 8);
  });

  test("confidence sensitivity lowers base with weaker confidence", () => {
    const highConf = composeEIV({
      es: { score: 0, confidence: 0.5 },
      valence: { score: 0.7, confidence: CONSTANTS.CONF.MAX },
      arousal: { score: 0.7, confidence: CONSTANTS.CONF.MAX },
    });
    const lowConf = composeEIV({
      es: { score: 0, confidence: 0.5 },
      valence: { score: 0.7, confidence: CONSTANTS.CONF.MIN },
      arousal: { score: 0.7, confidence: CONSTANTS.CONF.MIN },
    });
    expect(highConf.base).toBeGreaterThan(lowConf.base);
  });

  test("no leakage: arousal-only yields non-zero base", () => {
    const result = composeEIV({
      es: { score: 0, confidence: 0.5 },
      valence: { score: 0, confidence: CONSTANTS.CONF.MIN },
      arousal: { score: 0.8, confidence: CONSTANTS.CONF.MAX },
    });
    expect(result.base).toBeGreaterThan(CONSTANTS.CLAMP.MIN);
  });

  test("no leakage: valence-only yields non-zero base", () => {
    const result = composeEIV({
      es: { score: 0, confidence: 0.5 },
      valence: { score: 0.8, confidence: CONSTANTS.CONF.MAX },
      arousal: { score: 0, confidence: CONSTANTS.CONF.MIN },
    });
    expect(result.base).toBeGreaterThan(CONSTANTS.CLAMP.MIN);
  });

  test("no dominance: strong valence and arousal both contribute", () => {
    const valenceStrong = composeEIV({
      es: { score: 0, confidence: 0.5 },
      valence: { score: 1, confidence: CONSTANTS.CONF.MAX },
      arousal: { score: 0.2, confidence: CONSTANTS.CONF.MAX },
    });
    const arousalStrong = composeEIV({
      es: { score: 0, confidence: 0.5 },
      valence: { score: 0.2, confidence: CONSTANTS.CONF.MAX },
      arousal: { score: 1, confidence: CONSTANTS.CONF.MAX },
    });
    expect(valenceStrong.base).toBeGreaterThan(CONSTANTS.CLAMP.MIN);
    expect(arousalStrong.base).toBeGreaterThan(CONSTANTS.CLAMP.MIN);
    expect(Math.abs(valenceStrong.base - arousalStrong.base)).toBeLessThan(0.6);
  });

  test("stability: small perturbations do not cause jumps", () => {
    const base = composeEIV({
      es: { score: 0, confidence: 0.5 },
      valence: { score: 0.4, confidence: 0.7 },
      arousal: { score: 0.4, confidence: 0.7 },
    });
    const slightlyHigher = composeEIV({
      es: { score: 0, confidence: 0.5 },
      valence: { score: 0.42, confidence: 0.7 },
      arousal: { score: 0.4, confidence: 0.7 },
    });
    expect(slightlyHigher.base - base.base).toBeLessThan(0.05);
  });

  test("safe ES amplification never exceeds clamp", () => {
    const high = composeEIV({
      es: { score: 1, confidence: 1 },
      valence: { score: 1, confidence: 0.9 },
      arousal: { score: 1, confidence: 0.9 },
    });
    expect(high.value).toBeLessThanOrEqual(CONSTANTS.CLAMP.MAX);
    expect(high.value).toBeGreaterThan(high.base);
  });

  test("ES amplifies proportionally with higher score", () => {
    const low = composeEIV({
      ...baseInputs,
      es: { score: 0.2, confidence: 0.8 },
    });
    const high = composeEIV({
      ...baseInputs,
      es: { score: 0.8, confidence: 0.8 },
    });
    expect(high.value).toBeGreaterThan(low.value);
  });

  test("ES confidence scales gain effect", () => {
    const lowConf = composeEIV({
      ...baseInputs,
      es: { score: 0.8, confidence: 0.4 },
    });
    const highConf = composeEIV({
      ...baseInputs,
      es: { score: 0.8, confidence: 0.9 },
    });
    expect(highConf.value).toBeGreaterThan(lowConf.value);
  });

  test("composer has no analyzer imports", () => {
    const filePath = path.resolve(
      __dirname,
      "..",
      "EIVComposer.ts"
    );
    const source = readFileSync(filePath, "utf8");
    expect(source).not.toMatch(/Analyzer/);
  });
});
