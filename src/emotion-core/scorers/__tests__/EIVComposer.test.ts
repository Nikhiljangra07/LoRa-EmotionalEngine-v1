import { readFileSync } from "fs";
import path from "path";
import { composeEIV } from "../EIVComposer";
import { MASTER_CONSTANTS } from "../../config/master.constants";

const CONSTANTS = MASTER_CONSTANTS.eivCompositionConstants;

const baseInputs = {
  es: { score: 0.6, confidence: 0.8 },
  valence: { score: 0.4, confidence: 0.7 },
  arousal: { arousal: 0.4, confidence: 0.7 },
};

describe("EIVComposer", () => {
  test("hierarchical compression keeps ES from fabricating intensity", () => {
    const nearFloor = composeEIV({
      es: { score: 1, confidence: 1 },
      valence: { score: 0, confidence: CONSTANTS.CONF.MIN },
      arousal: { arousal: CONSTANTS.BASE_FLOOR_GATE, confidence: CONSTANTS.CONF.MIN },
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
      arousal: { arousal: 0.6, confidence: CONSTANTS.CONF.MIN },
    });

    const highConf = composeEIV({
      es: { score: 0, confidence: CONSTANTS.CONF.MAX },
      valence: { score: 0.6, confidence: CONSTANTS.CONF.MAX },
      arousal: { arousal: 0.6, confidence: CONSTANTS.CONF.MAX },
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

  test("safe ES amplification never exceeds clamp", () => {
    const high = composeEIV({
      es: { score: 1, confidence: 1 },
      valence: { score: 1, confidence: 0.9 },
      arousal: { arousal: 1, confidence: 0.9 },
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
