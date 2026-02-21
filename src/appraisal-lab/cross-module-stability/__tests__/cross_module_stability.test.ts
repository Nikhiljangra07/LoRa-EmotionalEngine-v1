import { getCrossModuleScenarios } from "../scenarios";
import { runScenario } from "../runner";

function byName(name: string) {
  const scenario = getCrossModuleScenarios().find((s) => s.name === name);
  if (!scenario) {
    throw new Error(`Missing scenario ${name}`);
  }
  return scenario;
}

describe("cross-module stability harness", () => {
  test("SUITE A - Family Oscillation Stress", () => {
    const scenario = byName("SUITE_A_FAMILY_OSCILLATION");
    const result = runScenario(0xaaa111, scenario);

    console.log(
      JSON.stringify({
        suite: "A",
        hash: result.summaryHash,
        summary: result.summary,
      })
    );

    expect(result.steps).toBe(600);
    expect(result.summary.maxFamilyPressure).toBeLessThanOrEqual(1e6);
    expect(result.summary.maxVectorPressure).toBeLessThanOrEqual(1e6);
    expect(result.summary.maxScalarPressure).toBeLessThanOrEqual(1e6);
    expect(result.summary.collapseCount / result.steps).toBeLessThanOrEqual(0.1);
    expect(result.summary.moodCategoryChanges).toBeLessThanOrEqual(
      0.35 * result.steps
    );
    const criticalNotInPostModeFraction =
      (result.summary.criticalSteps - result.summary.postModeSteps > 0
        ? result.summary.criticalSteps - result.summary.postModeSteps
        : 0) / result.steps;
    expect(criticalNotInPostModeFraction).toBeLessThanOrEqual(0.05);
    expect(result.summary.sanitizationCount).toBe(0);
  });

  test("SUITE B - Escalation vs Substitute Conflict", () => {
    const scenario = byName("SUITE_B_ESC_SUB_CONFLICT");
    const result = runScenario(0xbbb222, scenario);

    console.log(
      JSON.stringify({
        suite: "B",
        hash: result.summaryHash,
        summary: result.summary,
      })
    );

    expect(result.summary.everSubstitute).toBe(true);
    expect(result.summary.maxEscalationLevel).toBeGreaterThanOrEqual(2);
    expect(result.summary.collapseCount).toBeLessThanOrEqual(2);

    const sawHighEscWithFirmPolicy = result.traceSample.some(
      (s) => s.escalationLevel >= 2 && s.interruptionLevel >= 2
    );
    expect(sawHighEscWithFirmPolicy).toBe(true);

    for (const s of result.traceSample) {
      const validPath =
        s.recoveryPath === "SPIRAL" ||
        s.recoveryPath === "SUBSTITUTE" ||
        s.recoveryPath === "UNKNOWN";
      expect(validPath).toBe(true);
      if (s.recoveryPath === "UNKNOWN" && s.postModeActive) {
        const hasAmbiguousReason = s.postReasons.includes("RECOVERY_AMBIGUOUS");
        const hasNonAmbiguous =
          s.postReasons.includes("POST_MODE_ACTIVE") ||
          s.postReasons.includes("TRIGGER");
        expect(hasAmbiguousReason || hasNonAmbiguous).toBe(true);
      }
    }
  });

  test("SUITE C - Long Session Stability (100k)", () => {
    const scenario = byName("SUITE_C_LONG_SESSION_STABILITY");
    const result = runScenario(0xccc333, scenario);
    const replay = runScenario(0xccc333, scenario);

    console.log(
      JSON.stringify({
        suite: "C",
        hash: result.summaryHash,
        summary: result.summary,
      })
    );

    expect(result.summaryHash).toBe(replay.summaryHash);
    expect(result.summary).toEqual(replay.summary);
    expect(result.summary.maxScalarPressure).toBeLessThanOrEqual(1e6);
    expect(result.summary.maxVectorPressure).toBeLessThanOrEqual(1e6);
    expect(result.summary.maxFamilyPressure).toBeLessThanOrEqual(1e6);
    expect(result.summary.fractionCritical).toBeLessThanOrEqual(0.02);
    expect(result.summary.collapseCount).toBeLessThanOrEqual(0.005 * result.steps);
    expect(result.summary.postModeFraction).toBeLessThanOrEqual(0.1);
    expect(result.summary.sanitizationCount).toBe(0);
  });

  test("determinism replay check", () => {
    const scenario = byName("SUITE_A_FAMILY_OSCILLATION");
    const a = runScenario(12345, scenario);
    const b = runScenario(12345, scenario);
    expect(a.summaryHash).toBe(b.summaryHash);
    expect(a.summary).toEqual(b.summary);
  });
});
