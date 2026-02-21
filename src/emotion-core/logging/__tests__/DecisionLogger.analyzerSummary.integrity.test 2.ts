import { EngineOrchestrator } from "../../engines/EngineOrchestrator";
import { DecisionLogger } from "../DecisionLogger";
import type { EmotionalState } from "../../types/analysis.types";
import type { AnalyzerOutputs } from "../../processors/EIVComponentAssembler";
import type { SignalPacket } from "../../types/SignalPacket.types";

describe("DecisionLogger analyzerSummary integrity", () => {
  test("false analyzer signals remain false in logged summary", async () => {
    const analyzerOutputs: AnalyzerOutputs = {
      expressionStrength: { score: 0, confidence: 0.8 },
      valence: { score: 0, confidence: 0.8 },
      arousal: { score: 0, confidence: 0.8 },
    };

    const signalPacket: SignalPacket = {
      messageText: "Neutral input.",
      sentences: [],
      layer1Health: { degraded: false, reason: "ok" },
      metadata: {
        expressionStrengthSignals: {
          emoji: false,
          caps: false,
          punctuation: false,
          repetition: false,
        },
        analyzerSummary: {
          emojiUsed: false,
          capsUsed: false,
          punctuationUsed: false,
          repetitionDetected: false,
        },
      },
    };

    const emotionalState: EmotionalState = {
      dominant: "NEUTRAL",
      arousal: "LOW",
      valence: "NEUTRAL",
      confidence: 0.5,
    };

    const logSpy = jest.spyOn(DecisionLogger, "logMessageDecision");
    const engine = new EngineOrchestrator(
      0.5,
      {},
      () => ({
        generateResponse: async () => "ok",
      })
    );

    await engine.processMessage(
      analyzerOutputs,
      emotionalState,
      false,
      {},
      undefined,
      signalPacket
    );

    const payload = logSpy.mock.calls[0]?.[0] as {
      analyzerSummary: {
        emojiUsed: boolean;
        capsUsed: boolean;
        punctuationUsed: boolean;
        repetitionDetected: boolean;
      };
    };

    expect(payload.analyzerSummary).toEqual({
      emojiUsed: false,
      capsUsed: false,
      punctuationUsed: false,
      repetitionDetected: false,
    });
  });
});
