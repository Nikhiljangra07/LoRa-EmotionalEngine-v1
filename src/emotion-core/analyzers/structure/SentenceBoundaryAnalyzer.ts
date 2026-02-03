import { MASTER_CONSTANTS } from "../../config/master.constants";
import type {
  SentenceBoundary,
  SentenceBoundaryAnalysis,
  SentenceBoundaryChar,
} from "../../types/SentenceBoundary.types";

const CONSTANTS = MASTER_CONSTANTS.sentenceBoundaryAnalyzer;
const { zero: ZERO, one: ONE } = CONSTANTS.numbers;

const EMOJI_REGEX = /\p{Extended_Pictographic}/gu;
const URL_OR_EMAIL_REGEX =
  /\bhttps?:\/\/\S+|\bwww\.\S+|\b\S+@\S+\b/g;
const CODE_LIKE_REGEX =
  /(^|\n)\s*(const|let|var|function|if|for|while|return|class)\b/;
const WORD_CHAR_REGEX = /[A-Za-z]/;
const DIGIT_REGEX = /\d/;
const ELLIPSIS_PATTERN = new RegExp(
  `\\.{${CONSTANTS.heuristics.ellipsisMinLength},}`,
  "g"
);

type Span = { start: number; end: number };

const normalizeNewlines = (text: string): string =>
  text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

const collectSpans = (pattern: RegExp, text: string): Span[] => {
  const spans: Span[] = [];
  pattern.lastIndex = ZERO;
  let match: RegExpExecArray | null;

  // eslint-disable-next-line no-cond-assign
  while ((match = pattern.exec(text)) !== null) {
    const value = match[ZERO];
    spans.push({
      start: match.index,
      end: match.index + value.length,
    });
    if (match.index === pattern.lastIndex) {
      pattern.lastIndex += ONE;
    }
  }

  return spans;
};

const isIndexInSpans = (index: number, spans: Span[]): boolean =>
  spans.some((span) => index >= span.start && index < span.end);

const getPreviousToken = (text: string, index: number): string | null => {
  let cursor = index - ONE;
  while (cursor >= ZERO && !WORD_CHAR_REGEX.test(text[cursor])) {
    cursor -= ONE;
  }
  if (cursor < ZERO) return null;

  const end = cursor + ONE;
  while (cursor >= ZERO && WORD_CHAR_REGEX.test(text[cursor])) {
    cursor -= ONE;
  }
  const start = cursor + ONE;
  return text.slice(start, end).toLowerCase();
};

const getNextLetter = (text: string, index: number): string | null => {
  let cursor = index + ONE;
  while (cursor < text.length && !WORD_CHAR_REGEX.test(text[cursor])) {
    cursor += ONE;
  }
  if (cursor >= text.length) return null;
  return text[cursor];
};

const isUppercaseLetter = (value: string): boolean =>
  value.toUpperCase() === value && value.toLowerCase() !== value;

const isDecimalPoint = (text: string, index: number): boolean => {
  const prev = index - ONE;
  const next = index + ONE;
  if (prev < ZERO || next >= text.length) return false;
  return DIGIT_REGEX.test(text[prev]) && DIGIT_REGEX.test(text[next]);
};

const getLineAroundIndex = (text: string, index: number): string => {
  let start = index;
  while (start > ZERO && text[start - ONE] !== "\n") {
    start -= ONE;
  }
  let end = index;
  while (end < text.length && text[end] !== "\n") {
    end += ONE;
  }
  return text.slice(start, end);
};

const isChatFragment = (line: string): boolean => {
  const trimmed = line.trim();
  if (trimmed.length <= CONSTANTS.heuristics.chatFragmentMaxLength) {
    return /^[-*>]/.test(trimmed);
  }
  return false;
};

