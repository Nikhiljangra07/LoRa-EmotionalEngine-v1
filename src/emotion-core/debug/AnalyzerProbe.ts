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

export const logAnalyzerProbe = (payload: AnalyzerProbePayload): void => {
  if (!process.env.LORA_DEBUG) return;

  console.groupCollapsed("[LoRa::AnalyzerProbe]");
  console.debug("analyzers", payload.analyzers);
  console.debug("expressionStrengthSignals", payload.expressionStrengthSignals);
  console.debug("analyzerSummary", payload.analyzerSummary);
  console.groupEnd();
};
