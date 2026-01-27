import { ExpressionStrengthScorer } from "../scorers/ExpressionStrengthScorer";
import { ExpressionStrengthFeatures } from "../types/ExpressionStrength";

const features: ExpressionStrengthFeatures = {
  capsRatio: 0.4,
  exclamationCount: 3,
  questionCount: 0,
  hasMixedPunctuation: false,
  emojiCount: 2,
  expressiveLengtheningCount: 1,
  intensifierCount: 1,
  interjectionCount: 0,
  messageCharLength: 42,
};

const result = ExpressionStrengthScorer.compute(features);

console.log("ES RESULT:", result);