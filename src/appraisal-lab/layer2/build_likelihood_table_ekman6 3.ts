/**
 * Layer-2: Build collapsed Ekman-6 + Neutral likelihood table.
 *
 * Loads the Layer-2 dataset, collapses 13 emotions to 7 via Ekman mapping,
 * estimates priors and conditional likelihoods with Dirichlet smoothing,
 * and embeds IRR-based dimension weights in metadata.
 *
 * Fully isolated — uses only Node built-ins and sibling layer2 modules.
 *
 * Usage:
 *   npx ts-node src/appraisal-lab/layer2/build_likelihood_table_ekman6.ts
 */

import * as fs from "fs";
import * as path from "path";
import { collapseEmotion, COLLAPSED_EMOTIONS, CollapsedEmotion } from "./emotion_collapse_map";

// ============================================================
// Paths
// ============================================================

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const DATASET_PATH = path.join(REPO_ROOT, "data", "layer2", "layer2_likelihood_dataset_v1_1.json");
const WEIGHTS_PATH = path.join(REPO_ROOT, "data", "layer2", "dimension_weights.json");
const OUTPUT_PATH = path.join(REPO_ROOT, "data", "layer2", "likelihood_table_ekman6_v1_1.json");

const DIMENSIONS = [
  "valence",
  "arousal",
  "agency",
  "control",
  "certainty",
  "goalRelevance",
] as const;

type Dimension = (typeof DIMENSIONS)[number];

// ============================================================
// Types
// ============================================================

interface DatasetRow {
  emotion: string;
  split: string;
  appraisals: Record<Dimension, string>;
}

interface Ekman6Table {
  metadata: {
    version: string;
    source_dataset: string;
    split: string;
    smoothing: { alpha_prior: number; alpha_cond: number };
    dimension_weights: Record<string, number>;
    collapsed_from_13: boolean;
    collapsed_emotions: string[];
    total_train_rows: number;
    generated_at: string;
  };
  priors: Record<string, number>;
  likelihoods: Record<string, Record<string, Record<string, number>>>;
}

// ============================================================
// Main
// ============================================================

