import { AGENCY_HIGH, ESC_CRITICAL, ESC_RISING } from "..";
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
});
