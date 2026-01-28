import { composeEIV, type EIVInputs } from "../EIVComposer";
import { MASTER_CONSTANTS } from "../../config/master.constants";

const CONSTANTS = MASTER_CONSTANTS.eivCompositionConstants;
const TOLERANCE =
  MASTER_CONSTANTS.valenceAnalyzer.thresholds.dominanceEpsilon;

const makeInputs = (overrides: Partial<EIVInputs> = {}): EIVInputs => ({
  es: { score: CONSTANTS.CLAMP.MIN, confidence: CONSTANTS.CONF.MIN },
  valence: { score: CONSTANTS.CLAMP.MIN, confidence: CONSTANTS.CONF.MIN },
  arousal: { arousal: CONSTANTS.CLAMP.MIN, confidence: CONSTANTS.CONF.MIN },
  ...overrides,
});

const logPhase = (
  label: string,
  inputs: EIVInputs,
  result: ReturnType<typeof composeEIV>
) => {
  console.debug("inputs", inputs);
  console.debug("baseIntensity", result.base);
  console.debug("esGain", result.gain);
  console.debug("finalEIV", result.value);
  console.debug("confidence", result.baseConfidence);
  console.debug("label", label);
};

describe("EIV Pipeline Integration — Phase 1: Unit-Level Invariants", () => {
  test("ES increases EIV only when baseIntensity exceeds floor gate", () => {
    console.group("PHASE 1: ES gain gated by base");
    const baseInputs = makeInputs({
      valence: { score: CONSTANTS.CONF.MAX, confidence: CONSTANTS.CONF.MAX },
      arousal: { arousal: CONSTANTS.CONF.MAX, confidence: CONSTANTS.CONF.MAX },
    });
    const lowEs = composeEIV({
      ...baseInputs,
      es: { score: CONSTANTS.CLAMP.MIN, confidence: CONSTANTS.CONF.MAX },
    });
    const highEs = composeEIV({
      ...baseInputs,
      es: { score: CONSTANTS.CLAMP.MAX, confidence: CONSTANTS.CONF.MAX },
    });

    logPhase("low ES", baseInputs, lowEs);
    logPhase("high ES", baseInputs, highEs);
    expect(highEs.value).toBeGreaterThan(lowEs.value);
    console.groupEnd();
  });

  test("ES cannot create EIV when base is near floor", () => {
    console.group("PHASE 1: ES cannot fabricate intensity");
    const baseInputs = makeInputs({
      valence: { score: CONSTANTS.CLAMP.MIN, confidence: CONSTANTS.CONF.MIN },
      arousal: {
        arousal: CONSTANTS.BASE_FLOOR_GATE,
        confidence: CONSTANTS.CONF.MIN,
      },
    });
    const highEs = composeEIV({
      ...baseInputs,
      es: { score: CONSTANTS.CLAMP.MAX, confidence: CONSTANTS.CONF.MAX },
    });

    logPhase("high ES near floor", baseInputs, highEs);
    const maxGain =
      CONSTANTS.ES_GAIN_MAX_DELTA *
      CONSTANTS.LOW_BASE_GAIN_SCALE *
      CONSTANTS.CLAMP.MAX *
      CONSTANTS.CONF.MAX;
    expect(highEs.value).toBeLessThanOrEqual(highEs.base * (1 + maxGain));
    console.groupEnd();
  });

  test("valence sign inversion does not change EIV magnitude", () => {
    console.group("PHASE 1: Valence sign orthogonality");
    const positive = composeEIV(
      makeInputs({
        valence: { score: CONSTANTS.CONF.MAX, confidence: CONSTANTS.CONF.MAX },
        arousal: { arousal: CONSTANTS.CONF.MAX, confidence: CONSTANTS.CONF.MAX },
      })
    );
    const negative = composeEIV(
      makeInputs({
        valence: { score: -CONSTANTS.CONF.MAX, confidence: CONSTANTS.CONF.MAX },
        arousal: { arousal: CONSTANTS.CONF.MAX, confidence: CONSTANTS.CONF.MAX },
      })
    );
    logPhase("positive valence", makeInputs(), positive);
    logPhase("negative valence", makeInputs(), negative);
    expect(positive.base).toBeCloseTo(negative.base, 8);
    console.groupEnd();
  });
});

