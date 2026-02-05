/**
 * Usage:
 *   LORA_DEBUG=1 LORA_DEBUG_VERBOSE=1 OPENAI_API_KEY=... \
 *   npx ts-node src/emotion-core/debug/chat-cli.ts
 */
import readline from "readline";
import { EngineOrchestrator } from "../engines/EngineOrchestrator";
import { InputProcessor } from "../processors/InputProcessor";
import type { EmotionalState } from "../types/analysis.types";

const COMMANDS = ["/help", "/exit", "/quit"];

export const runChatCLI = () => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const engine = new EngineOrchestrator();

  const prompt = () => {
    rl.question("You> ", async (input) => {
      const trimmed = input.trim();
      if (trimmed === "/exit" || trimmed === "/quit") {
        rl.close();
        process.exit(0);
      }

      if (trimmed === "/help") {
        console.log("Commands:", COMMANDS.join(", "));
        return prompt();
      }

      const { analyzerOutputs, signalPacket } = InputProcessor.process(trimmed);
      const emotionalState: EmotionalState = {
        dominant: "NEUTRAL",
        arousal: "LOW",
        valence: "NEUTRAL",
        confidence: 0.5,
      };

      const flags = { ambiguityDetected: false };
      try {
        const result = await engine.processMessage(
          analyzerOutputs,
          emotionalState,
          false,
          flags,
          undefined,
          signalPacket
        );
        console.log(`LoRa> ${result.llmOutput}`);

        if (process.env.LORA_DEBUG_VERBOSE) {
          console.log(
            "[LoRa::DebugVerbose]",
            "eivTier:",
            result.eiv.breakdown.tier,
            "| flags:",
            { safetyTriggered: false, ambiguityDetected: flags.ambiguityDetected }
          );
        }
      } catch (error) {
        console.error("LoRa> Error:", error);
      }

      return prompt();
    });
  };

  console.log('Type "/help" for commands.');
  prompt();
};

if (require.main === module) {
  runChatCLI();
}
