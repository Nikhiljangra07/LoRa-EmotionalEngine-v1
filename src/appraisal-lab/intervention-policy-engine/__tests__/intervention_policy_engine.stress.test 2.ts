import { deriveInterventionPolicy } from "..";

const toneModes = new Set([
  "NEUTRAL",
  "DE_ESCALATE",
  "FIRM_CONTAIN",
  "REFLECTIVE",
  "STABILIZE",
  "AFFIRM_BOUNDARIED",
]);
const pacingModes = new Set([
  "NORMAL",
  "SLOW",
  "DELAYED_RESPONSE",
  "SHORT_DIRECT",
]);
const validationModes = new Set([
  "STANDARD",
  "LIMITED",
  "BOUNDARIED",
  "SUPPORTIVE",
]);
const actionModes = new Set([
  "NONE",
  "INTERRUPT_LOOP",
  "SHIFT_TO_REFLECTION",
  "ENCOURAGE_PAUSE",
]);

describe("intervention-policy-engine stress", () => {
  test("10k deterministic combinations remain valid", () => {
    let checked = 0;

    for (let i = 0; i < 10000; i += 1) {
      const escalationLevel = i % 5;
      const escalationScore = (i % 101) / 100;
      const collapseEvent = i % 17 === 0;
      const postModeActive = i % 3 !== 0;
      const recoveryPath =
        i % 4 === 0 ? "SPIRAL" : i % 4 === 1 ? "SUBSTITUTE" : "UNKNOWN";
      const agencyDeficit = (i % 100) / 100;

      const policy = deriveInterventionPolicy({
        escalationLevel,
        escalationScore,
        collapseEvent,
        collapseDirection: collapseEvent ? "OUTWARD" : "NONE",
        postModeActive,
        recoveryPath,
        agencyDeficit,
        moodCategory: i % 2 === 0 ? "NEUTRAL" : "ANXIOUS",
      });

      expect(toneModes.has(policy.toneMode)).toBe(true);
      expect(pacingModes.has(policy.pacingMode)).toBe(true);
      expect(validationModes.has(policy.validationMode)).toBe(true);
      expect(actionModes.has(policy.actionMode)).toBe(true);
      expect(policy.interruptionLevel).toBeGreaterThanOrEqual(0);
      expect(policy.interruptionLevel).toBeLessThanOrEqual(3);
      expect(Array.isArray(policy.guardrails)).toBe(true);
      expect(Array.isArray(policy.reasons)).toBe(true);

      // Contradiction guard: neutral policy cannot include interrupt-loop action.
      if (policy.toneMode === "NEUTRAL") {
        expect(policy.actionMode).toBe("NONE");
      }
      // Contradiction guard: highest interruption requires firm contain or spiral policy.
      if (policy.interruptionLevel === 3) {
        expect(["FIRM_CONTAIN", "STABILIZE"]).toContain(policy.toneMode);
      }

      checked += 1;
    }

    expect(checked).toBe(10000);
  });

  test("deterministic matrix across policy boundaries", () => {
    const recoveryPaths = ["SPIRAL", "SUBSTITUTE", "UNKNOWN"] as const;
    let checked = 0;

    for (const escalationLevel of [-1, 0, 1, 2, 3, 4]) {
      for (const collapseEvent of [true, false]) {
        for (const postModeActive of [true, false]) {
          for (const recoveryPath of recoveryPaths) {
            for (const agencyDeficit of [0, 0.4, 0.7, 1]) {
              expect(() =>
                deriveInterventionPolicy({
                  escalationLevel,
                  escalationScore: 0.5,
                  collapseEvent,
                  collapseDirection: collapseEvent ? "OUTWARD" : "NONE",
                  postModeActive,
                  recoveryPath,
                  agencyDeficit,
                })
              ).not.toThrow();

              const policy = deriveInterventionPolicy({
                escalationLevel,
                escalationScore: 0.5,
                collapseEvent,
                collapseDirection: collapseEvent ? "OUTWARD" : "NONE",
                postModeActive,
                recoveryPath,
                agencyDeficit,
              });

              expect(toneModes.has(policy.toneMode)).toBe(true);
              expect(pacingModes.has(policy.pacingMode)).toBe(true);
              expect(validationModes.has(policy.validationMode)).toBe(true);
              expect(actionModes.has(policy.actionMode)).toBe(true);
              expect(policy.interruptionLevel).toBeGreaterThanOrEqual(0);
              expect(policy.interruptionLevel).toBeLessThanOrEqual(3);

              if (policy.toneMode === "NEUTRAL") {
                expect(policy.actionMode).toBe("NONE");
              }
              if (policy.actionMode === "INTERRUPT_LOOP") {
                expect(policy.interruptionLevel).toBeGreaterThanOrEqual(2);
              }

              checked += 1;
            }
          }
        }
      }
    }

    expect(checked).toBe(6 * 2 * 2 * 3 * 4);
  });
});
