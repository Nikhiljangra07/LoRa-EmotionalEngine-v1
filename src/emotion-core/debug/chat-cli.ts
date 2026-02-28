/**
 * Usage:
 *   LORA_DEBUG=1 LORA_DEBUG_VERBOSE=1 OPENAI_API_KEY=... \
 *   npx ts-node src/emotion-core/debug/chat-cli.ts
 */
import '../../bootstrap';
import readline from "readline";
import { EngineOrchestrator } from "../engines/EngineOrchestrator";
import { InputProcessor } from "../processors/InputProcessor";
import { DecisionLogger } from "../logging/DecisionLogger";
import { OpenAIResponder } from "../llm/OpenAIResponder";
import { debugEnabled } from "./debugGate";

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
  let lastGuidanceMode: string | null = null;
  let lastFlags: { ambiguityDetected?: boolean; safetyTriggered?: boolean } =
    {};
  const recentMessages: string[] = [];
  const maxRecentMessages = 4;
  const maxContextChars = 300;

  if (debugEnabled && process.env.LORA_DEBUG_WIRING) {
    const originalGenerate = OpenAIResponder.prototype.generateResponse;
    OpenAIResponder.prototype.generateResponse = async function (
      systemPrompt: string,
      userMessage: string,
      opts?: { signal?: AbortSignal; requestId?: string }
    ): Promise<string> {
      lastPrompt = systemPrompt;
      return originalGenerate.call(this, systemPrompt, userMessage, opts);
    };

    const originalLog = DecisionLogger.logMessageDecision;
    DecisionLogger.logMessageDecision = (payload) => {
      lastAnalyzerSummary = payload.analyzerSummary;
      lastGuidanceMode = payload.promptProfile.guidanceMode;
      lastFlags = payload.flags;
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

      const microContext =
        recentMessages.length >= 2
          ? recentMessages
              .slice(-maxRecentMessages)
              .join("\n")
              .slice(0, maxContextChars)
          : undefined;
      if (debugEnabled && microContext) {
        console.log("[LoRa::MicroContext]", microContext);
      }

      const { analyzerOutputs, signalPacket } = InputProcessor.process(trimmed);
      if (debugEnabled && process.env.LORA_DEBUG_WIRING) {
        lastPrompt = trimmed;
      }
      const signalPacketWithContext = microContext
        ? ({
            ...signalPacket,
            metadata: {
              ...(signalPacket.metadata as Record<string, unknown>),
              microContext,
            },
          } as typeof signalPacket)
        : signalPacket;

      const flags = { ambiguityDetected: false };
      try {
        const result = await engine.processMessage(
          analyzerOutputs,
          undefined,
          false,
          flags,
          undefined,
          signalPacketWithContext
        );
        console.log(`LoRa> ${result.llmOutput}`);

        if (debugEnabled && process.env.LORA_DEBUG_WIRING) {
          const includesUser = lastPrompt?.includes(trimmed) ?? false;
          console.log(
            "[LoRa::Wiring]",
            "payloadIncludesUser:",
            includesUser
          );
          console.log("[LoRa::Wiring]", "valence", {
            score: analyzerOutputs.valence.score,
            confidence: analyzerOutputs.valence.confidence,
          });
          console.log("[LoRa::Wiring]", "arousal", {
            score: analyzerOutputs.arousal.score,
            confidence: analyzerOutputs.arousal.confidence,
          });
          console.log("[LoRa::Wiring]", "expressionStrength", {
            score: analyzerOutputs.expressionStrength.score,
            confidence: analyzerOutputs.expressionStrength.confidence,
          });
          console.log(
            "[LoRa::Wiring]",
            "guidanceMode:",
            lastGuidanceMode ?? "missing"
          );
          if (lastAnalyzerSummary) {
            console.log(
              "[LoRa::Wiring]",
              "analyzerSummary:",
              lastAnalyzerSummary
            );
          }
          if (lastFlags) {
            console.log("[LoRa::Wiring]", "flags:", lastFlags);
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

      recentMessages.push(trimmed);
      if (recentMessages.length > maxRecentMessages) {
        recentMessages.shift();
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
