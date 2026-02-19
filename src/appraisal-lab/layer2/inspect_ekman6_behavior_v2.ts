/**
 * Layer-2: Ekman-6 Ablation Inspector (v2)
 *
 * Runs 5 behavioral test vectors under 4 inference configurations
 * to isolate the effect of each improvement:
 *
 *   A) Learned priors + tiered weights (baseline)
 *   B) Uniform priors + tiered weights
 *   C) Uniform priors + linear floor weights
 *   D) Uniform priors + linear floor weights + pair-aware boost
 *
 * Fully isolated — no runtime imports.
 *
 * Usage:
 *   npx ts-node src/appraisal-lab/layer2/inspect_ekman6_behavior_v2.ts
 */

import { inferEkman6, AppraisalBins, Ekman6InferenceConfig, DEFAULT_CONFIG } from "./infer_ekman6";

// ============================================================
// Test vectors (same 5 as v1, with valid bin spaces)
// ============================================================

interface TestCase {
  label: string;
  bins: AppraisalBins;
  expectation: string;
}

const TEST_CASES: TestCase[] = [
  {
    label: "Classic ANGER",
    bins: {
      valence: "NEG",
      arousal: "HIGH",
      agency: "OTHER",
      control: "MED",
      certainty: "HIGH",
      goalRelevance: "HIGH",
    },
    expectation: "ANGER top",
  },
  {
    label: "Classic FEAR",
    bins: {
      valence: "NEG",
      arousal: "HIGH",
      agency: "SITUATION",
      control: "LOW",
      certainty: "LOW",
      goalRelevance: "HIGH",
    },
    expectation: "FEAR top",
  },
  {
    label: "Classic SADNESS",
    bins: {
      valence: "NEG",
      arousal: "MED",
      agency: "SITUATION",
      control: "LOW",
      certainty: "LOW",
      goalRelevance: "HIGH",
    },
    expectation: "SADNESS top",
  },
  {
    label: "Neutral routine",
    bins: {
      valence: "NEU",
      arousal: "LOW",
      agency: "SELF",
      control: "MED",
      certainty: "HIGH",
      goalRelevance: "LOW",
    },
    expectation: "NEUTRAL top",
  },
  {
    label: "Ambiguous ANGER/FEAR",
    bins: {
      valence: "NEG",
      arousal: "HIGH",
      agency: "OTHER",
      control: "LOW",
      certainty: "LOW",
      goalRelevance: "HIGH",
    },
    expectation: "HEDGE decision",
  },
];

// ============================================================
// 4 ablation configurations
// ============================================================

interface AblationConfig {
  label: string;
  tag: string;
  config: Ekman6InferenceConfig;
}

const ABLATIONS: AblationConfig[] = [
  {
    label: "A) Learned priors + tiered weights (baseline)",
    tag: "A",
    config: {
      PRIOR_MODE: "learned",
      WEIGHT_MODE: "tiered",
      PAIR_AWARE_BOOST: false,
      WEIGHT_FLOOR: 0.30,
      WEIGHT_SLOPE: 0.70,
      CONTROL_MIN_BOOST: 0.45,
      CERTAINTY_MIN_BOOST: 0.45,
      AROUSAL_MIN_BOOST: 0.35,
    },
  },
  {
    label: "B) Uniform priors + tiered weights",
    tag: "B",
    config: {
      PRIOR_MODE: "uniform",
      WEIGHT_MODE: "tiered",
      PAIR_AWARE_BOOST: false,
      WEIGHT_FLOOR: 0.30,
      WEIGHT_SLOPE: 0.70,
      CONTROL_MIN_BOOST: 0.45,
      CERTAINTY_MIN_BOOST: 0.45,
      AROUSAL_MIN_BOOST: 0.35,
    },
  },
  {
    label: "C) Uniform priors + linear floor weights",
    tag: "C",
    config: {
      PRIOR_MODE: "uniform",
      WEIGHT_MODE: "linear_floor",
      PAIR_AWARE_BOOST: false,
      WEIGHT_FLOOR: 0.30,
      WEIGHT_SLOPE: 0.70,
      CONTROL_MIN_BOOST: 0.45,
      CERTAINTY_MIN_BOOST: 0.45,
      AROUSAL_MIN_BOOST: 0.35,
    },
  },
  {
    label: "D) Uniform priors + linear floor + pair boost (DEFAULT)",
    tag: "D",
    config: { ...DEFAULT_CONFIG },
  },
];

// ============================================================
// Formatting helpers
// ============================================================

function fmt(n: number, d = 4): string {
  return n.toFixed(d);
}

function topN(posterior: Record<string, number>, n: number): { emo: string; p: number }[] {
  return Object.entries(posterior)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([emo, p]) => ({ emo, p }));
}

// ============================================================
// Main
// ============================================================

