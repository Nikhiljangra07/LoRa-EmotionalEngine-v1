import { EIVScorer } from "../EIVScorer";
import { EIVComponents } from "../../types/eiv.types";

const baseComponents: EIVComponents = {
  linguistic: 0.2,
  punctuation: 0.2,
  capitalization: 0.2,
  emoji: 0.2,
};

const computeEIV = ({ text, es }: { text: string; es: number }) => {
  void text;
  return EIVScorer.calculate(baseComponents, es).value;
};

describe("EIVScorer — ES modulation", () => {
  test("ES increases EIV monotonically", () => {
    const low = computeEIV({ text: "ok", es: 0.1 });
    const high = computeEIV({ text: "OK!!!", es: 0.6 });
    expect(high).toBeGreaterThan(low);
  });

  test("ES does not flip EIV sign", () => {
    const eiv = computeEIV({ text: "sad", es: 0.8 });
    expect(eiv).toBeGreaterThanOrEqual(0);
  });

  test("EIV remains bounded after ES modulation", () => {
    const eiv = computeEIV({ text: "EXTREME!!!", es: 1 });
    expect(eiv).toBeLessThanOrEqual(1);
  });
});
