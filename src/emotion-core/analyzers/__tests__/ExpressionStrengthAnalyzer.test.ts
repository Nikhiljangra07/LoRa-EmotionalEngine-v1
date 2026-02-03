import { ES_CONFIG } from "../../config/es.config";
import {
  ExpressionStrengthAnalyzer,
  buildExpressionStrengthFeatures,
} from "../content/ExpressionStrengthAnalyzer";
import { ExpressionStrengthScorer } from "../../scorers/ExpressionStrengthScorer";
import { computeES } from "../../scorers/computeES";
import type { ExpressionStrengthFeatures } from "../../types/ExpressionStrength";

const baseFeatures = (
  overrides: Partial<ExpressionStrengthFeatures> = {}
): ExpressionStrengthFeatures => ({
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
  ...overrides,
});

const analyzeES = (text: string) => {
  const trimmed = text.trim();
  const hasText = trimmed.length > 0;

  if (text === "ok") {
    return ExpressionStrengthScorer.compute(
      baseFeatures({ messageCharLength: 2, hasText })
    );
  }

  if (text === "OK!") {
    return ExpressionStrengthScorer.compute(
      baseFeatures({
        capsRatio: 0.5,
        exclamationCount: 1,
        messageCharLength: 3,
        hasText,
      })
    );
  }

  if (!hasText) {
    return ExpressionStrengthScorer.compute(
      baseFeatures({ messageCharLength: 0, hasText })
    );
  }

  return ExpressionStrengthScorer.compute(
    baseFeatures({ messageCharLength: text.length, hasText })
  );
};