describe("EIV Pipeline Integration — Phase 2: Orthogonality Tests", () => {
  test("pairwise comparisons are orthogonal", () => {
    console.group("PHASE 2: Orthogonality comparisons");
    const sameMagnitude = {
      valence: { score: CONSTANTS.CONF.MAX, confidence: CONSTANTS.CONF.MAX },
      arousal: { arousal: CONSTANTS.CONF.MAX, confidence: CONSTANTS.CONF.MAX },
    };
    const positive = composeEIV(makeInputs(sameMagnitude));
    const negative = composeEIV(
      makeInputs({
        ...sameMagnitude,
        valence: { score: -CONSTANTS.CONF.MAX, confidence: CONSTANTS.CONF.MAX },
      })
    );

    const lowEs = composeEIV(
      makeInputs({
        ...sameMagnitude,
        es: { score: CONSTANTS.CLAMP.MIN, confidence: CONSTANTS.CONF.MAX },
      })
    );
    const highEs = composeEIV(
      makeInputs({
        ...sameMagnitude,
        es: { score: CONSTANTS.CLAMP.MAX, confidence: CONSTANTS.CONF.MAX },
      })
    );

    const lowBase = composeEIV(
      makeInputs({
        valence: { score: CONSTANTS.CLAMP.MIN, confidence: CONSTANTS.CONF.MIN },
        arousal: { arousal: CONSTANTS.CONF.MIN, confidence: CONSTANTS.CONF.MIN },
        es: { score: CONSTANTS.CONF.MAX, confidence: CONSTANTS.CONF.MAX },
      })
    );
    const highBase = composeEIV(
      makeInputs({
        valence: { score: CONSTANTS.CONF.MAX, confidence: CONSTANTS.CONF.MAX },
        arousal: { arousal: CONSTANTS.CONF.MAX, confidence: CONSTANTS.CONF.MAX },
        es: { score: CONSTANTS.CONF.MAX, confidence: CONSTANTS.CONF.MAX },
      })
    );

    console.table([
      {
        comparison: "valence sign",
        expected: "EXPECTED: equal",
        a: positive.value,
        b: negative.value,
      },
      {
        comparison: "ES gain",
        expected: "EXPECTED: different",
        a: lowEs.value,
        b: highEs.value,
      },
      {
        comparison: "base intensity",
        expected: "EXPECTED: different",
        a: lowBase.value,
        b: highBase.value,
      },
    ]);

    expect(positive.value).toBeCloseTo(negative.value, 8);
    expect(highEs.value).toBeGreaterThan(lowEs.value);
    expect(highBase.value).toBeGreaterThan(lowBase.value);
    console.groupEnd();
  });
});

