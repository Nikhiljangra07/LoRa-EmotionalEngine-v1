import { ValenceAnalyzer } from "../../content/ValenceAnalyzer";
import {
  MASTER_CONSTANTS,
  VALENCE_AMBIGUITY_CONSTRAINTS,
} from "../../../config/master.constants";

const MIN_MAGNITUDE = MASTER_CONSTANTS.valenceAnalyzer.thresholds.minMagnitude;
const MIN_SCORE = MASTER_CONSTANTS.valenceAnalyzer.normalization.minScore;
const MAX_SCORE = MASTER_CONSTANTS.valenceAnalyzer.normalization.maxScore;
const LOW_EVIDENCE_MULTIPLIER =
  MASTER_CONSTANTS.valenceAnalyzer.confidence.lowEvidenceMultiplier;
const MIN_AFFECTIVE_TOKENS =
  MASTER_CONSTANTS.valenceAnalyzer.confidence.minAffectiveTokens;

const {
  NEGATIVE_MIN_CONF,
  NEGATIVE_MAX_CONF,
  NEUTRAL_MIN_CONF,
  NEUTRAL_MAX_CONF,
  OVERCONFIDENT_MAX,
} = VALENCE_AMBIGUITY_CONSTRAINTS;

const ZERO = MIN_SCORE + MAX_SCORE;

const analyzer = new ValenceAnalyzer();

const analyze = (text: string) => analyzer.analyze(text);

describe("ValenceAnalyzer — Neutral as a distinct state", () => {
  test("neutral informational statement remains neutral with zero score", () => {
    const result = analyze("The meeting is tomorrow at 2 PM");
    expect(result.valence).toBe("NEUTRAL");
    expect(result.score).toBe(ZERO);
    expect(result.confidence).toBeLessThanOrEqual(LOW_EVIDENCE_MULTIPLIER);
    expect(result.evidence.neutralTriggers).toContain("no_affective_tokens");
  });

  test("empty input is neutral with zero confidence", () => {
    const result = analyze("");
    expect(result.valence).toBe("NEUTRAL");
    expect(result.confidence).toBe(ZERO);
    expect(result.evidence.neutralTriggers).toContain("empty_input");
  });
});

describe("ValenceAnalyzer — Balanced positive/negative signals", () => {
  test("mixed affect collapses to neutral", () => {
    const result = analyze("I am happy but also bad");
    expect(result.valence).toBe("NEUTRAL");
    expect(Math.abs(result.score)).toBeLessThan(MIN_MAGNITUDE);
  });

  test("balanced signal reports balanced trigger", () => {
    const result = analyze("good product but terrible service");
    expect(result.valence).toBe("NEUTRAL");
    expect(result.evidence.neutralTriggers).toContain("balanced_signal");
  });
});

describe("ValenceAnalyzer — Semantic dominance over surface form", () => {
  test("punctuation does not change valence direction", () => {
    const plain = analyze("This is good");
    const punct = analyze("This is good!!!");
    expect(plain.valence).toBe("POSITIVE");
    expect(punct.valence).toBe("POSITIVE");
    expect(Math.abs(plain.score - punct.score)).toBeLessThan(MIN_MAGNITUDE);
  });

  test("positive vs negative meaning diverges strongly", () => {
    const positive = analyze("This is good!!!");
    const negative = analyze("This is bad.");
    expect(positive.score).toBeGreaterThan(ZERO);
    expect(negative.score).toBeLessThan(ZERO);
    expect(Math.abs(positive.score - negative.score)).toBeGreaterThan(
      MIN_MAGNITUDE
    );
  });
});

describe("ValenceAnalyzer — Negation scope with attenuation", () => {
  test("negation does not flip polarity in isolation", () => {
    const result = analyze("not good");
    expect(result.valence).toBe("POSITIVE");
    expect(result.score).toBeGreaterThan(ZERO);
  });

  test("negation attenuates mixed affect", () => {
    const result = analyze("not good bad");

    expect(result.valence).not.toBe("POSITIVE");
    expect(result.confidence).toBeLessThanOrEqual(OVERCONFIDENT_MAX);

    if (result.valence === "NEGATIVE") {
      expect(result.confidence).toBeGreaterThanOrEqual(NEGATIVE_MIN_CONF);
      expect(result.confidence).toBeLessThanOrEqual(NEGATIVE_MAX_CONF);
      return;
    }

    if (result.valence === "NEUTRAL") {
      expect(result.confidence).toBeGreaterThanOrEqual(NEUTRAL_MIN_CONF);
      expect(result.confidence).toBeLessThanOrEqual(NEUTRAL_MAX_CONF);
      const hasAmbiguityTrigger =
        result.evidence.neutralTriggers.includes("balanced_signal") ||
        result.evidence.neutralTriggers.includes("low_evidence");
      expect(hasAmbiguityTrigger).toBe(true);
      return;
    }

    expect(["NEGATIVE", "NEUTRAL"]).toContain(result.valence);
  });

  test("double negation with neutral token stays neutral", () => {
    const result = analyze("not unlike");
    expect(result.valence).toBe("NEUTRAL");
    expect(result.score).toBe(ZERO);
  });
});

describe("ValenceAnalyzer — Confidence decay under ambiguity", () => {
  test("low-evidence neutral has lower confidence than clear affect", () => {
    const neutral = analyze("okay...");
    const clear = analyze("good");
    expect(neutral.valence).toBe("NEUTRAL");
    expect(clear.valence).toBe("POSITIVE");
    expect(neutral.confidence).toBeLessThan(clear.confidence);
  });

  test("single-token neutral remains low confidence", () => {
    const result = analyze("fine");
    expect(result.valence).toBe("NEUTRAL");
    expect(result.confidence).toBeLessThanOrEqual(LOW_EVIDENCE_MULTIPLIER);
  });
});

describe("ValenceAnalyzer — Non-affective robustness", () => {
  test("numeric/system text remains neutral", () => {
    const result = analyze("The file size is 5 MB");
    expect(result.valence).toBe("NEUTRAL");
    expect(result.score).toBe(ZERO);
  });

  test("unknown tokens do not crash and stay neutral", () => {
    const result = analyze("The quorvex protocol completed");
    expect(result.valence).toBe("NEUTRAL");
  });

  test("neutral token remains neutral without context", () => {
    const result = analyze("apple");
    expect(result.valence).toBe("NEUTRAL");
  });
});

describe("ValenceAnalyzer — Numerical stability & boundedness", () => {
  test("long neutral document stays bounded and neutral", () => {
    const longNeutral = new Array(1000).fill("quorvex").join(" ");
    const result = analyze(longNeutral);
    expect(result.valence).toBe("NEUTRAL");
    expect(result.score).toBeGreaterThanOrEqual(MIN_SCORE);
    expect(result.score).toBeLessThanOrEqual(MAX_SCORE);
  });

  test("long document with one positive paragraph stays bounded", () => {
    const neutralBlock = new Array(990).fill("quorvex").join(" ");
    const positiveBlock = new Array(MIN_AFFECTIVE_TOKENS).fill("good").join(" ");
    const result = analyze(`${neutralBlock} ${positiveBlock}`);
    expect(result.score).toBeGreaterThanOrEqual(MIN_SCORE);
    expect(result.score).toBeLessThanOrEqual(MAX_SCORE);
  });
});
