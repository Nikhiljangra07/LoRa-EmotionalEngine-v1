import { readFileSync } from "fs";
import path from "path";
import { MASTER_CONSTANTS } from "../config/master.constants";
import { getEIVTier } from "../scorers/eivTiers";
import { InputProcessor } from "../processors/InputProcessor";
import { EIVComponentAssembler } from "../processors/EIVComponentAssembler";
import { EIVScorer } from "../scorers/EIVScorer";
import { PromptTemplateBuilder } from "../prompt/PromptTemplateBuilder";
import { EngineOrchestrator } from "../engines/EngineOrchestrator";
import { ExpressionStrengthScorer } from "../scorers/ExpressionStrengthScorer";
import { ValenceAnalyzer } from "../analyzers/content/ValenceAnalyzer";
import { ArousalAnalyzer } from "../analyzers/content/ArousalAnalyzer";
import { buildExpressionStrengthFeatures } from "../analyzers/content/ExpressionStrengthAnalyzer";
import { computeES } from "../math/computeES";
import type { EIVResult } from "../types/eiv.types";
import type { EmotionalState } from "../types/analysis.types";
import type { SignalPacket } from "../types/SignalPacket.types";
import * as EIVComposerModule from "../scorers/EIVComposer";
import * as EIVTierModule from "../scorers/eivTiers";

const readSource = (relativePath: string): string =>
  readFileSync(
    path.resolve(__dirname, "..", relativePath),
    "utf8"
  );

const stripComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

const extractTypeBody = (
  source: string,
  typeName: string
): string => {
  const cleaned = stripComments(source);
  const interfaceMatch = cleaned.match(
    new RegExp(`\\binterface\\s+${typeName}\\b`)
  );
  const typeMatch = cleaned.match(
    new RegExp(`\\btype\\s+${typeName}\\s*=`)
  );

  const match = interfaceMatch ?? typeMatch;
  if (!match || match.index === undefined) {
    throw new Error(`Type not found: ${typeName}`);
  }

  const start = cleaned.indexOf("{", match.index);
  if (start === -1) {
    throw new Error(`Type body not found: ${typeName}`);
  }

  let depth = 0;
  for (let i = start; i < cleaned.length; i += 1) {
    const char = cleaned[i];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return cleaned.slice(start + 1, i);
      }
    }
  }

  throw new Error(`Unterminated type body: ${typeName}`);
};

const extractTypeKeys = (
  source: string,
  typeName: string
): string[] => {
  const body = extractTypeBody(source, typeName);
  const keys: string[] = [];
  let depth = 0;

  body.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    if (depth === 0) {
      const match = trimmed.match(
        /^(readonly\s+)?([A-Za-z0-9_]+)\s*[:?]/
      );
      if (match) {
        keys.push(match[2]);
      }
    }

    for (const char of line) {
      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth = Math.max(0, depth - 1);
      }
    }
  });

  return keys;
};

describe("Freeze invariants", () => {
  test("SignalPacket immutability contract is enforced", () => {
    const packet: SignalPacket = {
      messageText: "Example",
      sentences: [
        {
          text: "Example",
          position: 0,
          esScore: 0,
          arousalScore: 0,
        },
      ],
      layer1Health: { degraded: false, reason: "ok" },
    };

    // @ts-expect-error readonly contract
    packet.messageText = "mutated";
    // @ts-expect-error readonly contract
    packet.sentences.push({
      text: "mutated",
      position: 1,
      esScore: 0,
      arousalScore: 0,
    });

    const frozen = Object.freeze(packet);
    const original = frozen.messageText;
    let threw = false;
    try {
      (frozen as { messageText: string }).messageText = "mutated";
    } catch {
      threw = true;
    }
    expect(threw || frozen.messageText === original).toBe(true);
  });
  test("SignalPacket schema shape is frozen", () => {
    const source = readSource("types/SignalPacket.types.ts");
    const keys = extractTypeKeys(source, "SignalPacket");
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
    const keys = extractTypeKeys(source, "EIVComponents");
    expect(keys.sort()).toEqual(
      ["expressionStrength", "valence", "arousal"].sort()
    );
  });

  test("EIVResult exposes only public contract fields", () => {
    const source = readSource("types/eiv.types.ts");
    const keys = extractTypeKeys(source, "EIVResult");
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

  test("Metric ranges are hard-bounded", () => {
    const features = buildExpressionStrengthFeatures("OK!!!");
    const { es } = computeES(features);
    expect(es).toBeGreaterThanOrEqual(0);
    expect(es).toBeLessThanOrEqual(1);

    const outputs = InputProcessor.process("Test message.");
    expect(outputs.expressionStrength.confidence).toBeGreaterThanOrEqual(0);
    expect(outputs.expressionStrength.confidence).toBeLessThanOrEqual(1);
    expect(outputs.valence.confidence).toBeGreaterThanOrEqual(0);
    expect(outputs.valence.confidence).toBeLessThanOrEqual(1);
    expect(outputs.arousal.confidence).toBeGreaterThanOrEqual(0);
    expect(outputs.arousal.confidence).toBeLessThanOrEqual(1);

    const eiv: EIVResult = EIVScorer.calculate(
      EIVComponentAssembler.assemble(outputs)
    );
    expect(eiv.value).toBeGreaterThanOrEqual(0);
    expect(eiv.value).toBeLessThanOrEqual(1);
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
    const esSpy = jest.spyOn(ExpressionStrengthScorer, "compute");
    const valenceSpy = jest.spyOn(ValenceAnalyzer.prototype, "analyze");
    const arousalSpy = jest.spyOn(ArousalAnalyzer.prototype, "analyze");
    const assembleSpy = jest.spyOn(EIVComponentAssembler, "assemble");
    const composeSpy = jest.spyOn(EIVComposerModule, "composeEIV");
    const tierSpy = jest.spyOn(EIVTierModule, "getEIVTier");
    const promptSpy = jest.spyOn(PromptTemplateBuilder, "build");

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

    const order = [
      esSpy,
      valenceSpy,
      arousalSpy,
      assembleSpy,
      composeSpy,
      tierSpy,
      promptSpy,
    ].map((spy) => spy.mock.invocationCallOrder[0]);

    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  test("Tier threshold binding has no inline magic numbers", () => {
    expect(MASTER_CONSTANTS.eiv.tiers).toEqual({
      minimalMaxExclusive: 0.15,
      lowMaxExclusive: 0.3,
      moderateMaxExclusive: 0.55,
      highMaxExclusive: 0.8,
    });

    const scorerSource = readSource("scorers/EIVScorer.ts");
    expect(scorerSource).toContain("getEIVTier");
    ["0.15", "0.3", "0.55", "0.8"].forEach((literal) => {
      expect(scorerSource).not.toContain(literal);
    });

    const tiersSource = readSource("scorers/eivTiers.ts");
    expect(tiersSource).toContain("MASTER_CONSTANTS.eiv.tiers");
    ["0.15", "0.3", "0.55", "0.8"].forEach((literal) => {
      expect(tiersSource).not.toContain(literal);
    });
  });
});
