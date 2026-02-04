import { readFileSync } from "fs";
import path from "path";
import { MASTER_CONSTANTS } from "../../config/master.constants";

const TARGET_FILES = [
  path.resolve(
    __dirname,
    "..",
    "..",
    "engines",
    "EngineOrchestrator.ts"
  ),
  path.resolve(__dirname, "..", "..", "engines", "ETVEngine.ts"),
  path.resolve(
    __dirname,
    "..",
    "..",
    "processors",
    "EmotionalStateInterpreter.ts"
  ),
];

const forbiddenValues = Array.from(
  new Set(
    [
      MASTER_CONSTANTS.engineDefaults.initialETV,
      MASTER_CONSTANTS.stateClassification.relationshipStyle
        .professionalMaxExclusive,
      MASTER_CONSTANTS.stateClassification.relationshipStyle
        .friendlyMaxExclusive,
      MASTER_CONSTANTS.stateClassification.eivTier.lowMaxExclusive,
      MASTER_CONSTANTS.stateClassification.eivTier.mediumMaxExclusive,
      MASTER_CONSTANTS.stateClassification.eivTier.highMaxExclusive,
      MASTER_CONSTANTS.stateClassification.arousalFromEiv
        .highMinInclusive,
      MASTER_CONSTANTS.stateClassification.arousalFromEiv
        .mediumMinInclusive,
      MASTER_CONSTANTS.etvRecovery.baseRate,
      MASTER_CONSTANTS.etvRecovery.minSessionEivForRecovery,
      MASTER_CONSTANTS.etvRecovery.bias.highMinInclusive,
      MASTER_CONSTANTS.etvRecovery.bias.midMinInclusive,
      MASTER_CONSTANTS.etvRecovery.bias.high,
      MASTER_CONSTANTS.etvRecovery.bias.mid,
      MASTER_CONSTANTS.etvRecovery.bias.low,
      MASTER_CONSTANTS.etvRecovery.avgRecoveryPerSession,
      MASTER_CONSTANTS.penalties.etvViolation,
    ].map((value) => String(value))
  )
);

const containsLiteral = (source: string, literal: string) => {
  const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|[^\\d.])${escaped}([^\\d.]|$)`);
  return pattern.test(source);
};

describe("Threshold centralization", () => {
  it("engine logic must not hardcode threshold literals", () => {
    TARGET_FILES.forEach((filePath) => {
      const source = readFileSync(filePath, "utf8");
      forbiddenValues.forEach((value) => {
        expect(containsLiteral(source, value)).toBe(false);
      });
    });
  });
});
