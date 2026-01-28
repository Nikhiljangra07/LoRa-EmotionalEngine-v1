import { EIVScorer } from "../EIVScorer";
import { composeEIV, type EIVInputs } from "../EIVComposer";
import { EIVComponents } from "../../types/eiv.types";

describe("EIVScorer — EIV composition delegation", () => {
  test("EIVScorer returns composed value", () => {
    const inputs: EIVInputs = {
      es: { score: 0.7, confidence: 0.8 },
      valence: { score: -0.4, confidence: 0.7 },
      arousal: { arousal: 0.6, confidence: 0.7 },
    };

    const expected = composeEIV(inputs).value;
    const result = EIVScorer.calculate(
      inputs as unknown as EIVComponents
    ).value;

    expect(result).toBeCloseTo(expected, 8);
  });
});
