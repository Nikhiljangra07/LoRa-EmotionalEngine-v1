import { ExpressionStrengthScorer } from "../ExpressionStrengthScorer";

describe("ExpressionStrengthScorer", () => {
  it("produces higher ES for expressive messages", () => {
    const expressive = ExpressionStrengthScorer.compute({
      capsRatio: 0.5,
      exclamationCount: 3,
      questionCount: 1,
      hasMixedPunctuation: true,
      emojiCount: 3,
      expressiveLengtheningCount: 2,
      intensifierCount: 1,
      interjectionCount: 1,
      messageCharLength: 35,
      hasText: true,
    });

    const flat = ExpressionStrengthScorer.compute({
      capsRatio: 0,
      exclamationCount: 0,
      questionCount: 0,
      hasMixedPunctuation: false,
      emojiCount: 0,
      expressiveLengtheningCount: 0,
      intensifierCount: 0,
      interjectionCount: 0,
      messageCharLength: 40,
      hasText: true,
    });

    expect(expressive.es).toBeGreaterThan(flat.es);
  });
});