import { MASTER_CONSTANTS } from "../../config/master.constants";

const AROUSAL_CONSTANTS = MASTER_CONSTANTS.arousalCalibrationConstants;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const countExclamationMarks = (text: string): number =>
  (text.match(/!/g) ?? []).length;

const detectMixedPunctuation = (text: string): boolean =>
  /(\?!|!\?)/.test(text);

const calculateCapsRatio = (text: string): number => {
  const letters = text.match(/[A-Za-z]/g) ?? [];
  if (letters.length === 0) {
    return 0;
  }
  const upper = letters.filter((char) => char === char.toUpperCase()).length;
  return upper / letters.length;
};

const HIGH_AROUSAL_EMOJI = [
  "😱",
  "😨",
  "😰",
  "🤯",
  "🔥",
  "💥",
  "⚡",
  "🎉",
  "💣",
  "💫",
];

const detectHighArousalEmoji = (text: string): number =>
  HIGH_AROUSAL_EMOJI.reduce((count, emoji) => {
    const matches = text.split(emoji).length - 1;
    return count + matches;
  }, 0);

const detectElongation = (text: string): boolean => {
  const minRepeat = AROUSAL_CONSTANTS.REPETITION.ELONGATION_MIN_REPEAT;
  const elongationPattern = new RegExp(`(.)\\1{${minRepeat},}`, "i");
  return elongationPattern.test(text);
};

const buildWindows = (text: string): string[] => {
  const { WINDOW_SIZE, OVERLAP } = AROUSAL_CONSTANTS.WINDOWING;
  if (text.length <= WINDOW_SIZE) {
    return [text];
  }
  const windows: string[] = [];
  const step = WINDOW_SIZE - OVERLAP;
  for (let start = 0; start < text.length; start += step) {
    const window = text.slice(start, start + WINDOW_SIZE);
    windows.push(window);
    if (start + WINDOW_SIZE >= text.length) {
      break;
    }
  }
  return windows;
};

export type ArousalAnalysis = {
  arousal: number;
  confidence: number;
  flags: string[];
};

type ArousalWindowAnalysis = ArousalAnalysis & {
  signalCount: number;
};

