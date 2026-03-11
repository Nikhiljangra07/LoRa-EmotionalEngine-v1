import { composeEIV } from "../EIVComposer";
import { MASTER_CONSTANTS } from "../../config/master.constants";

/**
	•	ARCHITECTURAL INVARIANT:
	•	EIV must not collapse into Expression Strength (ES).
	•	ES is a gain modifier; emotional base is derived from arousal and |valence|.
	•	Violating this invalidates the emotional abstraction.
*/

const CONSTANTS = MASTER_CONSTANTS.eivCompositionConstants;

const makeInputs = (params: {
  esScore: number;
  esConfidence: number;
  valenceScore: number;
  valenceConfidence: number;
  arousalScore: number;
  arousalConfidence: number;
}) => ({
  es: { score: params.esScore, confidence: params.esConfidence },
  valence: { score: params.valenceScore, confidence: params.valenceConfidence },
  arousal: { score: params.arousalScore, confidence: params.arousalConfidence },
});

describe("EIV correlation guard — ES is not the primary signal", () => {
  test("low ES, high base yields higher non-zero EIV", () => {
    const lowBase = composeEIV(
      makeInputs({
        esScore: 0.1,
        esConfidence: CONSTANTS.CONF.MAX,
        valenceScore: 0.1,
        valenceConfidence: CONSTANTS.CONF.MAX,
        arousalScore: 0.1,
        arousalConfidence: CONSTANTS.CONF.MAX,
      })
    );

    const highBase = composeEIV(
      makeInputs({
        esScore: 0.1,
        esConfidence: CONSTANTS.CONF.MAX,
        valenceScore: 0.7,
        valenceConfidence: CONSTANTS.CONF.MAX,
        arousalScore: 0.7,
        arousalConfidence: CONSTANTS.CONF.MAX,
      })
    );

    expect(lowBase.value).toBeGreaterThan(0);
    expect(highBase.value).toBeGreaterThan(lowBase.value);
  });

  test("high ES, zero base yields zero EIV", () => {
    const result = composeEIV(
      makeInputs({
        esScore: 0.8,
        esConfidence: CONSTANTS.CONF.MAX,
        valenceScore: 0,
        valenceConfidence: CONSTANTS.CONF.MIN,
        arousalScore: 0,
        arousalConfidence: CONSTANTS.CONF.MIN,
      })
    );

    expect(result.value).toBeCloseTo(0, 8);
  });

  test("constant ES with varying base produces EIV variance", () => {
    const samples = [
      { valence: 0.1, arousal: 0.1 },
      { valence: 0.4, arousal: 0.2 },
      { valence: 0.2, arousal: 0.6 },
      { valence: 0.7, arousal: 0.7 },
    ].map(({ valence, arousal }) =>
      composeEIV(
        makeInputs({
          esScore: 0.2,
          esConfidence: CONSTANTS.CONF.MAX,
          valenceScore: valence,
          valenceConfidence: CONSTANTS.CONF.MAX,
          arousalScore: arousal,
          arousalConfidence: CONSTANTS.CONF.MAX,
        })
      ).value
    );

    const min = Math.min(...samples);
    const max = Math.max(...samples);
    expect(max - min).toBeGreaterThan(0);
  });

  test("base-constant ES variation changes EIV via gain, not 1:1", () => {
    const lowEs = composeEIV(
      makeInputs({
        esScore: 0.2,
        esConfidence: CONSTANTS.CONF.MAX,
        valenceScore: 0.6,
        valenceConfidence: CONSTANTS.CONF.MAX,
        arousalScore: 0.6,
        arousalConfidence: CONSTANTS.CONF.MAX,
      })
    );

    const highEs = composeEIV(
      makeInputs({
        esScore: 0.8,
        esConfidence: CONSTANTS.CONF.MAX,
        valenceScore: 0.6,
        valenceConfidence: CONSTANTS.CONF.MAX,
        arousalScore: 0.6,
        arousalConfidence: CONSTANTS.CONF.MAX,
      })
    );

    const esDelta = 0.8 - 0.2;
    const eivDelta = highEs.value - lowEs.value;
    const slope = eivDelta / esDelta;

    expect(highEs.value).toBeGreaterThan(lowEs.value);
    expect(highEs.value).not.toBeCloseTo(0.8, 2);
    expect(lowEs.value).not.toBeCloseTo(0.2, 2);
    expect(slope).toBeGreaterThan(0);
    expect(slope).toBeLessThan(1);
  });
});