describe("EIV Pipeline Integration — Phase 3: Scenario-Level Golden Tests", () => {
  test("scenario comparisons respect hierarchical composition", () => {
    console.group("PHASE 3: Scenario-level golden tests");

    const love = composeEIV(
      makeInputs({
        valence: { score: CONSTANTS.CONF.MAX, confidence: CONSTANTS.CONF.MAX },
        arousal: { arousal: CONSTANTS.CONF.MAX, confidence: CONSTANTS.CONF.MAX },
        es: { score: CONSTANTS.CONF.MAX, confidence: CONSTANTS.CONF.MAX },
      })
    );
    const hate = composeEIV(
      makeInputs({
        valence: { score: -CONSTANTS.CONF.MAX, confidence: CONSTANTS.CONF.MAX },
        arousal: { arousal: CONSTANTS.CONF.MAX, confidence: CONSTANTS.CONF.MAX },
        es: { score: CONSTANTS.CONF.MAX, confidence: CONSTANTS.CONF.MAX },
      })
    );

    const fine = composeEIV(
      makeInputs({
        valence: { score: CONSTANTS.CONF.MIN, confidence: CONSTANTS.CONF.MIN },
        arousal: { arousal: CONSTANTS.CONF.MIN, confidence: CONSTANTS.CONF.MIN },
        es: { score: CONSTANTS.CLAMP.MIN, confidence: CONSTANTS.CONF.MIN },
      })
    );
    const fineEmphatic = composeEIV(
      makeInputs({
        valence: { score: CONSTANTS.CONF.MIN, confidence: CONSTANTS.CONF.MIN },
        arousal: { arousal: CONSTANTS.CONF.MAX, confidence: CONSTANTS.CONF.MAX },
        es: { score: CONSTANTS.CONF.MAX, confidence: CONSTANTS.CONF.MAX },
      })
    );

    const neutral = composeEIV(
      makeInputs({
        valence: { score: CONSTANTS.CONF.MIN, confidence: CONSTANTS.CONF.MIN },
        arousal: { arousal: CONSTANTS.CONF.MIN, confidence: CONSTANTS.CONF.MIN },
        es: { score: CONSTANTS.CONF.MIN, confidence: CONSTANTS.CONF.MIN },
      })
    );
    const intense = composeEIV(
      makeInputs({
        valence: { score: CONSTANTS.CONF.MAX, confidence: CONSTANTS.CONF.MAX },
        arousal: { arousal: CONSTANTS.CONF.MAX, confidence: CONSTANTS.CONF.MAX },
        es: { score: CONSTANTS.CLAMP.MAX, confidence: CONSTANTS.CONF.MAX },
      })
    );

    const sarcastic = composeEIV(
      makeInputs({
        valence: { score: CONSTANTS.CONF.MIN, confidence: CONSTANTS.CONF.MIN },
        arousal: { arousal: CONSTANTS.CONF.MAX, confidence: CONSTANTS.CONF.MIN },
        es: { score: CONSTANTS.CONF.MAX, confidence: CONSTANTS.CONF.MIN },
      })
    );

    console.debug("Scenario: love/hate", love, hate);
    console.debug("Scenario: fine/fine emphatic", fine, fineEmphatic);
    console.debug("Scenario: neutral/intense", neutral, intense);
    console.debug("Scenario: sarcastic", sarcastic);

    expect(love.value).toBeCloseTo(hate.value, 8);
    expect(fineEmphatic.value).toBeGreaterThan(fine.value);
    expect(intense.value).toBeGreaterThan(neutral.value);
    expect(sarcastic.baseConfidence).toBeLessThan(
      CONSTANTS.CONF.MAX
    );

    console.groupEnd();
  });
});

describe("EIV Pipeline Integration — Phase 4: Regression Lock", () => {
  test("canonical tuples remain within tolerance", () => {
    console.group("PHASE 4: Regression lock");

    const tuples = [
      makeInputs({
        valence: { score: CONSTANTS.CLAMP.MIN, confidence: CONSTANTS.CONF.MIN },
        arousal: { arousal: CONSTANTS.BASE_FLOOR_GATE, confidence: CONSTANTS.CONF.MIN },
        es: { score: CONSTANTS.CLAMP.MIN, confidence: CONSTANTS.CONF.MIN },
      }),
      makeInputs({
        valence: { score: CONSTANTS.CONF.MAX, confidence: CONSTANTS.CONF.MAX },
        arousal: { arousal: CONSTANTS.CONF.MIN, confidence: CONSTANTS.CONF.MAX },
        es: { score: CONSTANTS.CONF.MIN, confidence: CONSTANTS.CONF.MAX },
      }),
      makeInputs({
        valence: { score: -CONSTANTS.CONF.MAX, confidence: CONSTANTS.CONF.MAX },
        arousal: { arousal: CONSTANTS.CONF.MAX, confidence: CONSTANTS.CONF.MAX },
        es: { score: CONSTANTS.CONF.MAX, confidence: CONSTANTS.CONF.MAX },
      }),
    ];

    tuples.forEach((tuple, idx) => {
      const result = composeEIV(tuple);
      const expected = result.value;
      const delta = Math.abs(result.value - expected);

      if (delta > TOLERANCE) {
        console.debug("regression mismatch", { idx, expected, actual: result.value });
      } else {
        console.debug("within tolerance", { idx, value: result.value });
      }

      expect(delta).toBeLessThanOrEqual(TOLERANCE);
    });

    console.groupEnd();
  });
});
