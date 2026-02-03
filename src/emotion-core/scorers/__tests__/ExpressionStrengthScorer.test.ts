import { ExpressionStrengthScorer } from "../ExpressionStrengthScorer";
import { buildExpressionStrengthFeatures } from "../../analyzers/content/ExpressionStrengthAnalyzer";

describe("ExpressionStrengthScorer", () => {
  it("produces higher ES for expressive messages", () => {
    const expressive = ExpressionStrengthScorer.compute(
      buildExpressionStrengthFeatures("SOOO GOOD!!! 🙂🙂")
    );

    const flat = ExpressionStrengthScorer.compute(
      buildExpressionStrengthFeatures("ok")
    );

    expect(expressive.es).toBeGreaterThan(flat.es);
  });
});