function main(): void {
  const alphaPrior = 1;
  const alphaCond = 1;

  console.log("=== Layer-2: Ekman-6 Likelihood Table Builder ===\n");

  // 1. Load dataset
  if (!fs.existsSync(DATASET_PATH)) {
    console.error(`FATAL: Dataset not found at ${DATASET_PATH}`);
    process.exit(1);
  }
  const raw: DatasetRow[] = JSON.parse(fs.readFileSync(DATASET_PATH, "utf-8"));
  console.log(`Loaded ${raw.length} total rows.`);

  // 2. Filter to train
  const trainRows = raw.filter((r) => r.split === "train");
  console.log(`Train split: ${trainRows.length} rows.`);

  // 3. Collapse emotions
  const collapsed: { emotion: CollapsedEmotion; appraisals: Record<Dimension, string> }[] = [];
  for (const row of trainRows) {
    collapsed.push({
      emotion: collapseEmotion(row.emotion),
      appraisals: row.appraisals,
    });
  }

  // 4. Load dimension weights
  if (!fs.existsSync(WEIGHTS_PATH)) {
    console.error(`FATAL: Weights not found at ${WEIGHTS_PATH}. Run compute_dimension_weights.ts first.`);
    process.exit(1);
  }
  const dimensionWeights: Record<string, number> = JSON.parse(
    fs.readFileSync(WEIGHTS_PATH, "utf-8")
  );
  console.log("Dimension weights loaded.");

  // 5. Discover bins per dimension
  const binsPerDim: Record<Dimension, string[]> = {} as Record<Dimension, string[]>;
  for (const dim of DIMENSIONS) {
    binsPerDim[dim] = [...new Set(collapsed.map((r) => r.appraisals[dim]))].sort();
  }

  // 6. Emotion counts
  const N = collapsed.length;
  const K = COLLAPSED_EMOTIONS.length;
  const emotionCounts: Record<string, number> = {};
  for (const emo of COLLAPSED_EMOTIONS) emotionCounts[emo] = 0;
  for (const row of collapsed) emotionCounts[row.emotion]++;

  console.log("\nCollapsed emotion distribution (train):");
  for (const emo of COLLAPSED_EMOTIONS) {
    console.log(`  ${emo.padEnd(10)} ${emotionCounts[emo]} (${((emotionCounts[emo] / N) * 100).toFixed(1)}%)`);
  }

  // 7. Priors with Dirichlet smoothing
  const priors: Record<string, number> = {};
  const priorDenom = N + alphaPrior * K;
  for (const emo of COLLAPSED_EMOTIONS) {
    priors[emo] = (emotionCounts[emo] + alphaPrior) / priorDenom;
  }

  // 8. Conditional likelihoods
  const counts: Record<string, Record<string, Record<string, number>>> = {};
  for (const dim of DIMENSIONS) {
    counts[dim] = {};
    for (const emo of COLLAPSED_EMOTIONS) {
      counts[dim][emo] = {};
      for (const bin of binsPerDim[dim]) {
        counts[dim][emo][bin] = 0;
      }
    }
  }

  for (const row of collapsed) {
    for (const dim of DIMENSIONS) {
      counts[dim][row.emotion][row.appraisals[dim]]++;
    }
  }

  const likelihoods: Record<string, Record<string, Record<string, number>>> = {};
  for (const dim of DIMENSIONS) {
    likelihoods[dim] = {};
    const Bi = binsPerDim[dim].length;
    for (const emo of COLLAPSED_EMOTIONS) {
      likelihoods[dim][emo] = {};
      const denom = emotionCounts[emo] + alphaCond * Bi;
      for (const bin of binsPerDim[dim]) {
        likelihoods[dim][emo][bin] = (counts[dim][emo][bin] + alphaCond) / denom;
      }
    }
  }

  // 9. Validation
  console.log("\nValidating...");
  const TOL = 1e-9;

  let priorSum = 0;
  for (const emo of COLLAPSED_EMOTIONS) {
    const p = priors[emo];
    if (!isFinite(p) || p < 0) throw new Error(`Invalid prior for ${emo}: ${p}`);
    priorSum += p;
  }
  if (Math.abs(priorSum - 1.0) > TOL) {
    throw new Error(`Prior sum = ${priorSum}, expected 1.0`);
  }

  for (const dim of DIMENSIONS) {
    for (const emo of COLLAPSED_EMOTIONS) {
      let binSum = 0;
      for (const bin of Object.keys(likelihoods[dim][emo])) {
        const p = likelihoods[dim][emo][bin];
        if (!isFinite(p) || p < 0) {
          throw new Error(`Invalid likelihood ${dim}/${emo}/${bin}: ${p}`);
        }
        binSum += p;
      }
      if (Math.abs(binSum - 1.0) > TOL) {
        throw new Error(`Likelihood sum ${dim}/${emo} = ${binSum}, expected 1.0`);
      }
    }
  }

  for (const emo of COLLAPSED_EMOTIONS) {
    if (emotionCounts[emo] === 0) {
      throw new Error(`Collapsed emotion "${emo}" has 0 train rows`);
    }
  }

  console.log("  All validation checks passed.");

  // 10. Build output
  const table: Ekman6Table = {
    metadata: {
      version: "ekman6_v1_1",
      source_dataset: "crowd-enVent 2023",
      split: "train",
      smoothing: { alpha_prior: alphaPrior, alpha_cond: alphaCond },
      dimension_weights: dimensionWeights,
      collapsed_from_13: true,
      collapsed_emotions: [...COLLAPSED_EMOTIONS],
      total_train_rows: N,
      generated_at: new Date().toISOString(),
    },
    priors,
    likelihoods,
  };

  const outDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(table, null, 2), "utf-8");
  console.log(`\nArtifact written to: ${OUTPUT_PATH}`);

  // 11. Print example
  const firstDim = DIMENSIONS[0];
  const firstEmo = COLLAPSED_EMOTIONS[0];
  console.log(`\nExample: P(${firstDim} | ${firstEmo}):`);
  for (const [bin, p] of Object.entries(likelihoods[firstDim][firstEmo])) {
    console.log(`  ${bin}: ${p.toFixed(6)}`);
  }

  console.log("\nDone.");
}

main();
