/**
 * Layer-2: Ekman-6 Inference Behavior Inspection
 *
 * Runs 5 hardcoded appraisal vectors through the Ekman-6 experimental
 * inference pipeline and logs posterior, entropy, margin, and decision.
 *
 * Fully isolated — no runtime imports.
 *
 * Usage:
 *   npx ts-node src/appraisal-lab/layer2/inspect_ekman6_behavior.ts
 */

import { inferEkman6, AppraisalBins } from "./infer_ekman6";

// ============================================================
// Test vectors
// ============================================================

interface TestCase {
  label: string;
  description: string;
  bins: AppraisalBins;
  expectation: string;
}

// Bins must match the actual bin spaces:
//   valence:       NEG | NEU | POS
//   arousal:       LOW | MED | HIGH
//   agency:        SELF | OTHER | SITUATION
//   control:       LOW | MED | HIGH
//   certainty:     LOW | HIGH          (2-bin only)
//   goalRelevance: LOW | HIGH          (2-bin only)

const TEST_CASES: TestCase[] = [
  {
    label: "Classic ANGER",
    description: "NEG valence, HIGH arousal, OTHER agency, MED control, HIGH certainty, HIGH goal",
    bins: {
      valence: "NEG",
      arousal: "HIGH",
      agency: "OTHER",
      control: "MED",
      certainty: "HIGH",
      goalRelevance: "HIGH",
    },
    expectation: "top = ANGER, decision = COMMIT",
  },
  {
    label: "Classic FEAR",
    description: "NEG valence, HIGH arousal, SITUATION agency, LOW control, LOW certainty, HIGH goal",
    bins: {
      valence: "NEG",
      arousal: "HIGH",
      agency: "SITUATION",
      control: "LOW",
      certainty: "LOW",
      goalRelevance: "HIGH",
    },
    expectation: "top = FEAR, decision = COMMIT",
  },
  {
    label: "Classic SADNESS",
    description: "NEG valence, MED arousal, SITUATION agency, LOW control, LOW certainty, HIGH goal",
    bins: {
      valence: "NEG",
      arousal: "MED",
      agency: "SITUATION",
      control: "LOW",
      certainty: "LOW",
      goalRelevance: "HIGH",
    },
    expectation: "top = SADNESS or FEAR, decision = COMMIT or HEDGE",
  },
  {
    label: "Neutral routine",
    description: "NEU valence, LOW arousal, SELF agency, MED control, HIGH certainty, LOW goal",
    bins: {
      valence: "NEU",
      arousal: "LOW",
      agency: "SELF",
      control: "MED",
      certainty: "HIGH",
      goalRelevance: "LOW",
    },
    expectation: "top = NEUTRAL, decision = COMMIT or HEDGE",
  },
  {
    label: "Ambiguous ANGER/FEAR",
    description: "NEG valence, HIGH arousal, OTHER agency, LOW control, LOW certainty, HIGH goal",
    bins: {
      valence: "NEG",
      arousal: "HIGH",
      agency: "OTHER",
      control: "LOW",
      certainty: "LOW",
      goalRelevance: "HIGH",
    },
    expectation: "ANGER/FEAR competitive, harmful-pair → HEDGE if margin < 0.15",
  },
];

// ============================================================
// Formatting
// ============================================================

function fmtPosterior(posterior: Record<string, number>): string {
  return Object.entries(posterior)
    .sort((a, b) => b[1] - a[1])
    .map(([emo, p]) => `    ${emo.padEnd(10)} ${p.toFixed(4)}`)
    .join("\n");
}

// ============================================================
// Main
// ============================================================

function main(): void {
  console.log("=== Layer-2: Ekman-6 Inference Behavior Inspection ===\n");

  let allOk = true;

  for (const tc of TEST_CASES) {
    console.log("─".repeat(56));
    console.log(`  ${tc.label}`);
    console.log(`  ${tc.description}`);
    console.log("─".repeat(56));

    const result = inferEkman6(tc.bins);
    const d = result.diagnostics;

    console.log("");
    console.log("  Posterior:");
    console.log(fmtPosterior(result.posterior));
    console.log("");
    console.log(`  Top emotion  : ${result.topEmotion}`);
    console.log(`  Decision     : ${result.decision}`);
    console.log(`  pmax         : ${d.pmax.toFixed(4)}`);
    console.log(`  margin       : ${d.margin.toFixed(4)}`);
    console.log(`  entropy_norm : ${d.entropyNorm.toFixed(4)}`);
    console.log(`  harmful-pair : ${d.harmfulPairOverride ? "YES (override applied)" : "no"}`);
    console.log(`  expected     : ${tc.expectation}`);
    console.log("");

    // Basic sanity assertions (non-fatal, just warnings)
    if (tc.label === "Classic ANGER" && result.topEmotion !== "ANGER") {
      console.log("  *** WARNING: Expected ANGER as top emotion ***");
      allOk = false;
    }
    if (tc.label === "Classic FEAR" && result.topEmotion !== "FEAR") {
      console.log("  *** WARNING: Expected FEAR as top emotion ***");
      allOk = false;
    }
    if (tc.label === "Neutral routine" && result.topEmotion === "JOY") {
      console.log("  *** WARNING: Neutral collapsed into JOY ***");
      allOk = false;
    }
    if (tc.label === "Ambiguous ANGER/FEAR" && result.decision === "COMMIT") {
      console.log("  *** WARNING: Expected HEDGE for ambiguous anger/fear ***");
      allOk = false;
    }
  }

  console.log("═".repeat(56));
  if (allOk) {
    console.log("  All behavioral checks passed.");
  } else {
    console.log("  Some behavioral checks had warnings (see above).");
  }
  console.log("═".repeat(56));
  console.log("\nDone. No files modified.");
}

main();
