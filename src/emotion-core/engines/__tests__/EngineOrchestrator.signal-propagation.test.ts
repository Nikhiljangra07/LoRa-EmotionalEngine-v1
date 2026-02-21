import { EngineOrchestrator } from "../EngineOrchestrator";
import { InputProcessor } from "../../processors/InputProcessor";
import { MASTER_CONSTANTS } from "../../config/master.constants";
import { DecisionLogger } from "../../logging/DecisionLogger";

describe("EngineOrchestrator signal propagation", () => {
  test("valence/arousal propagate and analyzerSummary reflects signals", async () => {
    const text = "I'm PISSED. SERIOUSLY!!! \u{1F624}\u{1F624}";
    const { analyzerOutputs, signalPacket } = InputProcessor.process(text);

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
      undefined,
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
      emotionalState: { arousal: string; valence: string };
    };

    expect(payload.analyzerSummary).toEqual({
      emojiUsed: true,
      capsUsed: true,
      punctuationUsed: true,
      repetitionDetected: false,
    });

    const arousalEpsilon = MASTER_CONSTANTS.bounds.zero;
    expect(analyzerOutputs.arousal.score).toBeGreaterThan(arousalEpsilon);
    expect(analyzerOutputs.arousal.confidence).toBeGreaterThanOrEqual(
      MASTER_CONSTANTS.arousalCalibrationConstants.confidence.min
    );
  });
});
