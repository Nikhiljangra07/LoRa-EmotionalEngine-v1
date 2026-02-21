import { EngineOrchestrator } from "../engines/EngineOrchestrator";
import { InputProcessor } from "../processors/InputProcessor";
import type { EmotionalState } from "../types/analysis.types";

const message = "This is a manual LLM probe message.";

const { analyzerOutputs, signalPacket } = InputProcessor.process(message);

const emotionalState: EmotionalState = {
  dominant: "NEUTRAL",
  arousal: "LOW",
  valence: "NEUTRAL",
  confidence: 0.5,
};

const engine = new EngineOrchestrator();

const run = async () => {
  try {
    const result = await engine.processMessage(
      analyzerOutputs,
      emotionalState,
      false,
      {},
      undefined,
      signalPacket
    );
    const fallbackMessage =
      "I’m here with you. Let’s take this one step at a time.";
    const usedFallback = result.llmOutput === fallbackMessage;
    const modelName =
      (result as { model?: string }).model ??
      (result as { modelName?: string }).modelName ??
      "unknown";

    console.log("Manual LLM probe result:", result);
    console.log(
      "Manual LLM probe source:",
      usedFallback ? "fallback" : "llm",
      "| model:",
      modelName
    );
  } catch (error) {
    console.error("Manual LLM probe error:", error);
  }
};

void run();
