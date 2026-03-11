import { AGENCY_HIGH, AGENCY_MED, ESC_CRITICAL, ESC_RISING } from "..";
import { deriveInterventionPolicy } from "..";

const baseInput = {
  escalationLevel: 0,
  escalationScore: 0,
  collapseEvent: false,
  collapseDirection: "NONE",
  postModeActive: false,
  recoveryPath: "UNKNOWN" as const,
  agencyDeficit: 0,
};

describe("intervention-policy-engine", () => {
  test("baseline", () => {
    const policy = deriveInterventionPolicy(baseInput);
    expect(policy).toEqual({
      toneMode: "NEUTRAL",
      pacingMode: "NORMAL",
      validationMode: "STANDARD",
      actionMode: "NONE",
      interruptionLevel: 0,
      guardrails: [],
      reasons: ["BASELINE"],
    });
  });

  test("escalation rising", () => {
    const policy = deriveInterventionPolicy({
      ...baseInput,
      escalationLevel: ESC_RISING,
      escalationScore: 0.55,
    });
    expect(policy.toneMode).toBe("DE_ESCALATE");
    expect(policy.pacingMode).toBe("SLOW");
    expect(policy.validationMode).toBe("LIMITED");
    expect(policy.actionMode).toBe("SHIFT_TO_REFLECTION");
    expect(policy.interruptionLevel).toBe(1);
    expect(policy.reasons).toContain("ESC_RISING");
  });

  test("boundary: escalationLevel exactly ESC_RISING", () => {
    const policy = deriveInterventionPolicy({
      ...baseInput,
      escalationLevel: ESC_RISING,
      escalationScore: 0.01,
    });
    expect(policy.reasons).toContain("ESC_RISING");
    expect(policy.toneMode).toBe("DE_ESCALATE");
  });

  test("escalation critical", () => {
    const policy = deriveInterventionPolicy({
      ...baseInput,
      escalationLevel: ESC_CRITICAL,
      escalationScore: 0.98,
    });
    expect(policy.toneMode).toBe("FIRM_CONTAIN");
    expect(policy.pacingMode).toBe("SHORT_DIRECT");
    expect(policy.validationMode).toBe("BOUNDARIED");
    expect(policy.actionMode).toBe("INTERRUPT_LOOP");
    expect(policy.interruptionLevel).toBe(3);
    expect(policy.guardrails).toContain("NO_ACTION_ESCALATION");
    expect(policy.reasons).toContain("ESC_CRITICAL");
  });

  test("boundary: escalationLevel exactly ESC_CRITICAL", () => {
    const policy = deriveInterventionPolicy({
      ...baseInput,
      escalationLevel: ESC_CRITICAL,
      escalationScore: 0.2,
    });
    expect(policy.reasons).toContain("ESC_CRITICAL");
    expect(policy.interruptionLevel).toBe(3);
  });

  test("collapse", () => {
    const policy = deriveInterventionPolicy({
      ...baseInput,
      escalationLevel: ESC_CRITICAL,
      collapseEvent: true,
    });
    expect(policy.toneMode).toBe("STABILIZE");
    expect(policy.pacingMode).toBe("SLOW");
    expect(policy.validationMode).toBe("SUPPORTIVE");
    expect(policy.actionMode).toBe("ENCOURAGE_PAUSE");
    expect(policy.interruptionLevel).toBe(2);
    expect(policy.reasons).toContain("COLLAPSE_EVENT");
  });

  test("post spiral", () => {
    const policy = deriveInterventionPolicy({
      ...baseInput,
      postModeActive: true,
      recoveryPath: "SPIRAL",
      escalationLevel: 1,
    });
    expect(policy.toneMode).toBe("FIRM_CONTAIN");
    expect(policy.pacingMode).toBe("DELAYED_RESPONSE");
    expect(policy.validationMode).toBe("BOUNDARIED");
    expect(policy.actionMode).toBe("INTERRUPT_LOOP");
    expect(policy.interruptionLevel).toBe(3);
    expect(policy.guardrails).toContain("NO_REINFORCE_LOOP");
    expect(policy.reasons).toContain("POST_SPIRAL");
  });

  test("post substitute", () => {
    const policy = deriveInterventionPolicy({
      ...baseInput,
      postModeActive: true,
      recoveryPath: "SUBSTITUTE",
    });
    expect(policy.toneMode).toBe("AFFIRM_BOUNDARIED");
    expect(policy.pacingMode).toBe("SLOW");
    expect(policy.validationMode).toBe("SUPPORTIVE");
    expect(policy.actionMode).toBe("SHIFT_TO_REFLECTION");
    expect(policy.interruptionLevel).toBe(1);
    expect(policy.guardrails).toContain("AVOID_OVERVALIDATION");
    expect(policy.reasons).toContain("POST_SUBSTITUTE");
  });

  test("agency high modifies guardrails", () => {
    const policy = deriveInterventionPolicy({
      ...baseInput,
      postModeActive: true,
      recoveryPath: "SUBSTITUTE",
      agencyDeficit: AGENCY_HIGH,
    });
    expect(policy.guardrails).toContain("RESTORE_AGENCY");
    expect(policy.reasons).toContain("AGENCY_HIGH");
  });

  test("priority: collapse overrides post mode", () => {
    const policy = deriveInterventionPolicy({
      ...baseInput,
      collapseEvent: true,
      postModeActive: true,
      recoveryPath: "SPIRAL",
      escalationLevel: ESC_CRITICAL,
      escalationScore: 1,
      agencyDeficit: 0.9,
    });
    expect(policy.toneMode).toBe("STABILIZE");
    expect(policy.reasons).toContain("COLLAPSE_EVENT");
    expect(policy.reasons).not.toContain("POST_SPIRAL");
  });

  test("postModeActive + UNKNOWN recoveryPath does not enter post branches", () => {
    const policy = deriveInterventionPolicy({
      ...baseInput,
      postModeActive: true,
      recoveryPath: "UNKNOWN",
      escalationLevel: 0,
    });
    expect(policy.reasons).toContain("BASELINE");
    expect(policy.reasons).not.toContain("POST_SPIRAL");
    expect(policy.reasons).not.toContain("POST_SUBSTITUTE");
  });

  test("agencyDeficit exactly AGENCY_HIGH adds restore guardrail", () => {
    const policy = deriveInterventionPolicy({
      ...baseInput,
      postModeActive: true,
      recoveryPath: "SUBSTITUTE",
      agencyDeficit: AGENCY_HIGH,
    });
    expect(policy.guardrails).toContain("RESTORE_AGENCY");
    expect(policy.reasons).toContain("AGENCY_HIGH");
  });

  test("agencyDeficit exactly AGENCY_MED does not add agency-high overlays", () => {
    const policy = deriveInterventionPolicy({
      ...baseInput,
      postModeActive: true,
      recoveryPath: "SUBSTITUTE",
      agencyDeficit: AGENCY_MED,
    });
    expect(policy.guardrails).not.toContain("RESTORE_AGENCY");
    expect(policy.reasons).not.toContain("AGENCY_HIGH");
  });

  test("negative escalationLevel resolves safely to baseline", () => {
    const policy = deriveInterventionPolicy({
      ...baseInput,
      escalationLevel: -1,
      escalationScore: 0.9,
    });
    expect(policy.reasons).toContain("BASELINE");
    expect(policy.interruptionLevel).toBe(0);
  });

  test("high escalationScore with low escalationLevel does not trigger critical", () => {
    const policy = deriveInterventionPolicy({
      ...baseInput,
      escalationLevel: 0,
      escalationScore: 0.999,
    });
    expect(policy.reasons).toContain("BASELINE");
    expect(policy.reasons).not.toContain("ESC_CRITICAL");
    expect(policy.toneMode).toBe("NEUTRAL");
  });

  test("non-finite escalationLevel and agencyDeficit are sanitized to baseline-safe defaults", () => {
    const policy = deriveInterventionPolicy({
      ...baseInput,
      escalationLevel: Number.NaN,
      agencyDeficit: Number.POSITIVE_INFINITY,
      postModeActive: false,
    });
    expect(policy.reasons).toContain("BASELINE");
    expect(policy.guardrails).not.toContain("RESTORE_AGENCY");
  });

  test("agency-high overlay no-op when includes already true path is simulated", () => {
    const originalIncludes = Array.prototype.includes;
    Array.prototype.includes = function includesOverride(
      this: unknown[],
      searchElement: unknown,
      fromIndex?: number
    ): boolean {
      if (searchElement === "RESTORE_AGENCY" || searchElement === "AGENCY_HIGH") {
        return true;
      }
      return originalIncludes.call(this, searchElement, fromIndex);
    };

    try {
      const policy = deriveInterventionPolicy({
        ...baseInput,
        postModeActive: true,
        recoveryPath: "SUBSTITUTE",
        agencyDeficit: AGENCY_HIGH,
      });

      expect(policy.guardrails).toEqual(["AVOID_OVERVALIDATION"]);
      expect(policy.reasons).toEqual(["POST_SUBSTITUTE"]);
    } finally {
      Array.prototype.includes = originalIncludes;
    }
  });
});
