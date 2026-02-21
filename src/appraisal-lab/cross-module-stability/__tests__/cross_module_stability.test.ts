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
    expect(result.summary.maxEscalationLevel).toBeGreaterThanOrEqual(1);
    expect(result.summary.collapseCount / result.steps).toBeLessThanOrEqual(0.1);
    expect(result.summary.fractionCritical).toBeLessThanOrEqual(0.05);
    expect(result.summary.moodCategoryChanges).toBeLessThanOrEqual(
      0.35 * result.steps
    );
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
    expect(result.summary.maxEscalationLevel).toBeGreaterThanOrEqual(1);
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

  test("sanitization micro scenario records tags and finite outputs", () => {
    const scenario = byName("SUITE_SANITIZE_MICRO");
    const result = runScenario(111, scenario);
    expect(result.summary.sanitizationCount).toBeGreaterThan(0);
    expect(result.traceSample.some((s) => s.sanitizationTags.length > 0)).toBe(true);
    for (const s of result.traceSample) {
      expect(Number.isFinite(s.scalarPressure)).toBe(true);
      expect(Number.isFinite(s.escalationScore)).toBe(true);
      expect(Number.isFinite(s.moodConfidence)).toBe(true);
      expect(s.scalarPressure).toBeGreaterThanOrEqual(0);
    }
  });

  test("pressure-driven collapse path increments calm-escalation counter", () => {
    const scenario = byName("SUITE_PRESSURE_DRIVEN_COLLAPSE_MICRO");
    const result = runScenario(222, scenario);
    expect(result.summary.collapseWithCalmEscalationCount).toBeGreaterThan(0);
    const hasPressureReason = result.traceSample.some((s) =>
      s.collapseReasons.includes("TRIG_PRESSURE_CRIT")
    );
    expect(hasPressureReason).toBe(true);
  });

  test("long-gap micro scenario remains finite", () => {
    const scenario = byName("SUITE_LONG_GAP_MICRO");
    const result = runScenario(333, scenario);
    const hasHugeDelta = result.traceSample.some((s) => s.deltaMessageSeconds > 1000000);
    expect(hasHugeDelta).toBe(true);
    for (const s of result.traceSample) {
      expect(Number.isFinite(s.gain)).toBe(true);
      expect(Number.isFinite(s.scalarPressure)).toBe(true);
      expect(s.scalarPressure).toBeGreaterThanOrEqual(0);
    }
  });

  test("different seeds produce different deterministic hashes", () => {
    const scenario = byName("SUITE_C_LONG_SESSION_STABILITY");
    const a = runScenario(0x111, scenario);
    const b = runScenario(0x222, scenario);
    expect(a.summaryHash).not.toBe(b.summaryHash);
  });

  test("sampling branch toggles trace density", () => {
    const base = byName("SUITE_B_ESC_SUB_CONFLICT");
    const dense = runScenario(555, { ...base, traceSampleEvery: 1 });
    const sparse = runScenario(555, { ...base, traceSampleEvery: 50 });
    expect(dense.traceSample.length).toBeGreaterThan(sparse.traceSample.length);
  });

  test("default sampling and zero-step summary branches", () => {
    const base = byName("SUITE_B_ESC_SUB_CONFLICT");
    const result = runScenario(999, {
      name: base.name,
      steps: 0,
    });
    expect(result.traceSample.length).toBe(0);
    expect(result.summary.fractionCritical).toBe(0);
    expect(result.summary.postModeFraction).toBe(0);
  });

  test("inward collapse direction branch is reachable", () => {
    const scenario = byName("SUITE_INWARD_COLLAPSE_MICRO");
    const result = runScenario(444, scenario);
    const inwardCollapse = result.traceSample.find(
      (s) => s.collapseEvent && s.collapseDirection === "INWARD"
    );
    expect(inwardCollapse).toBeDefined();
  });

  test("fault injection branches throw invariant errors", () => {
    const base = byName("SUITE_B_ESC_SUB_CONFLICT");
    expect(() =>
      runScenario(1, { ...base, steps: 1, faultInjection: "NON_FINITE_OUTPUT" })
    ).toThrow(/Non-finite output/);
    expect(() =>
      runScenario(1, { ...base, steps: 1, faultInjection: "NEGATIVE_PRESSURE" })
    ).toThrow(/Negative pressure/);
    expect(() =>
      runScenario(1, { ...base, steps: 1, faultInjection: "NEGATIVE_FAMILY" })
    ).toThrow(/Negative family pressure/);
    expect(() =>
      runScenario(1, { ...base, steps: 1, faultInjection: "NEGATIVE_TIMER" })
    ).toThrow(/Negative timer/);
    expect(() =>
      runScenario(1, { ...base, steps: 1, faultInjection: "PRESSURE_CAP" })
    ).toThrow(/Pressure cap exceeded/);
  });
});