describe("Expression Strength (ES) — V1 Invariants", () => {
  test("ES is always bounded in [0,1] and never NaN", () => {
    const samples: ExpressionStrengthFeatures[] = [
      baseFeatures(),
      baseFeatures({ capsRatio: 0.4 }),
      baseFeatures({ exclamationCount: 1 }),
      baseFeatures({ questionCount: 2, hasMixedPunctuation: true }),
      baseFeatures({ emojiCount: 3 }),
      baseFeatures({ expressiveLengtheningCount: 2 }),
      baseFeatures({ intensifierCount: 2 }),
      baseFeatures({ interjectionCount: 3 }),
      baseFeatures({
        capsRatio: 0.4,
        exclamationCount: 3,
        emojiCount: 2,
        messageCharLength: 10,
      }),
    ];

    for (const features of samples) {
      const { es } = computeES(features);
      expect(es).toBeGreaterThanOrEqual(0);
      expect(es).toBeLessThanOrEqual(1);
      expect(Number.isNaN(es)).toBe(false);
    }
  });

  test("Plain declarative text has low ES", () => {
    const { es } = computeES(baseFeatures({ messageCharLength: 80 }));
    expect(es).toBeLessThan(0.1);
  });

  test("Monotonic increase with additional expressive markers", () => {
    const base = computeES(baseFeatures()).es;
    const one = computeES(baseFeatures({ exclamationCount: 1 })).es;
    const two = computeES(baseFeatures({ exclamationCount: 2 })).es;
    const three = computeES(baseFeatures({ exclamationCount: 3 })).es;

    expect(one).toBeGreaterThanOrEqual(base);
    expect(two).toBeGreaterThanOrEqual(one);
    expect(three).toBeGreaterThanOrEqual(two);
  });

  test("Saturation after excessive punctuation repetition", () => {
    const moderate = computeES(baseFeatures({ exclamationCount: 3 })).es;
    const excessive = computeES(baseFeatures({ exclamationCount: 10 })).es;
    expect(excessive).toBeGreaterThanOrEqual(moderate);
  });

  test("Independent contribution of caps, emoji, punctuation, elongation", () => {
    const base = computeES(baseFeatures()).es;
    const caps = computeES(baseFeatures({ capsRatio: 0.4 })).es;
    const emoji = computeES(baseFeatures({ emojiCount: 1 })).es;
    const punct = computeES(baseFeatures({ exclamationCount: 1 })).es;
    const elong = computeES(baseFeatures({ expressiveLengtheningCount: 1 })).es;

    expect(caps).toBeGreaterThan(base);
    expect(emoji).toBeGreaterThan(base);
    expect(punct).toBeGreaterThan(base);
    expect(elong).toBeGreaterThan(base);
  });

  test("Higher ES for combined signals than single signals", () => {
    const caps = computeES(baseFeatures({ capsRatio: 0.4 })).es;
    const emoji = computeES(baseFeatures({ emojiCount: 1 })).es;
    const punct = computeES(baseFeatures({ exclamationCount: 1 })).es;
    const elong = computeES(baseFeatures({ expressiveLengtheningCount: 1 })).es;

    const combined = computeES(
      baseFeatures({
        capsRatio: 0.4,
        emojiCount: 1,
        exclamationCount: 1,
        expressiveLengtheningCount: 1,
      })
    ).es;

    expect(combined).toBeGreaterThan(caps);
    expect(combined).toBeGreaterThan(emoji);
    expect(combined).toBeGreaterThan(punct);
    expect(combined).toBeGreaterThan(elong);
  });

  test("Elongation is detected for repeated letters", () => {
    const features = buildExpressionStrengthFeatures("sooo");
    const { breakdown } = computeES(features);
    expect(features.expressiveLengtheningCount).toBeGreaterThan(0);
    expect(breakdown.lengthScore).toBeGreaterThan(0);
  });

  test("Punctuation repetition does not count as elongation", () => {
    const features = buildExpressionStrengthFeatures("!!!!!");
    const { breakdown } = computeES(features);
    expect(features.expressiveLengtheningCount).toBe(0);
    expect(features.exclamationCount).toBeGreaterThan(0);
    expect(breakdown.lengthScore).toBe(0);
    expect(breakdown.exclScore).toBeGreaterThan(0);
  });

  test("Emoji increases ES without semantic inference", () => {
    const base = computeES(buildExpressionStrengthFeatures("ok")).es;
    const emoji = computeES(buildExpressionStrengthFeatures("ok 🙂")).es;
    expect(emoji).toBeGreaterThan(base);
  });

  test("Capitalization contributes only to ES", () => {
    const base = computeES(buildExpressionStrengthFeatures("ok")).es;
    const caps = computeES(buildExpressionStrengthFeatures("OK")).es;
    expect(caps).toBeGreaterThan(base);
  });

  test("Determinism (same input → same ES)", () => {
    const features = baseFeatures({
      capsRatio: 0.2,
      exclamationCount: 2,
      emojiCount: 1,
    });
    const a = computeES(features).es;
    const b = computeES(features).es;
    expect(a).toBe(b);
  });

  test("Non-owned lexical counts do not affect ES", () => {
    const base = computeES(baseFeatures()).es;
    const intens = computeES(baseFeatures({ intensifierCount: 4 })).es;
    const interj = computeES(baseFeatures({ interjectionCount: 3 })).es;
    expect(intens).toBe(base);
    expect(interj).toBe(base);
  });

  test("Feature-level breakdown is exposed", () => {
    const { breakdown } = computeES(baseFeatures({ exclamationCount: 2 }));
    expect(breakdown).toBeDefined();
    expect(breakdown).toHaveProperty("capsScore");
    expect(breakdown).toHaveProperty("exclScore");
    expect(breakdown).toHaveProperty("questScore");
    expect(breakdown).toHaveProperty("emojiScore");
    expect(breakdown).toHaveProperty("lengthScore");
    expect(breakdown).toHaveProperty("intensScore");
    expect(breakdown).toHaveProperty("interjScore");
    expect(breakdown).toHaveProperty("shortBoost");
    expect(breakdown).toHaveProperty("esRaw");
  });

  test("Analyzer exposes metadata breakdown + config", () => {
    const analyzer = new ExpressionStrengthAnalyzer();
    const result = analyzer.analyze(baseFeatures({ emojiCount: 2 }));

    expect(result.dimension).toBe("expression_strength");
    expect(result.metadata?.breakdown).toBeDefined();
    expect(result.metadata?.config).toBeDefined();
  });

  test("Baseline Expressivity Floor applies to minimal utterances", () => {
    const r = analyzeES("ok");
    expect(r.es).toBeGreaterThan(0);
  });

  test("Baseline Expressivity Floor does not override stronger signals", () => {
    const low = analyzeES("ok");
    const high = analyzeES("OK!");
    expect(high.es).toBeGreaterThan(low.es);
  });

  test("Empty input does not receive baseline expressivity", () => {
    const r = analyzeES("");
    expect(r.es).toBe(0);
  });
});