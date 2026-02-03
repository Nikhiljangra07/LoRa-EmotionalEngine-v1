import { SentenceBoundaryAnalyzer } from "../SentenceBoundaryAnalyzer";
import { MASTER_CONSTANTS } from "../../config/master.constants";
import type { SentenceBoundaryAnalysis } from "../../types/SentenceBoundary.types";

const CONSTANTS = MASTER_CONSTANTS.sentenceBoundaryAnalyzer;
const { zero: ZERO, one: ONE } = CONSTANTS.numbers;

const forbiddenTokens = [
  "emotion",
  "sentiment",
  "valence",
  "arousal",
  "sarcasm",
  "intensity",
  "affect",
  "trust",
];

const findBoundary = (
  result: SentenceBoundaryAnalysis,
  index: number
) => result.boundaries.find((boundary) => boundary.boundaryIndex === index);

const expectNoEmotionalLeakage = (result: SentenceBoundaryAnalysis) => {
  const haystack = result.boundaries
    .flatMap((boundary) => [
      boundary.boundarySources.join("|"),
      boundary.ambiguityFlags?.join("|") ?? "",
    ])
    .join("|")
    .toLowerCase();

  forbiddenTokens.forEach((token) => {
    expect(haystack).not.toContain(token);
  });
};

const expectBoundarySourcesPresent = (result: SentenceBoundaryAnalysis) => {
  result.boundaries.forEach((boundary) => {
    expect(boundary.boundarySources.length).toBeGreaterThan(ZERO);
    expect(boundary.boundaryConfidence).toBeGreaterThanOrEqual(
      CONSTANTS.bounds.min
    );
    expect(boundary.boundaryConfidence).toBeLessThanOrEqual(
      CONSTANTS.bounds.max
    );
  });
};

describe("SentenceBoundaryAnalyzer (Layer-1)", () => {
  let analyzer: SentenceBoundaryAnalyzer;

  beforeEach(() => {
    analyzer = new SentenceBoundaryAnalyzer();
  });

  describe("Abbreviation handling", () => {
    it("should suppress boundaries for abbreviations", () => {
      const input = "Dr. smith went home.";
      const result = analyzer.analyze(input);
      const firstPeriod = input.indexOf(".");
      const lastPeriod = input.lastIndexOf(".");

      expect(findBoundary(result, firstPeriod)).toBeUndefined();
      expect(findBoundary(result, lastPeriod)).toBeDefined();
      expectBoundarySourcesPresent(result);
      expectNoEmotionalLeakage(result);
    });
  });

  describe("Abbreviation at sentence end", () => {
    it("should allow boundary when abbreviation ends sentence", () => {
      const input = "I met Dr.";
      const periodIndex = input.lastIndexOf(".");
      const result = analyzer.analyze(input);

      expect(findBoundary(result, periodIndex)).toBeDefined();
      expectBoundarySourcesPresent(result);
      expectNoEmotionalLeakage(result);
    });
  });

  describe("Decimal numbers", () => {
    it("should suppress decimal point boundaries", () => {
      const input = "The value is 3.14 and stable.";
      const decimalIndex = input.indexOf("3.14") + "3".length;
      const lastPeriod = input.lastIndexOf(".");
      const result = analyzer.analyze(input);

      expect(findBoundary(result, decimalIndex)).toBeUndefined();
      expect(findBoundary(result, lastPeriod)).toBeDefined();
      expectBoundarySourcesPresent(result);
      expectNoEmotionalLeakage(result);
    });
  });

  describe("URLs and emails", () => {
    it("should suppress boundaries inside emails", () => {
      const input = "Email me at test@example.com. Thanks.";
      const domainDot =
        input.indexOf("example.com") + "example".length;
      const lastPeriod = input.lastIndexOf(".");
      const result = analyzer.analyze(input);

      expect(findBoundary(result, domainDot)).toBeUndefined();
      expect(findBoundary(result, lastPeriod)).toBeDefined();
      expectBoundarySourcesPresent(result);
      expectNoEmotionalLeakage(result);
    });
  });

  describe("Ellipsis and passive punctuation", () => {
    it("should flag ellipsis context when enabled", () => {
      const input = "Wait... What?";
      const ellipsisEnd =
        input.indexOf("...") + "...".length - ONE;
      const result = analyzer.analyze(input);
      const boundary = findBoundary(result, ellipsisEnd);

      if (CONSTANTS.enableChatHeuristics) {
        expect(boundary).toBeDefined();
        expect(boundary?.ambiguityFlags).toContain("ellipsis_context");
        expect(boundary?.boundarySources).toContain("ellipsis_context");
      }
      expectBoundarySourcesPresent(result);
      expectNoEmotionalLeakage(result);
    });
  });

  describe("Newlines vs punctuation", () => {
    it("should detect newline boundaries", () => {
      const input = "first line\nsecond line";
      const newlineIndex = input.indexOf("\n");
      const result = analyzer.analyze(input);
      const boundary = findBoundary(result, newlineIndex);

      expect(boundary).toBeDefined();
      expect(boundary?.boundarySources).toContain("newline");
      expect(boundary?.ambiguityFlags).toContain("newline_soft_boundary");
      expectBoundarySourcesPresent(result);
      expectNoEmotionalLeakage(result);
    });
  });

  describe("Emoji adjacency", () => {
    it("should mark emoji-adjacent boundaries when enabled", () => {
      const input = "Ok 🙂.";
      const periodIndex = input.lastIndexOf(".");
      const result = analyzer.analyze(input);
      const boundary = findBoundary(result, periodIndex);

      expect(boundary).toBeDefined();
      if (CONSTANTS.enableChatHeuristics) {
        expect(boundary?.ambiguityFlags).toContain("emoji_adjacent");
      }
      expectBoundarySourcesPresent(result);
      expectNoEmotionalLeakage(result);
    });
  });

  describe("Chat fragments", () => {
    it("should detect fragment lines when enabled", () => {
      const input = "- yes\n- no";
      const newlineIndex = input.indexOf("\n");
      const result = analyzer.analyze(input);
      const boundary = findBoundary(result, newlineIndex);

      expect(boundary).toBeDefined();
      if (CONSTANTS.enableChatHeuristics) {
        expect(boundary?.boundarySources).toContain("chat_fragment");
      }
      expectBoundarySourcesPresent(result);
      expectNoEmotionalLeakage(result);
    });
  });

  describe("Code-like text", () => {
    it("should annotate code-like context when enabled", () => {
      const input = "const x = 1;\nreturn x.";
      const newlineIndex = input.indexOf("\n");
      const periodIndex = input.lastIndexOf(".");
      const result = analyzer.analyze(input);
      const newlineBoundary = findBoundary(result, newlineIndex);
      const periodBoundary = findBoundary(result, periodIndex);

      expect(newlineBoundary).toBeDefined();
      expect(periodBoundary).toBeDefined();
      if (CONSTANTS.enableChatHeuristics) {
        expect(newlineBoundary?.boundarySources).toContain(
          "code_block_context"
        );
      }
      expectBoundarySourcesPresent(result);
      expectNoEmotionalLeakage(result);
    });
  });

  describe("Determinism", () => {
    it("should be deterministic across runs", () => {
      const input = "Dr. Smith went home.\nWait... What?";
      const first = analyzer.analyze(input);
      const second = analyzer.analyze(input);

      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      expect(first.boundaries.length).toBeGreaterThanOrEqual(ONE);
      expectBoundarySourcesPresent(first);
      expectNoEmotionalLeakage(first);
    });
  });
});