function main(): void {
  console.log("=== Layer-2: Ekman-6 Ablation Inspector (v2) ===");
  console.log("");

  // Summary comparison table
  const summaryRows: string[] = [];
  summaryRows.push(
    "| Config | Vector | Top-1 | pmax | Margin | H_norm | Decision | Boost? |"
  );
  summaryRows.push(
    "|--------|--------|-------|------|--------|--------|----------|--------|"
  );

  for (const abl of ABLATIONS) {
    console.log("═".repeat(64));
    console.log(`  ${abl.label}`);
    console.log("═".repeat(64));
    console.log("");

    for (const tc of TEST_CASES) {
      const result = inferEkman6(tc.bins, abl.config);
      const d = result.diagnostics;
      const top3 = topN(result.posterior, 3);

      console.log(`  ── ${tc.label} ──`);
      console.log(`     Top-3: ${top3.map((t) => `${t.emo}(${fmt(t.p)})`).join("  ")}`);
      console.log(
        `     pmax=${fmt(d.pmax)}  margin=${fmt(d.margin)}  H_norm=${fmt(d.entropyNorm)}  decision=${result.decision}${d.pairBoostApplied ? "  [BOOSTED]" : ""}`
      );
      console.log(`     expected: ${tc.expectation}`);
      console.log("");

      summaryRows.push(
        `| ${abl.tag} | ${tc.label.padEnd(20)} | ${result.topEmotion.padEnd(8)} | ${fmt(d.pmax)} | ${fmt(d.margin)} | ${fmt(d.entropyNorm)} | ${result.decision.padEnd(7)} | ${d.pairBoostApplied ? "YES" : "-"} |`
      );
    }
  }

  // Print compact summary table
  console.log("");
  console.log("═".repeat(64));
  console.log("  COMPACT SUMMARY TABLE");
  console.log("═".repeat(64));
  console.log("");
  for (const row of summaryRows) {
    console.log(row);
  }
  console.log("");

  // Highlight key comparisons
  console.log("─".repeat(64));
  console.log("  KEY OBSERVATIONS");
  console.log("─".repeat(64));
  console.log("");

  // Compare anger across configs
  const angerBins = TEST_CASES[0].bins;
  const rA = inferEkman6(angerBins, ABLATIONS[0].config);
  const rB = inferEkman6(angerBins, ABLATIONS[1].config);
  const rC = inferEkman6(angerBins, ABLATIONS[2].config);
  const rD = inferEkman6(angerBins, ABLATIONS[3].config);

  console.log("  Classic ANGER — top emotion progression:");
  console.log(`    A (learned+tiered):      ${rA.topEmotion} (${fmt(rA.diagnostics.pmax)})`);
  console.log(`    B (uniform+tiered):      ${rB.topEmotion} (${fmt(rB.diagnostics.pmax)})`);
  console.log(`    C (uniform+floor):       ${rC.topEmotion} (${fmt(rC.diagnostics.pmax)})`);
  console.log(`    D (uniform+floor+boost): ${rD.topEmotion} (${fmt(rD.diagnostics.pmax)})${rD.diagnostics.pairBoostApplied ? " [BOOSTED]" : ""}`);
  console.log("");

  // Compare fear across configs
  const fearBins = TEST_CASES[1].bins;
  const fA = inferEkman6(fearBins, ABLATIONS[0].config);
  const fB = inferEkman6(fearBins, ABLATIONS[1].config);
  const fC = inferEkman6(fearBins, ABLATIONS[2].config);
  const fD = inferEkman6(fearBins, ABLATIONS[3].config);

  console.log("  Classic FEAR — top emotion progression:");
  console.log(`    A (learned+tiered):      ${fA.topEmotion} (${fmt(fA.diagnostics.pmax)})`);
  console.log(`    B (uniform+tiered):      ${fB.topEmotion} (${fmt(fB.diagnostics.pmax)})`);
  console.log(`    C (uniform+floor):       ${fC.topEmotion} (${fmt(fC.diagnostics.pmax)})`);
  console.log(`    D (uniform+floor+boost): ${fD.topEmotion} (${fmt(fD.diagnostics.pmax)})${fD.diagnostics.pairBoostApplied ? " [BOOSTED]" : ""}`);
  console.log("");

  // Neutral check
  const neutBins = TEST_CASES[3].bins;
  const nD = inferEkman6(neutBins, ABLATIONS[3].config);
  console.log(`  Neutral routine (config D): top=${nD.topEmotion}, pmax=${fmt(nD.diagnostics.pmax)}, decision=${nD.decision}`);
  if (nD.topEmotion === "JOY") {
    console.log("    *** WARNING: Neutral collapsed into JOY ***");
  } else {
    console.log("    OK — Neutral did not collapse into JOY.");
  }
  console.log("");

  console.log("Done. No files modified.");
}

main();
