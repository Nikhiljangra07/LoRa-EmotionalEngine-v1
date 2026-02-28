import { EngineOrchestrator } from "../EngineOrchestrator";
import { InputProcessor } from "../../processors/InputProcessor";
import type { EmotionalState } from "../../types/analysis.types";

describe("EngineOrchestrator LLM input wiring", () => {
  test("LLM responder receives exact user input string", async () => {
    const message = "My manager just demoted me!";
    const { analyzerOutputs, signalPacket } = InputProcessor.process(message);

    const emotionalState: EmotionalState = {
      dominant: "NEUTRAL",
      arousal: "LOW",
      valence: "NEUTRAL",
      confidence: 0.5,
    };

    let capturedSystemPrompt = "";
    let capturedUserMessage = "";
    const engine = new EngineOrchestrator(
      0.5,
      {},
      () => ({
        generateResponse: async (systemPrompt: string, userMessage: string) => {
          capturedSystemPrompt = systemPrompt;
          capturedUserMessage = userMessage;
          return "ok";
        },
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

    expect(capturedUserMessage).toBe(message);
    expect(capturedSystemPrompt).not.toContain(message);
    expect(capturedSystemPrompt.length).toBeGreaterThan(0);
  });
});
