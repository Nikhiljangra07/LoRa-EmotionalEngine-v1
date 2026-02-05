/**
 * Usage:
 *   LORA_DEBUG=1 LORA_DEBUG_VERBOSE=1 OPENAI_API_KEY=... \
 *   npx ts-node src/emotion-core/debug/chat-cli.ts
 */
import readline from "readline";
import { EngineOrchestrator } from "../engines/EngineOrchestrator";
import { InputProcessor } from "../processors/InputProcessor";
import type { EmotionalState } from "../types/analysis.types";
import { DecisionLogger } from "../logging/DecisionLogger";
import { OpenAIResponder } from "../llm/OpenAIResponder";

const COMMANDS = ["/help", "/exit", "/quit"];

export const runChatCLI = () => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let lastPrompt: string | null = null;
  let lastAnalyzerSummary:
    | {
        emojiUsed: boolean;
        capsUsed: boolean;
        punctuationUsed: boolean;
        repetitionDetected: boolean;
      }
    | null = null;

  if (process.env.LORA_DEBUG_WIRING) {
    const originalGenerate = OpenAIResponder.prototype.generateResponse;
    OpenAIResponder.prototype.generateResponse = async function (
      prompt: string
    ): Promise<string> {
      lastPrompt = prompt;
      return originalGenerate.call(this, prompt);
    };

    const originalLog = DecisionLogger.logMessageDecision;
    DecisionLogger.logMessageDecision = (payload) => {
      lastAnalyzerSummary = payload.analyzerSummary;
      return originalLog(payload);
    };
  }

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

        if (process.env.LORA_DEBUG_WIRING) {
          const includesUser = lastPrompt?.includes(trimmed) ?? false;
          console.log(
            "[LoRa::Wiring]",
            "payloadIncludesUser:",
            includesUser
          );
          if (lastAnalyzerSummary) {
            console.log(
              "[LoRa::Wiring]",
              "analyzerSummary:",
              lastAnalyzerSummary
            );
          }
        }

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
