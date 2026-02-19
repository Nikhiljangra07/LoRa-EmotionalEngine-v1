/**
 * Layer-2: Ekman-6 Behavior Inspector v1.3
 *
 * Runs the v2 inspector logic with only the final/default configuration
 * and writes a versioned markdown report.
 *
 * Usage:
 *   npx ts-node src/appraisal-lab/layer2/inspect_ekman6_behavior_v1_3.ts
 */

import { DEFAULT_CONFIG, Ekman6InferenceConfig } from "./infer_ekman6";
import {
  TEST_CASES,
  AblationConfig,
  runEkman6AblationInspection,
} from "./inspect_ekman6_behavior_v2";

function main(): void {
  const finalOnly: AblationConfig[] = [
    {
      label: "D) DEFAULT_CONFIG only (v1.3)",
      tag: "D",
      config: { ...DEFAULT_CONFIG } as Ekman6InferenceConfig,
    },
  ];

  runEkman6AblationInspection(
    finalOnly,
    TEST_CASES,
    "docs/layer2/inspect_ekman6_behavior_v1_3.md",
    "Ekman6 Behavior Inspection v1.3 (Default Config Only)"
  );
}

main();
