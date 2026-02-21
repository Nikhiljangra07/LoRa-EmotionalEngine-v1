import { AGENCY_HIGH, ESC_CRITICAL, ESC_RISING } from "./constants";
import type { InterventionInputs, InterventionPolicy } from "./types";

export function deriveInterventionPolicy(
  input: InterventionInputs
): InterventionPolicy {
  const escalationLevel = Number.isFinite(input.escalationLevel)
    ? input.escalationLevel
    : 0;
  const collapseEvent = Boolean(input.collapseEvent);
  const postModeActive = Boolean(input.postModeActive);
  const recoveryPath = input.recoveryPath;
  const agencyDeficit = Number.isFinite(input.agencyDeficit)
    ? input.agencyDeficit
    : 0;

  let policy: InterventionPolicy;

  // Priority: Collapse > Post-Spiral > Post-Substitute > EscCritical > EscRising > Baseline
  if (collapseEvent) {
    policy = {
      toneMode: "STABILIZE",
      pacingMode: "SLOW",
      validationMode: "SUPPORTIVE",
      actionMode: "ENCOURAGE_PAUSE",
      interruptionLevel: 2,
      guardrails: [],
      reasons: ["COLLAPSE_EVENT"],
    };
  } else if (postModeActive && recoveryPath === "SPIRAL") {
    policy = {
      toneMode: "FIRM_CONTAIN",
      pacingMode: "DELAYED_RESPONSE",
      validationMode: "BOUNDARIED",
      actionMode: "INTERRUPT_LOOP",
      interruptionLevel: 3,
      guardrails: ["NO_REINFORCE_LOOP"],
      reasons: ["POST_SPIRAL"],
    };
  } else if (postModeActive && recoveryPath === "SUBSTITUTE") {
    policy = {
      toneMode: "AFFIRM_BOUNDARIED",
      pacingMode: "SLOW",
      validationMode: "SUPPORTIVE",
      actionMode: "SHIFT_TO_REFLECTION",
      interruptionLevel: 1,
      guardrails: ["AVOID_OVERVALIDATION"],
      reasons: ["POST_SUBSTITUTE"],
    };
  } else if (escalationLevel >= ESC_CRITICAL) {
    policy = {
      toneMode: "FIRM_CONTAIN",
      pacingMode: "SHORT_DIRECT",
      validationMode: "BOUNDARIED",
      actionMode: "INTERRUPT_LOOP",
      interruptionLevel: 3,
      guardrails: ["NO_ACTION_ESCALATION"],
      reasons: ["ESC_CRITICAL"],
    };
  } else if (escalationLevel >= ESC_RISING) {
    policy = {
      toneMode: "DE_ESCALATE",
      pacingMode: "SLOW",
      validationMode: "LIMITED",
      actionMode: "SHIFT_TO_REFLECTION",
      interruptionLevel: 1,
      guardrails: [],
      reasons: ["ESC_RISING"],
    };
  } else {
    policy = {
      toneMode: "NEUTRAL",
      pacingMode: "NORMAL",
      validationMode: "STANDARD",
      actionMode: "NONE",
      interruptionLevel: 0,
      guardrails: [],
      reasons: ["BASELINE"],
    };
  }

  if (postModeActive && agencyDeficit >= AGENCY_HIGH) {
    if (!policy.guardrails.includes("RESTORE_AGENCY")) {
      policy.guardrails.push("RESTORE_AGENCY");
    }
    if (!policy.reasons.includes("AGENCY_HIGH")) {
      policy.reasons.push("AGENCY_HIGH");
    }
  }

  return policy;
}
