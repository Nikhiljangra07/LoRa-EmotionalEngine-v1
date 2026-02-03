import { AmbiguityAnalyzer } from "../AmbiguityAnalyzer";
import { MASTER_CONSTANTS } from "../../../config/master.constants";

const CONSTANTS = MASTER_CONSTANTS.ambiguityAnalyzer;

describe("AmbiguityAnalyzer V1 signals", () => {
  let analyzer: AmbiguityAnalyzer;

  const expectWithinBounds = (score: number) => {
    expect(score).toBeGreaterThanOrEqual(CONSTANTS.bounds.min);
    expect(score).toBeLessThanOrEqual(CONSTANTS.bounds.max);
  };

  const expectAboveBaseline = (score: number) => {
    expect(score).toBeGreaterThan(CONSTANTS.baseline.score);
  };

  beforeEach(() => {
    analyzer = new AmbiguityAnalyzer();
  });

  describe("Hedging & Modal Ambiguity", () => {
    const inputs = [
      "maybe this works",
      "might be true",
      "I guess this is fine",
      "I think it could help",
      "sort of unclear",
      "perhaps it would fit",
    ];

    for (const input of inputs) {
      it("should increase ambiguity from epistemic markers", () => {
        const result = analyzer.analyze(input);
        expectAboveBaseline(result.ambiguityScore);
        expectWithinBounds(result.ambiguityScore);
        expect(result.ambiguitySources).toContain("semantic");
      });
    }
  });

  describe("Direct Polarity Contradiction", () => {
    const inputs = [
      "I love this but I hate the ending",
      "It is good but also terrible",
      "I like it yet it is awful",
      "This is amazing, though I am sad",
      "Wonderful design, but a bad finish",
      "Great idea with a horrible result",
    ];

    for (const input of inputs) {
      it("should detect polarity contradiction", () => {
        const result = analyzer.analyze(input);
        expect(result.contradictionDetected).toBe(true);
        expectAboveBaseline(result.ambiguityScore);
        expectWithinBounds(result.ambiguityScore);
        expect(result.ambiguitySources).toContain("structural");
      });
    }
  });

  describe("Discourse Reversal Markers", () => {
    const inputs = [
      "I like it but the pacing drags",
      "The idea works, however the flow breaks",
      "It reads well though the format shifts",
      "The plan holds yet the details blur",
    ];

    for (const input of inputs) {
      it("should increase ambiguity for contrast markers", () => {
        const result = analyzer.analyze(input);
        expectAboveBaseline(result.ambiguityScore);
        expectWithinBounds(result.ambiguityScore);
        expect(result.ambiguitySources).toContain("structural");
      });
    }
  });

  describe("Passive Voice / Agency Obscurity", () => {
    const inputs = ["I was hurt", "Mistakes were made", "The report was written"];

    for (const input of inputs) {
      it("should flag passive constructions", () => {
        const result = analyzer.analyze(input);
        expectAboveBaseline(result.ambiguityScore);
        expectWithinBounds(result.ambiguityScore);
        expect(result.ambiguitySources).toContain("narrative");
      });
    }

    it("should detect irregular participles like 'hurt'", () => {
      const result = analyzer.analyze("I was hurt");
      expectAboveBaseline(result.ambiguityScore);
      expectWithinBounds(result.ambiguityScore);
      expect(result.ambiguitySources).toContain("narrative");
      // If "hurt" were removed from config, this would not trigger passive.
    });
  });

  describe("Rhetorical Question Patterns", () => {
    const inputs = ["You really think that?", "Seriously?", "Right?"];

    for (const input of inputs) {
      it("should detect rhetorical markers with question mark", () => {
        const result = analyzer.analyze(input);
        expectAboveBaseline(result.ambiguityScore);
        expectWithinBounds(result.ambiguityScore);
        expect(result.ambiguitySources).toContain("pragmatic");
      });
    }
  });

  describe("Minimal Sarcasm Flag", () => {
    const inputs = [
      "You really think this is good but it is awful?",
      "Seriously, I love it and hate it?",
    ];

    for (const input of inputs) {
      it("should flag tonal inversion pattern only", () => {
        const result = analyzer.analyze(input);
        expect(typeof result.tonalInversionPatternDetected).toBe("boolean");
        expect(result.tonalInversionPatternDetected).toBe(true);
      });
    }
  });

  describe("Weak Affect Masking", () => {
    const inputs = ["That was awful. I'm good.", "It was horrible. I feel nice."];

    for (const input of inputs) {
      it("should detect contradiction with weak follow-up", () => {
        const result = analyzer.analyze(input);
        expectAboveBaseline(result.ambiguityScore);
        expectWithinBounds(result.ambiguityScore);
        expect(result.contradictionDetected).toBe(true);
      });
    }
  });
});
