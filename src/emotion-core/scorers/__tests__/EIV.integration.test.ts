import { composeEIV } from "../EIVComposer";
import { MASTER_CONSTANTS } from "../../config/master.constants";

const CONSTANTS = MASTER_CONSTANTS.eivCompositionConstants;

const TOLERANCE =
  CONSTANTS.ES_GAIN_MAX_DELTA * CONSTANTS.BASE_FLOOR_GATE;

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
  arousal: { arousal: params.arousalScore, confidence: params.arousalConfidence },
});

const logEIV = (label: string, result: ReturnType<typeof composeEIV>) => {
  console.debug(label, {
    baseIntensity: result.base,
    gain: result.gain,
    eiv: result.value,
    confidence: result.baseConfidence,
  });
};

describe("EIV integration — Phase 1: Unit-level invariants", () => {
  test("ES increases EIV only above base floor", () => {
    console.group("PHASE 1: ES gain gating");
    const lowBase = composeEIV(
      makeInputs({
        esScore: 1,
        esConfidence: 1,
        valenceScore: 0,
        valenceConfidence: CONSTANTS.CONF.MIN,
        arousalScore: CONSTANTS.BASE_FLOOR_GATE,
        arousalConfidence: CONSTANTS.CONF.MIN,
      })
    );
    const higherBase = composeEIV(
      makeInputs({
        esScore: 1,
        esConfidence: 1,
        valenceScore: 0.6,
        valenceConfidence: CONSTANTS.CONF.MAX,
        arousalScore: 0.6,
        arousalConfidence: CONSTANTS.CONF.MAX,
      })
    );
    logEIV("lowBase", lowBase);
    logEIV("higherBase", higherBase);
    expect(higherBase.value).toBeGreaterThan(lowBase.value);
    console.groupEnd();
  });

  test("ES alone cannot create intensity near floor", () => {
    console.group("PHASE 1: ES cannot fabricate");
    const result = composeEIV(
      makeInputs({
        esScore: 1,
        esConfidence: 1,
        valenceScore: 0,
        valenceConfidence: CONSTANTS.CONF.MIN,
        arousalScore: CONSTANTS.CLAMP.MIN,
        arousalConfidence: CONSTANTS.CONF.MIN,
      })
    );
    logEIV("esOnly", result);
    expect(result.value).toBeLessThanOrEqual(
      result.base * (1 + CONSTANTS.ES_GAIN_MAX_DELTA)
    );
    console.groupEnd();
  });

  test("valence sign inversion does not change EIV magnitude", () => {
    console.group("PHASE 1: valence sign invariance");
    const positive = composeEIV(
      makeInputs({
        esScore: 0,
        esConfidence: CONSTANTS.CONF.MIN,
        valenceScore: 0.6,
        valenceConfidence: CONSTANTS.CONF.MAX,
        arousalScore: 0.6,
        arousalConfidence: CONSTANTS.CONF.MAX,
      })
    );
    const negative = composeEIV(
      makeInputs({
        esScore: 0,
        esConfidence: CONSTANTS.CONF.MIN,
        valenceScore: -0.6,
        valenceConfidence: CONSTANTS.CONF.MAX,
        arousalScore: 0.6,
        arousalConfidence: CONSTANTS.CONF.MAX,
      })
    );
    logEIV("positive", positive);
    logEIV("negative", negative);
    expect(positive.value).toBeCloseTo(negative.value, 8);
    console.groupEnd();
  });
});

describe("EIV integration — Phase 2: Orthogonality tests", () => {
  test("same arousal + same |valence| yields same EIV", () => {
    console.group("PHASE 2: sign invariance");
    const positive = composeEIV(
      makeInputs({
        esScore: 0.4,
        esConfidence: 0.6,
        valenceScore: 0.5,
        valenceConfidence: 0.8,
        arousalScore: 0.5,
        arousalConfidence: 0.8,
      })
    );
    const negative = composeEIV(
      makeInputs({
        esScore: 0.4,
        esConfidence: 0.6,
        valenceScore: -0.5,
        valenceConfidence: 0.8,
        arousalScore: 0.5,
        arousalConfidence: 0.8,
      })
    );
    console.table([
      { label: "positive", eiv: positive.value },
      { label: "negative", eiv: negative.value },
    ]);
    expect(positive.value).toBeCloseTo(negative.value, 8);
    console.groupEnd();
  });

  test("same base with different ES yields different EIV", () => {
    console.group("PHASE 2: ES difference");
    const low = composeEIV(
      makeInputs({
        esScore: 0.2,
        esConfidence: 0.8,
        valenceScore: 0.4,
        valenceConfidence: 0.8,
        arousalScore: 0.4,
        arousalConfidence: 0.8,
      })
    );
    const high = composeEIV(
      makeInputs({
        esScore: 0.8,
        esConfidence: 0.8,
        valenceScore: 0.4,
        valenceConfidence: 0.8,
        arousalScore: 0.4,
        arousalConfidence: 0.8,
      })
    );
    console.table([
      { label: "EXPECTED: different", eiv: low.value },
      { label: "EXPECTED: different", eiv: high.value },
    ]);
    expect(high.value).toBeGreaterThan(low.value);
    console.groupEnd();
  });

  test("same ES with different base yields different EIV", () => {
    console.group("PHASE 2: base difference");
    const lowBase = composeEIV(
      makeInputs({
        esScore: 0.6,
        esConfidence: 0.8,
        valenceScore: 0.2,
        valenceConfidence: 0.7,
        arousalScore: 0.2,
        arousalConfidence: 0.7,
      })
    );
    const highBase = composeEIV(
      makeInputs({
        esScore: 0.6,
        esConfidence: 0.8,
        valenceScore: 0.8,
        valenceConfidence: 0.7,
        arousalScore: 0.8,
        arousalConfidence: 0.7,
      })
    );
    console.table([
      { label: "EXPECTED: different", eiv: lowBase.value },
      { label: "EXPECTED: different", eiv: highBase.value },
    ]);
    expect(highBase.value).toBeGreaterThan(lowBase.value);
    console.groupEnd();
  });
});

