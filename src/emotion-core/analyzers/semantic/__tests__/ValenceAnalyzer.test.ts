import { ValenceAnalyzer } from "../../content/ValenceAnalyzer";
import { MASTER_CONSTANTS } from "../../../config/master.constants";

const VALENCE = MASTER_CONSTANTS.valenceAnalyzer;
const ZERO = VALENCE.bounds.zero;
const ONE = VALENCE.bounds.one;
const MIN_SCORE = VALENCE.normalization.minScore;
const MAX_SCORE = VALENCE.normalization.maxScore;

const analyzer = new ValenceAnalyzer();

const analyze = (text: string) => analyzer.analyze(text);

describe("ValenceAnalyzer — polarity-only signals", () => {
  test("positive polarity produces positive valence", () => {
    const result = analyze("good");
    expect(result.valence).toBe("POSITIVE");
    expect(result.score).toBeGreaterThan(ZERO);
  });

  test("negative polarity produces negative valence", () => {
    const result = analyze("bad");
    expect(result.valence).toBe("NEGATIVE");
    expect(result.score).toBeLessThan(ZERO);
  });
});

describe("ValenceAnalyzer — negation scope", () => {
  test("negation flips polarity within scope", () => {
    const result = analyze("not good");
    expect(result.valence).toBe("NEGATIVE");
    expect(result.score).toBeLessThan(ZERO);
  });

  test("negation flips negative to positive", () => {
    const result = analyze("not bad");
    expect(result.valence).toBe("POSITIVE");
    expect(result.score).toBeGreaterThan(ZERO);
  });
});

describe("ValenceAnalyzer — contrastive conjunctions", () => {
  test("contrast markers rebalance polarity", () => {
    const result = analyze("good but bad");
    expect(result.valence).toBe("NEGATIVE");
    expect(result.score).toBeLessThan(ZERO);
  });
});

describe("ValenceAnalyzer — forbidden behavior", () => {
  test("emotion-labeled words do not affect output", () => {
    const result = analyze("anger");
    expect(result.valence).toBe("NEUTRAL");
    expect(result.score).toBe(ZERO);
  });

  test("ES-style signals do not affect valence", () => {
    const plain = analyze("good");
    const expressive = analyze("GOOD!!!");
    expect(expressive.valence).toBe("POSITIVE");
    expect(expressive.score).toBe(plain.score);
  });

  test("no intensity scaling for repeated polarity tokens", () => {
    const single = analyze("good");
    const repeated = analyze("good good");
    expect(repeated.score).toBe(single.score);
  });
});

describe("ValenceAnalyzer — determinism and audit safety", () => {
  test("same input produces identical output", () => {
    const a = analyze("good but bad");
    const b = analyze("good but bad");
    expect(a.score).toBe(b.score);
    expect(a.valence).toBe(b.valence);
  });

  test("emotion-labeled lexicon injection fails fast", () => {
    const positive =
      VALENCE.lexicon.polarity.positive as unknown as string[];
    const original = [...positive];
    try {
      positive.push("anger");
      expect(() => analyze("anger")).toThrow();
    } finally {
      positive.length = ZERO;
      positive.push(...original);
    }
  });
});

describe("ValenceAnalyzer — bounds", () => {
  test("scores remain bounded", () => {
    const result = analyze("good bad good bad");
    expect(result.score).toBeGreaterThanOrEqual(MIN_SCORE);
    expect(result.score).toBeLessThanOrEqual(MAX_SCORE);
    expect(result.confidence).toBeGreaterThanOrEqual(ZERO);
    expect(result.confidence).toBeLessThanOrEqual(ONE);
  });
});
