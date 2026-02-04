import { readFileSync } from "fs";
import path from "path";
import { MASTER_CONSTANTS } from "../config/master.constants";
import { getEIVTier } from "../scorers/eivTiers";
import { InputProcessor } from "../processors/InputProcessor";
import { EIVComponentAssembler } from "../processors/EIVComponentAssembler";
import { EIVScorer } from "../scorers/EIVScorer";
import { PromptTemplateBuilder } from "../prompt/PromptTemplateBuilder";
import { DecisionLogger } from "../logging/DecisionLogger";
import { EngineOrchestrator } from "../engines/EngineOrchestrator";
import type { EmotionalState } from "../types/analysis.types";

jest.mock("../debug/sessionTrace", () => ({
  writeSessionTrace: jest.fn(),
}));

const readSource = (relativePath: string): string =>
  readFileSync(
    path.resolve(__dirname, "..", relativePath),
    "utf8"
  );

const extractInterfaceKeys = (
  source: string,
  interfaceName: string
): string[] => {
  const match = source.match(
    new RegExp(
      `export\\s+interface\\s+${interfaceName}\\s*\\{([\\s\\S]*?)\\n\\}`,
      "m"
    )
  );
  if (!match) {
    throw new Error(`Interface not found: ${interfaceName}`);
  }
  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("readonly"))
    .map((line) => line.replace("readonly", "").trim())
    .map((line) => line.replace(/[:?].*$/, ""))
    .filter(Boolean);
};

describe("Freeze invariants", () => {
  test("SignalPacket schema shape is frozen", () => {
    const source = readSource("types/SignalPacket.types.ts");
    const keys = extractInterfaceKeys(source, "SignalPacket");
    expect(keys.sort()).toEqual(
      [
        "messageText",
        "sentences",
        "layer1Health",
        "metadata",
        "expressionStrength",
        "valence",
        "arousal",
        "ambiguity",
      ].sort()
    );
  });

  test("EIVComponents keys are frozen", () => {
    const source = readSource("types/eiv.types.ts");
    const keys = extractInterfaceKeys(source, "EIVComponents");
    expect(keys.sort()).toEqual(
      ["expressionStrength", "valence", "arousal"].sort()
    );
  });

  test("EIVResult exposes only public contract fields", () => {
    const source = readSource("types/eiv.types.ts");
    const keys = extractInterfaceKeys(source, "EIVResult");
    expect(keys.sort()).toEqual(
      ["value", "components", "breakdown", "timestamp"].sort()
    );
  });

  test("Metric ranges remain unchanged", () => {
    expect(MASTER_CONSTANTS.eivCompositionConstants.CLAMP).toEqual({
      MIN: 0,
      MAX: 1,
    });
    expect(MASTER_CONSTANTS.etvBounds.min).toBe(0);
    expect(MASTER_CONSTANTS.etvBounds.max).toBe(1);
    expect(MASTER_CONSTANTS.expressionStrength.clip.min).toBe(0);
    expect(MASTER_CONSTANTS.expressionStrength.clip.max).toBe(1);
    expect(MASTER_CONSTANTS.arousalCalibrationConstants.bounds.min).toBe(0.2);
    expect(MASTER_CONSTANTS.arousalCalibrationConstants.bounds.max).toBe(1.0);
    expect(MASTER_CONSTANTS.valenceAnalyzer.normalization.minScore).toBe(-1);
    expect(MASTER_CONSTANTS.valenceAnalyzer.normalization.maxScore).toBe(1);
  });

  test("EIV tier thresholds are locked", () => {
    expect(MASTER_CONSTANTS.eiv.tiers).toEqual({
      minimalMaxExclusive: 0.15,
      lowMaxExclusive: 0.3,
      moderateMaxExclusive: 0.55,
      highMaxExclusive: 0.8,
    });

    expect(getEIVTier(0.1499)).toBe("minimal");
    expect(getEIVTier(0.15)).toBe("low");
    expect(getEIVTier(0.2999)).toBe("low");
    expect(getEIVTier(0.3)).toBe("moderate");
    expect(getEIVTier(0.5499)).toBe("moderate");
    expect(getEIVTier(0.55)).toBe("high");
    expect(getEIVTier(0.7999)).toBe("high");
    expect(getEIVTier(0.8)).toBe("extreme");
  });

  test("Execution order is fixed", async () => {
    const inputSpy = jest.spyOn(InputProcessor, "process");
    const assembleSpy = jest.spyOn(EIVComponentAssembler, "assemble");
    const scoreSpy = jest.spyOn(EIVScorer, "calculate");
    const promptSpy = jest.spyOn(PromptTemplateBuilder, "build");
    const logSpy = jest.spyOn(DecisionLogger, "logMessageDecision");

    const engine = new EngineOrchestrator(
      MASTER_CONSTANTS.engineDefaults.initialETV,
      {},
      () => ({
        generateResponse: async () => "ok",
      })
    );

    const analyzerOutputs = InputProcessor.process("Test message.");
    const emotionalState: EmotionalState = {
      dominant: "NEUTRAL",
      arousal: "LOW",
      valence: "NEUTRAL",
      confidence: 0.5,
    };

    await engine.processMessage(analyzerOutputs, emotionalState);

    const callOrder = [
      inputSpy,
      assembleSpy,
      scoreSpy,
      promptSpy,
      logSpy,
    ].map((spy) => spy.mock.invocationCallOrder[0]);

    expect(callOrder).toEqual([...callOrder].sort((a, b) => a - b));
  });
});