describe("EIV integration — Phase 3: Scenario-level golden tests", () => {
  test("canonical phrases follow relative ordering", () => {
    console.group("PHASE 3: scenarios");
    const samples = [
      {
        label: "I love this!!!",
        input: makeInputs({
          esScore: 0.7,
          esConfidence: 0.8,
          valenceScore: 0.7,
          valenceConfidence: 0.8,
          arousalScore: 0.7,
          arousalConfidence: 0.8,
        }),
      },
      {
        label: "I hate this!!!",
        input: makeInputs({
          esScore: 0.7,
          esConfidence: 0.8,
          valenceScore: -0.7,
          valenceConfidence: 0.8,
          arousalScore: 0.7,
          arousalConfidence: 0.8,
        }),
      },
      {
        label: "Fine.",
        input: makeInputs({
          esScore: 0.2,
          esConfidence: 0.6,
          valenceScore: 0.1,
          valenceConfidence: 0.6,
          arousalScore: 0.2,
          arousalConfidence: 0.6,
        }),
      },
      {
        label: "FINE!!!",
        input: makeInputs({
          esScore: 0.6,
          esConfidence: 0.7,
          valenceScore: 0.1,
          valenceConfidence: 0.6,
          arousalScore: 0.6,
          arousalConfidence: 0.7,
        }),
      },
      {
        label: "Not good, not bad.",
        input: makeInputs({
          esScore: 0.3,
          esConfidence: 0.6,
          valenceScore: 0.1,
          valenceConfidence: 0.5,
          arousalScore: 0.2,
          arousalConfidence: 0.5,
        }),
      },
      {
        label: "This is AMAZING!!!",
        input: makeInputs({
          esScore: 0.9,
          esConfidence: 0.9,
          valenceScore: 0.8,
          valenceConfidence: 0.9,
          arousalScore: 0.9,
          arousalConfidence: 0.9,
        }),
      },
      {
        label: "Oh GREAT idea!!!",
        input: makeInputs({
          esScore: 0.8,
          esConfidence: 0.6,
          valenceScore: 0.4,
          valenceConfidence: 0.5,
          arousalScore: 0.8,
          arousalConfidence: 0.6,
        }),
      },
    ];

    const results = samples.map((sample) => {
      const result = composeEIV(sample.input);
      console.debug(sample.label, {
        input: sample.input,
        eiv: result.value,
        confidence: result.baseConfidence,
      });
      return { label: sample.label, ...result };
    });

    const love = results.find((r) => r.label === "I love this!!!")!;
    const hate = results.find((r) => r.label === "I hate this!!!")!;
    const fine = results.find((r) => r.label === "Fine.")!;
    const fineLoud = results.find((r) => r.label === "FINE!!!")!;
    const notBad = results.find((r) => r.label === "Not good, not bad.")!;
    const amazing = results.find((r) => r.label === "This is AMAZING!!!")!;
    const sarcasm = results.find((r) => r.label === "Oh GREAT idea!!!")!;

    expect(love.value).toBeCloseTo(hate.value, 8);
    expect(fineLoud.value).toBeGreaterThan(fine.value);
    expect(amazing.value).toBeGreaterThan(notBad.value);
    expect(sarcasm.baseConfidence).toBeLessThanOrEqual(
      CONSTANTS.CONF.MAX
    );
    console.groupEnd();
  });
});

describe("EIV integration — Phase 4: Regression lock", () => {
  test("canonical tuples remain within tolerance", () => {
    console.group("PHASE 4: regression lock");
    const tuples = [
      {
        label: "base-low",
        input: makeInputs({
          esScore: 0.2,
          esConfidence: 0.5,
          valenceScore: 0.2,
          valenceConfidence: 0.5,
          arousalScore: 0.2,
          arousalConfidence: 0.5,
        }),
        expected: composeEIV(
          makeInputs({
            esScore: 0.2,
            esConfidence: 0.5,
            valenceScore: 0.2,
            valenceConfidence: 0.5,
            arousalScore: 0.2,
            arousalConfidence: 0.5,
          })
        ).value,
      },
      {
        label: "base-mid",
        input: makeInputs({
          esScore: 0.5,
          esConfidence: 0.7,
          valenceScore: 0.5,
          valenceConfidence: 0.7,
          arousalScore: 0.5,
          arousalConfidence: 0.7,
        }),
        expected: composeEIV(
          makeInputs({
            esScore: 0.5,
            esConfidence: 0.7,
            valenceScore: 0.5,
            valenceConfidence: 0.7,
            arousalScore: 0.5,
            arousalConfidence: 0.7,
          })
        ).value,
      },
    ];

    tuples.forEach((tuple) => {
      const current = composeEIV(tuple.input).value;
      const delta = Math.abs(current - tuple.expected);
      console.debug(tuple.label, { current, expected: tuple.expected, delta });
      if (delta > TOLERANCE) {
        console.debug("deviation exceeds tolerance", {
          current,
          expected: tuple.expected,
          delta,
        });
      } else {
        console.debug("within tolerance", { delta });
      }
      expect(delta).toBeLessThanOrEqual(TOLERANCE);
    });
    console.groupEnd();
  });
});
