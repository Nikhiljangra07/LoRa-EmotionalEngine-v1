import { TRACE_SAMPLE_EVERY_DEFAULT } from "./constants";
import type { ScenarioSpec } from "./types";

export function getCrossModuleScenarios(): ScenarioSpec[] {
  return [
    {
      name: "SUITE_A_FAMILY_OSCILLATION",
      steps: 600,
      traceSampleEvery: 1,
    },
    {
      name: "SUITE_B_ESC_SUB_CONFLICT",
      steps: 180,
      traceSampleEvery: 1,
    },
    {
      name: "SUITE_C_LONG_SESSION_STABILITY",
      steps: 100000,
      traceSampleEvery: TRACE_SAMPLE_EVERY_DEFAULT,
    },
    {
      name: "SUITE_SANITIZE_MICRO",
      steps: 5,
      traceSampleEvery: 1,
    },
    {
      name: "SUITE_PRESSURE_DRIVEN_COLLAPSE_MICRO",
      steps: 8,
      traceSampleEvery: 1,
    },
    {
      name: "SUITE_LONG_GAP_MICRO",
      steps: 3,
      traceSampleEvery: 1,
    },
    {
      name: "SUITE_INWARD_COLLAPSE_MICRO",
      steps: 24,
      traceSampleEvery: 1,
    },
  ];
}
