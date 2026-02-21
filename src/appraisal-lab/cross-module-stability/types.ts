export type ScenarioName =
  | "SUITE_A_FAMILY_OSCILLATION"
  | "SUITE_B_ESC_SUB_CONFLICT"
  | "SUITE_C_LONG_SESSION_STABILITY"
  | "SUITE_SANITIZE_MICRO"
  | "SUITE_PRESSURE_DRIVEN_COLLAPSE_MICRO"
  | "SUITE_LONG_GAP_MICRO"
  | "SUITE_INWARD_COLLAPSE_MICRO";

export type ScenarioSpec = {
  name: ScenarioName;
  steps: number;
  traceSampleEvery?: number;
  faultInjection?:
    | "NONE"
    | "NON_FINITE_OUTPUT"
    | "NEGATIVE_PRESSURE"
    | "NEGATIVE_FAMILY"
    | "NEGATIVE_TIMER"
    | "PRESSURE_CAP";
};

export type StepTrace = {
  i: number;
  deltaMessageSeconds: number;
  deltaSessionSeconds: number;
  gain: number;
  familyTop: string;
  familyConfidence: number;
  moodCategory: string;
  moodConfidence: number;
  scalarPressure: number;
  vectorTotalPressure: number;
  vectorDominantFamily: string;
  escalationLevel: number;
  escalationScore: number;
  collapseEvent: boolean;
  collapseDirection: string;
  collapseReasons: string[];
  postModeActive: boolean;
  recoveryPath: "SPIRAL" | "SUBSTITUTE" | "UNKNOWN";
  postReasons: string[];
  interruptionLevel: 0 | 1 | 2 | 3;
  policyMovesTags: string[];
  sanitizationTags: string[];
};

export type ScenarioResult = {
  scenario: ScenarioName;
  seed: number;
  steps: number;
  summaryHash: string;
  summary: {
    collapseCount: number;
    firstCollapseIndex: number | null;
    criticalSteps: number;
    fractionCritical: number;
    postModeSteps: number;
    postModeFraction: number;
    moodCategoryChanges: number;
    maxEscalationLevel: number;
    maxEscalationScore: number;
    maxScalarPressure: number;
    maxVectorPressure: number;
    maxFamilyPressure: number;
    everSubstitute: boolean;
    everSpiral: boolean;
    sanitizationCount: number;
    collapseWithCalmEscalationCount: number;
    collapseWithHighEscalationCount: number;
  };
  traceSample: StepTrace[];
};
