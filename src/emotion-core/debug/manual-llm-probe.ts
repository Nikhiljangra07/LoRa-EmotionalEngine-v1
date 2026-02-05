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

engine
  .processMessage(
    analyzerOutputs,
    emotionalState,
    false,
    {},
    undefined,
    signalPacket
  )
  .then((result) => {
    console.log("Manual LLM probe result:", result);
  })
  .catch((error) => {
    console.error("Manual LLM probe error:", error);
  });
