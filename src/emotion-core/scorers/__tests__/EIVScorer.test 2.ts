import { EIVScorer } from "../EIVScorer";
import { composeEIV, type EIVInputs } from "../EIVComposer";
import { EIVComponents } from "../../types/eiv.types";

describe("EIVScorer — EIV composition delegation", () => {
  test("EIVScorer returns composed value", () => {
    const inputs: EIVInputs = {
      es: { score: 0.7, confidence: 0.8 },
      valence: { score: -0.4, confidence: 0.7 },
      arousal: { score: 0.6, confidence: 0.7 },
    };
    const components: EIVComponents = {
      expressionStrength: { ...inputs.es },
      valence: { ...inputs.valence },
      arousal: { ...inputs.arousal },
    };

    const expected = composeEIV(inputs).value;
    const result = EIVScorer.calculate(components).value;

    expect(result).toBeCloseTo(expected, 8);
  });
});
