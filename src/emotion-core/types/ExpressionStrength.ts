export interface ExpressionStrengthFeatures {
  capsRatio: number;        // 0–1
  exclamationCount: number;
  questionCount: number;
  hasMixedPunctuation: boolean;
  emojiCount: number;
  expressiveLengtheningCount: number;
  intensifierCount: number;
  interjectionCount: number;
  messageCharLength: number;
  hasText: boolean;
}

export interface ExpressionStrengthResult {
  es: number;               // 0–1
  breakdown: Record<string, number>;
}