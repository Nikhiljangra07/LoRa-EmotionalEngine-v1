import { EngineOrchestrator } from "../../engines/EngineOrchestrator";
import { DecisionLogger } from "../../logging/DecisionLogger";
import { InputProcessor } from "../../processors/InputProcessor";
import type { EmotionalState } from "../../types/analysis.types";

describe("GuidanceMode selection smoke", () => {
  const buildEngine = () =>
    new EngineOrchestrator(
      0.5,
      {},
      () => ({
        generateResponse: async () => "ok",
      })
    );

  test("calm/neutral low case yields CALM_NEUTRAL", async () => {
    const { analyzerOutputs, signalPacket } = InputProcessor.process("ok");
    const emotionalState: EmotionalState = {
      dominant: "NEUTRAL",
      arousal: "LOW",
      valence: "NEUTRAL",
      confidence: 0.5,
    };

    const logSpy = jest.spyOn(DecisionLogger, "logMessageDecision");
    const engine = buildEngine();
    await engine.processMessage(
      analyzerOutputs,
      emotionalState,
      false,
      {},
      undefined,
      signalPacket
    );

    const payload = logSpy.mock.calls[0]?.[0] as {
      promptProfile: { guidanceMode: string };
    };
    expect(payload.promptProfile.guidanceMode).toBe("CALM_NEUTRAL");
  });

  test("high arousal negative case is not CALM_NEUTRAL", async () => {
    const { analyzerOutputs, signalPacket } = InputProcessor.process("bad");
    const emotionalState: EmotionalState = {
      dominant: "NEUTRAL",
      arousal: "HIGH",
      valence: "NEGATIVE",
      confidence: 0.5,
    };

    const logSpy = jest.spyOn(DecisionLogger, "logMessageDecision");
    const engine = buildEngine();
    await engine.processMessage(
      analyzerOutputs,
      emotionalState,
      false,
      {},
      undefined,
      signalPacket
    );

    const payload = logSpy.mock.calls[0]?.[0] as {
      promptProfile: { guidanceMode: string };
    };
    expect(payload.promptProfile.guidanceMode).not.toBe("CALM_NEUTRAL");
  });
});
