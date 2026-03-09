/**
 * Layer-2: Likelihood Directional Sanity Audit (READ-ONLY)
 *
 * Loads the likelihood table artifact and prints targeted distributions
 * with entropy, margin, and directional sanity checks against
 * appraisal-theory expectations.
 *
 * Fully isolated — uses only Node built-ins (fs, path).
 * Does not modify any files.
 *
 * Usage:
 *   npx ts-node src/appraisal-lab/layer2/inspect_likelihood_direction.ts
 */

import * as fs from "fs";
import * as path from "path";

// ============================================================
// Paths
// ============================================================

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const TABLE_PATH = path.join(
  REPO_ROOT,
  "data",
  "layer2",
  "likelihood_table_v1_1.json"
);

// ============================================================
// Types (local only)
// ============================================================

interface LikelihoodTable {
  meta: {
    dataset_version: string;
    mapping_spec_version: string;
    total_train_rows: number;
    alpha_prior: number;
    alpha_cond: number;
    emotion_count: number;
  };
  priors: Record<string, number>;
  likelihoods: Record<string, Record<string, Record<string, number>>>;
}

// ============================================================
// Helpers
// ============================================================

function entropy(probs: number[]): number {
  let h = 0;
  for (const p of probs) {
    if (p > 0) h -= p * Math.log(p);
  }
  return h;
}

function normalizedEntropy(probs: number[]): number {
  const k = probs.length;
  if (k <= 1) return 0;
  const maxH = Math.log(k);
  return maxH === 0 ? 0 : entropy(probs) / maxH;
}

function getTopTwo(dist: Record<string, number>): {
  top1: { bin: string; prob: number };
  top2: { bin: string; prob: number };
  margin: number;
} {
  const sorted = Object.entries(dist).sort((a, b) => b[1] - a[1]);
  const top1 = { bin: sorted[0][0], prob: sorted[0][1] };
  const top2 =
    sorted.length > 1
      ? { bin: sorted[1][0], prob: sorted[1][1] }
      : { bin: "-", prob: 0 };
  return { top1, top2, margin: top1.prob - top2.prob };
}

function printDistribution(
  dimension: string,
  emotion: string,
  dist: Record<string, number>
): void {
  const probs = Object.values(dist);
  const { top1, top2, margin } = getTopTwo(dist);
  const hNorm = normalizedEntropy(probs);

  console.log("");
  console.log(`${"─".repeat(48)}`);
  console.log(`  Distribution: ${dimension} | ${emotion}`);
  console.log(`${"─".repeat(48)}`);
  console.log("");

  const bins = Object.keys(dist).sort();
  const maxLen = Math.max(...bins.map((b) => b.length));
  for (const bin of bins) {
    const label = bin.padEnd(maxLen);
    const bar = "█".repeat(Math.round(dist[bin] * 30));
    console.log(`  ${label} : ${dist[bin].toFixed(4)}  ${bar}`);
  }

  console.log("");
  console.log(`  Dominant    : ${top1.bin} (${top1.prob.toFixed(4)})`);
  console.log(
    `  Runner-up   : ${top2.bin} (${top2.prob.toFixed(4)})`
  );
  console.log(`  Margin      : ${margin.toFixed(4)}`);
  console.log(`  H_norm      : ${hNorm.toFixed(4)}`);
}

// ============================================================
// Directional sanity rules
// ============================================================

interface SanityRule {
  dimension: string;
  emotion: string;
  description: string;
  check: (dominant: string) => boolean;
}

const SANITY_RULES: SanityRule[] = [
  {
    dimension: "control",
    emotion: "fear",
    description: "control | fear: dominant != HIGH",
    check: (d) => d !== "HIGH",
  },
  {
    dimension: "control",
    emotion: "anger",
    description: "control | anger: dominant != LOW",
    check: (d) => d !== "LOW",
  },
  {
    dimension: "agency",
    emotion: "anger",
    description: "agency | anger: dominant == OTHER",
    check: (d) => d === "OTHER",
  },
  {
    dimension: "certainty",
    emotion: "surprise",
    description: "certainty | surprise: dominant == LOW",
    check: (d) => d === "LOW",
  },
  {
    dimension: "arousal",
    emotion: "sadness",
    description: "arousal | sadness: dominant != HIGH",
    check: (d) => d !== "HIGH",
  },
];

// ============================================================
// Main
// ============================================================

function main(): void {
  console.log("=== Layer-2: Likelihood Directional Sanity Audit ===");
  console.log("");

  if (!fs.existsSync(TABLE_PATH)) {
    console.error(`FATAL: Likelihood table not found at ${TABLE_PATH}`);
    console.error(
      "Run 'npm run layer2:build-likelihood-table' first."
    );
    process.exit(1);
  }

  const table: LikelihoodTable = JSON.parse(
    fs.readFileSync(TABLE_PATH, "utf-8")
  );

  console.log(`  Source       : ${TABLE_PATH}`);
  console.log(
    `  Spec version : ${table.meta.mapping_spec_version}`
  );
  console.log(`  Train rows   : ${table.meta.total_train_rows}`);
  console.log(`  Emotions     : ${table.meta.emotion_count}`);
  console.log(`  alpha_prior  : ${table.meta.alpha_prior}`);
  console.log(`  alpha_cond   : ${table.meta.alpha_cond}`);

  // Extract and print each required distribution
  const queries: { dimension: string; emotion: string }[] = [
    { dimension: "control", emotion: "fear" },
    { dimension: "control", emotion: "anger" },
    { dimension: "agency", emotion: "anger" },
    { dimension: "certainty", emotion: "surprise" },
    { dimension: "arousal", emotion: "sadness" },
  ];

  for (const q of queries) {
    const dimData = table.likelihoods[q.dimension];
    if (!dimData) {
      console.error(`Missing dimension: ${q.dimension}`);
      process.exit(1);
    }
    const dist = dimData[q.emotion];
    if (!dist) {
      console.error(
        `Missing emotion "${q.emotion}" in dimension "${q.dimension}"`
      );
      process.exit(1);
    }
    printDistribution(q.dimension, q.emotion, dist);
  }

  // Directional sanity checks
  console.log("");
  console.log("═".repeat(48));
  console.log("  DIRECTIONAL SANITY CHECKS");
  console.log("═".repeat(48));
  console.log("");

  let passCount = 0;
  let warnCount = 0;

  for (const rule of SANITY_RULES) {
    const dist = table.likelihoods[rule.dimension][rule.emotion];
    const { top1 } = getTopTwo(dist);
    const pass = rule.check(top1.bin);

    if (pass) {
      passCount++;
      console.log(
        `  PASS    ${rule.description}  [dominant=${top1.bin}]`
      );
    } else {
      warnCount++;
      console.log(
        `  WARNING ${rule.description}  [dominant=${top1.bin}]`
      );
    }
  }

  console.log("");
  console.log(`  Result: ${passCount} passed, ${warnCount} warning(s)`);
  console.log("");
  console.log("Done. No files modified.");
}

main();
