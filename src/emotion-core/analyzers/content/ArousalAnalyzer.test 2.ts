import { ArousalAnalyzer } from "./ArousalAnalyzer";
import { MASTER_CONSTANTS } from "../../config/master.constants";

const AROUSAL = MASTER_CONSTANTS.arousalCalibrationConstants;
const { zero: ZERO, one: ONE } = AROUSAL.numbers;

const analyzer = new ArousalAnalyzer();

const expectInRange = (value: number, min: number, max: number) => {
  expect(value).toBeGreaterThanOrEqual(min);
  expect(value).toBeLessThanOrEqual(max);
};

const expectNoEmotionalLeakage = (sources: string[]) => {
  const forbidden = [
    "emotion",
    "sentiment",
    "valence",
    "arousal",
    "intensity",
    "affect",
    "pragmatic",
  ];
  const haystack = sources.join("|").toLowerCase();
  forbidden.forEach((token) => {
    expect(haystack).not.toContain(token);
  });
};

describe("ArousalAnalyzer V1 (structural load only)", () => {
  test("sentence length variance raises arousal", () => {
    const result = analyzer.analyze(
      "the the the. the the the the the the the the the the the"
    );
    expect(result.sources).toContain("sentence_length_variance");
    expectInRange(result.arousal, AROUSAL.bounds.min, AROUSAL.bounds.max);
    expectNoEmotionalLeakage(result.sources);
  });

  test("rare word usage raises arousal", () => {
    const result = analyzer.analyze("quorvex quorvex quorvex");
    expect(result.sources).toContain("rare_word_usage");
    expectInRange(result.arousal, AROUSAL.bounds.min, AROUSAL.bounds.max);
  });

  test("question density uses interrogative structures only", () => {
    const result = analyzer.analyze("What is this");
    expect(result.sources).toContain("question_density");
  });

  test("imperative presence is detected structurally", () => {
    const result = analyzer.analyze("Do this now");
    expect(result.sources).toContain("imperative_presence");
  });

  test("clause stacking raises arousal", () => {
    const result = analyzer.analyze("this and that and those");
    expect(result.sources).toContain("clause_stacking");
  });

  test("punctuation does not change arousal", () => {
    const base = analyzer.analyze("do this");
    const punct = analyzer.analyze("do this!!!");
    expect(punct.arousal).toBe(base.arousal);
  });

  test("determinism (same input → same output)", () => {
    const a = analyzer.analyze("do this now");
    const b = analyzer.analyze("do this now");
    expect(a.arousal).toBe(b.arousal);
    expect(a.confidence).toBe(b.confidence);
  });

  test("confidence stays within bounds", () => {
    const result = analyzer.analyze("do this now");
    expectInRange(
      result.confidence,
      AROUSAL.confidence.min,
      AROUSAL.confidence.max
    );
    const maxSignals =
      Object.keys(AROUSAL.weights).length;
    expect(result.sources.length).toBeGreaterThanOrEqual(ZERO);
    expect(result.sources.length).toBeLessThanOrEqual(maxSignals);
  });
});