const analyzeWindow = (text: string): ArousalWindowAnalysis => {
  const flags: string[] = [];
  const counts = {
    exclamations: countExclamationMarks(text),
    mixedPunctuation: detectMixedPunctuation(text),
    capsRatio: calculateCapsRatio(text),
    emojiCount: detectHighArousalEmoji(text),
    elongation: detectElongation(text),
  };

  let arousal: number = AROUSAL_CONSTANTS.BASELINE.NEUTRAL_FLOOR;
  let confidence: number = AROUSAL_CONSTANTS.CONFIDENCE.BASE;

  const exclamationContribution = Math.min(
    counts.exclamations * AROUSAL_CONSTANTS.PUNCTUATION.EXCLAMATION_INCREMENT,
    AROUSAL_CONSTANTS.PUNCTUATION.EXCLAMATION_MAX
  );
  arousal += exclamationContribution;

  if (counts.mixedPunctuation) {
    arousal += AROUSAL_CONSTANTS.PUNCTUATION.MIXED_PUNCTUATION_INCREMENT;
  }

  const capsContribution = Math.min(
    counts.capsRatio * AROUSAL_CONSTANTS.CAPITALIZATION.CAPS_RATIO_MULTIPLIER,
    AROUSAL_CONSTANTS.CAPITALIZATION.MAX_CAPS_CONTRIBUTION
  );
  arousal += capsContribution;

  const emojiContribution = Math.min(
    counts.emojiCount * AROUSAL_CONSTANTS.EMOJI.HIGH_AROUSAL_INCREMENT,
    AROUSAL_CONSTANTS.EMOJI.MAX_EMOJI_CONTRIBUTION
  );
  arousal += emojiContribution;

  const signalCount =
    (exclamationContribution > 0 ? 1 : 0) +
    (counts.mixedPunctuation ? 1 : 0) +
    (capsContribution > 0 ? 1 : 0) +
    (emojiContribution > 0 ? 1 : 0) +
    (counts.elongation ? 1 : 0);

  if (counts.elongation) {
    arousal *= AROUSAL_CONSTANTS.REPETITION.ELONGATION_MULTIPLIER;
    confidence -= AROUSAL_CONSTANTS.CONFIDENCE.LOW_EVIDENCE_PENALTY;
  }

  if (signalCount <= AROUSAL_CONSTANTS.EVIDENCE.MIN_SIGNAL_COUNT) {
    flags.push("low_evidence");
    confidence -= AROUSAL_CONSTANTS.CONFIDENCE.LOW_EVIDENCE_PENALTY;
  }

  if (
    text.length <= AROUSAL_CONSTANTS.EVIDENCE.SHORT_TEXT_MAX_LENGTH &&
    counts.exclamations >= AROUSAL_CONSTANTS.PUNCTUATION.HIGH_PUNCTUATION_THRESHOLD
  ) {
    flags.push("low_evidence");
    confidence -= AROUSAL_CONSTANTS.CONFIDENCE.LOW_EVIDENCE_PENALTY;
  }

  const strongSignals =
    (exclamationContribution >=
      AROUSAL_CONSTANTS.EVIDENCE.STRONG_SIGNAL_THRESHOLD
      ? 1
      : 0) +
    (capsContribution >= AROUSAL_CONSTANTS.EVIDENCE.STRONG_SIGNAL_THRESHOLD
      ? 1
      : 0) +
    (emojiContribution >= AROUSAL_CONSTANTS.EVIDENCE.STRONG_SIGNAL_THRESHOLD
      ? 1
      : 0);

  if (strongSignals >= 2) {
    flags.push("conflicting_activation");
    confidence -= AROUSAL_CONSTANTS.CONFIDENCE.CONFLICT_PENALTY;
  }

  if (
    counts.mixedPunctuation ||
    (counts.exclamations >=
      AROUSAL_CONSTANTS.PUNCTUATION.HIGH_PUNCTUATION_THRESHOLD &&
      capsContribution > 0)
  ) {
    flags.push("potential_sarcasm");
    confidence -= AROUSAL_CONSTANTS.CONFIDENCE.SARCASTIC_PENALTY;
  }

  arousal = clamp(
    arousal,
    AROUSAL_CONSTANTS.SCALE.MIN,
    AROUSAL_CONSTANTS.SCALE.MAX
  );
  confidence = clamp(
    confidence,
    AROUSAL_CONSTANTS.CONFIDENCE.MIN,
    AROUSAL_CONSTANTS.CONFIDENCE.MAX
  );

  return { arousal, confidence, flags, signalCount };
};

export class ArousalAnalyzer {
  analyze(text: string): ArousalAnalysis {
    const windows = buildWindows(text);
    const analyses = windows.map((window) => analyzeWindow(window));
    const signalWindows = analyses.filter(
      (analysis) => analysis.signalCount > 0
    );
    const effectiveWindows =
      signalWindows.length > 0 ? signalWindows : analyses;

    const meanArousal =
      effectiveWindows.reduce((sum, result) => sum + result.arousal, 0) /
      effectiveWindows.length;
    const meanConfidence =
      effectiveWindows.reduce((sum, result) => sum + result.confidence, 0) /
      effectiveWindows.length;

    const variance =
      effectiveWindows.reduce((sum, result) => {
        const diff = result.arousal - meanArousal;
        return sum + diff * diff;
      }, 0) / effectiveWindows.length;

    let confidence = meanConfidence;
    const flags = Array.from(
      new Set(analyses.flatMap((result) => result.flags))
    );

    if (variance > AROUSAL_CONSTANTS.WINDOWING.VARIANCE_THRESHOLD) {
      flags.push("conflicting_activation");
      confidence -= AROUSAL_CONSTANTS.CONFIDENCE.VARIANCE_PENALTY;
    }

    return {
      arousal: clamp(
        meanArousal,
        AROUSAL_CONSTANTS.SCALE.MIN,
        AROUSAL_CONSTANTS.SCALE.MAX
      ),
      confidence: clamp(
        confidence,
        AROUSAL_CONSTANTS.CONFIDENCE.MIN,
        AROUSAL_CONSTANTS.CONFIDENCE.MAX
      ),
      flags,
    };
  }
}
