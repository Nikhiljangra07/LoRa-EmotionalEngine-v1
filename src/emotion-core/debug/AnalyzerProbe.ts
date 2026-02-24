type AnalyzerProbePayload = {
  analyzers: {
    valence: boolean;
    arousal: boolean;
    expressionStrength: boolean;
    ambiguityComputed: boolean;
  };
  expressionStrengthSignals: {
    emoji: boolean;
    caps: boolean;
    punctuation: boolean;
    repetition: boolean;
  };
  analyzerSummary: {
    emojiUsed: boolean;
    capsUsed: boolean;
    punctuationUsed: boolean;
    repetitionDetected: boolean;
  };
};

import { debugEnabled } from './debugGate';

export const logAnalyzerProbe = (payload: AnalyzerProbePayload): void => {
  if (!debugEnabled) return;

  console.groupCollapsed("[LoRa::AnalyzerProbe]");
  console.debug("analyzers", payload.analyzers);
  console.debug("expressionStrengthSignals", payload.expressionStrengthSignals);
  console.debug("analyzerSummary", payload.analyzerSummary);
  console.groupEnd();
};