const isEmojiAdjacent = (index: number, emojiSpans: Span[]): boolean => {
  const window = CONSTANTS.heuristics.emojiAdjacencyWindow;
  return emojiSpans.some((span) => {
    const start = span.start - window;
    const end = span.end + window;
    return index >= start && index <= end;
  });
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const buildBoundary = (params: {
  index: number;
  char: SentenceBoundaryChar;
  sources: string[];
  ambiguityFlags: string[];
  confidence: number;
}): SentenceBoundary => ({
  boundaryIndex: params.index,
  boundaryChar: params.char,
  boundaryConfidence: clamp(
    params.confidence,
    CONSTANTS.bounds.min,
    CONSTANTS.bounds.max
  ),
  boundarySources: params.sources,
  ambiguityFlags:
    params.ambiguityFlags.length > ZERO ? params.ambiguityFlags : undefined,
});

export class SentenceBoundaryAnalyzer {
  analyze(text: string): SentenceBoundaryAnalysis {
    const normalizedText = normalizeNewlines(text ?? "");
    const boundaries: SentenceBoundary[] = [];

    const urlOrEmailSpans = collectSpans(
      URL_OR_EMAIL_REGEX,
      normalizedText
    );
    const codeBlockSpans = CONSTANTS.enableChatHeuristics
      ? collectSpans(/```[\s\S]*?```/g, normalizedText)
      : [];
    const ellipsisMatches = CONSTANTS.enableChatHeuristics
      ? collectSpans(ELLIPSIS_PATTERN, normalizedText)
      : [];
    const emojiSpans = CONSTANTS.enableChatHeuristics
      ? collectSpans(EMOJI_REGEX, normalizedText)
      : [];
    const ellipsisEndIndices = new Set<number>(
      ellipsisMatches.map((span) => span.end - ONE)
    );

    let index = ZERO;
    while (index < normalizedText.length) {
      const char = normalizedText[index];
      const isNewline = char === "\n";
      const isPunctuation = char === "." || char === "!" || char === "?";
      if (!isNewline && !isPunctuation) {
        index += ONE;
        continue;
      }

      if (isPunctuation && isIndexInSpans(index, urlOrEmailSpans)) {
        index += ONE;
        continue;
      }

      if (isPunctuation && char === "." && isDecimalPoint(normalizedText, index)) {
        index += ONE;
        continue;
      }

      if (
        CONSTANTS.enableChatHeuristics &&
        char === "." &&
        isIndexInSpans(index, ellipsisMatches) &&
        !ellipsisEndIndices.has(index)
      ) {
        index += ONE;
        continue;
      }

      const sources: string[] = [];
      const ambiguityFlags: string[] = [];
      let confidence = CONSTANTS.confidence.base;

      if (char === ".") {
        sources.push("punctuation_period");
        confidence += CONSTANTS.confidence.punctuationBoost.period;
      } else if (char === "!") {
        sources.push("punctuation_exclamation");
        confidence += CONSTANTS.confidence.punctuationBoost.exclamation;
      } else if (char === "?") {
        sources.push("punctuation_question");
        confidence += CONSTANTS.confidence.punctuationBoost.question;
      } else if (char === "\n") {
        sources.push("newline");
        confidence += CONSTANTS.confidence.punctuationBoost.newline;
      }

      if (
        CONSTANTS.enableChatHeuristics &&
        char === "." &&
        ellipsisEndIndices.has(index)
      ) {
        sources.push("ellipsis_context");
        ambiguityFlags.push("ellipsis_context");
        confidence -= CONSTANTS.confidence.ellipsisPenalty;
      }

      const previousToken = isPunctuation
        ? getPreviousToken(normalizedText, index)
        : null;
      const nextLetter = getNextLetter(normalizedText, index);
      const nextIsUppercase = nextLetter ? isUppercaseLetter(nextLetter) : false;

      if (nextIsUppercase) {
        sources.push("next_token_capitalized");
        confidence += CONSTANTS.confidence.capitalizationBoost;
      }

      if (previousToken && CONSTANTS.punkt.abbreviations.includes(previousToken)) {
        const flag = `abbreviation_candidate_${previousToken}`;
        ambiguityFlags.push(flag);
        sources.push("punkt_abbreviation_candidate");
        confidence -= CONSTANTS.confidence.abbreviationPenalty;

        const llr = CONSTANTS.punkt.llr[previousToken];
        if (llr !== undefined && llr >= CONSTANTS.punkt.llrThreshold) {
          sources.push("punkt_llr_support");
          confidence += CONSTANTS.confidence.llrBoost;
        }

        if (nextLetter !== null) {
          index += ONE;
          continue;
        }
      }

      if (isNewline) {
        if (!nextIsUppercase) {
          ambiguityFlags.push("newline_soft_boundary");
          sources.push("newline_soft_boundary");
        }
        if (CONSTANTS.enableChatHeuristics) {
          const line = getLineAroundIndex(normalizedText, index);
          if (isChatFragment(line)) {
            sources.push("chat_fragment");
            confidence -= CONSTANTS.confidence.chatFragmentPenalty;
          }
          if (CODE_LIKE_REGEX.test(line)) {
            sources.push("code_block_context");
            confidence -= CONSTANTS.confidence.codeBlockPenalty;
          }
        }
      }

      if (CONSTANTS.enableChatHeuristics) {
        if (isEmojiAdjacent(index, emojiSpans)) {
          ambiguityFlags.push("emoji_adjacent");
          sources.push("emoji_adjacent");
          confidence -= CONSTANTS.confidence.emojiAdjacencyPenalty;
        }
        if (isIndexInSpans(index, codeBlockSpans)) {
          sources.push("code_block_context");
          confidence -= CONSTANTS.confidence.codeBlockPenalty;
        }
      }

      boundaries.push(
        buildBoundary({
          index,
          char: char as SentenceBoundaryChar,
          sources,
          ambiguityFlags,
          confidence,
        })
      );

      index += ONE;
    }

    return { boundaries, normalizedText };
  }
}
