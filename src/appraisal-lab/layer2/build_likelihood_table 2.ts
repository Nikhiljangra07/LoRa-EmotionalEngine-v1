/**
 * Layer-2: Empirical Likelihood Table Builder
 *
 * Loads the Layer-2 likelihood dataset (train split only), estimates
 * emotion priors and per-dimension conditional likelihoods using
 * Dirichlet smoothing, and writes the resulting artifact.
 *
 * Fully isolated — uses only Node built-ins (fs, path).
 *
 * Usage:
 *   npx ts-node src/appraisal-lab/layer2/build_likelihood_table.ts
 *   npx ts-node src/appraisal-lab/layer2/build_likelihood_table.ts --alpha-prior 1 --alpha-cond 1
 */

import * as fs from "fs";
import * as path from "path";

// ============================================================
// CLI flag parsing
// ============================================================

function parseFloat2(flag: string, fallback: number): number {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return fallback;
  const val = parseFloat(process.argv[idx + 1]);
  if (isNaN(val) || val < 0) {
    console.error(`Invalid ${flag} value: ${process.argv[idx + 1]}. Must be non-negative number.`);
    process.exit(1);
  }
  return val;
}

// ============================================================
// Paths & constants
// ============================================================

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const DATASET_PATH = path.join(REPO_ROOT, "data", "layer2", "layer2_likelihood_dataset_v1_1.json");
const OUTPUT_PATH = path.join(REPO_ROOT, "data", "layer2", "likelihood_table_v1_1.json");

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

interface LikelihoodTable {
  meta: {
    dataset_version: string;
    mapping_spec_version: string;
    seed: number;
    split: string;
    alpha_prior: number;
    alpha_cond: number;
    emotion_count: number;
    total_train_rows: number;
    dimensions: string[];
    bins_per_dimension: Record<string, string[]>;
    generated_at: string;
  };
  priors: Record<string, number>;
  likelihoods: Record<string, Record<string, Record<string, number>>>;
}

// ============================================================
// Core estimation
// ============================================================

function buildTable(
  trainRows: DatasetRow[],
  alphaPrior: number,
  alphaCond: number
): LikelihoodTable {
  const N = trainRows.length;

  // Discover unique emotions (sorted for determinism)
  const emotions = [...new Set(trainRows.map((r) => r.emotion))].sort();
  const K = emotions.length;

  // Discover unique bins per dimension from data (sorted for determinism)
  const binsPerDim: Record<Dimension, string[]> = {} as Record<Dimension, string[]>;
  for (const dim of DIMENSIONS) {
    binsPerDim[dim] = [...new Set(trainRows.map((r) => r.appraisals[dim]))].sort();
    if (binsPerDim[dim].length === 0) {
      throw new Error(`No bins discovered for dimension: ${dim}`);
    }
  }

  // Count per emotion
  const emotionCounts: Record<string, number> = {};
  for (const emo of emotions) emotionCounts[emo] = 0;
  for (const row of trainRows) emotionCounts[row.emotion]++;

  // Compute priors: P(E=e) = (N_e + alpha_prior) / (N + alpha_prior * K)
  const priors: Record<string, number> = {};
  const priorDenom = N + alphaPrior * K;
  for (const emo of emotions) {
    priors[emo] = (emotionCounts[emo] + alphaPrior) / priorDenom;
  }

  // Count per (dimension, emotion, bin)
  // counts[dim][emo][bin] = N_{i,e,d}
  const counts: Record<string, Record<string, Record<string, number>>> = {};
  for (const dim of DIMENSIONS) {
    counts[dim] = {};
    for (const emo of emotions) {
      counts[dim][emo] = {};
      for (const bin of binsPerDim[dim]) {
        counts[dim][emo][bin] = 0;
      }
    }
  }

  for (const row of trainRows) {
    for (const dim of DIMENSIONS) {
      const bin = row.appraisals[dim];
      counts[dim][row.emotion][bin]++;
    }
  }

  // Compute conditionals:
  // P(D_i=d | E=e) = (N_{i,e,d} + alpha_cond) / (N_e + alpha_cond * B_i)
  const likelihoods: Record<string, Record<string, Record<string, number>>> = {};
  for (const dim of DIMENSIONS) {
    likelihoods[dim] = {};
    const Bi = binsPerDim[dim].length;
    for (const emo of emotions) {
      likelihoods[dim][emo] = {};
      const denom = emotionCounts[emo] + alphaCond * Bi;
      for (const bin of binsPerDim[dim]) {
        likelihoods[dim][emo][bin] = (counts[dim][emo][bin] + alphaCond) / denom;
      }
    }
  }

  return {
    meta: {
      dataset_version: "v1_1",
      mapping_spec_version: "v1.1",
      seed: 42,
      split: "train",
      alpha_prior: alphaPrior,
      alpha_cond: alphaCond,
      emotion_count: K,
      total_train_rows: N,
      dimensions: [...DIMENSIONS],
      bins_per_dimension: { ...binsPerDim },
      generated_at: new Date().toISOString(),
    },
    priors,
    likelihoods,
  };
}

// ============================================================
// Validation
// ============================================================

const SUM_TOLERANCE = 1e-9;

function validate(table: LikelihoodTable): void {
  const { priors, likelihoods, meta } = table;

  // Check priors: no NaN/Infinity, all >= 0, sum ≈ 1
  let priorSum = 0;
  for (const emo of Object.keys(priors)) {
    const p = priors[emo];
    if (!isFinite(p)) throw new Error(`Prior for "${emo}" is not finite: ${p}`);
    if (p < 0) throw new Error(`Prior for "${emo}" is negative: ${p}`);
    priorSum += p;
  }
  if (Math.abs(priorSum - 1.0) > SUM_TOLERANCE) {
    throw new Error(`Prior sum = ${priorSum}, expected ≈ 1.0 (tolerance ${SUM_TOLERANCE})`);
  }

  // Check likelihoods: per (dim, emo), no NaN/Infinity, all >= 0, sum ≈ 1
  for (const dim of Object.keys(likelihoods)) {
    for (const emo of Object.keys(likelihoods[dim])) {
      const bins = likelihoods[dim][emo];
      let binSum = 0;
      for (const bin of Object.keys(bins)) {
        const p = bins[bin];
        if (!isFinite(p)) {
          throw new Error(`Likelihood ${dim}/${emo}/${bin} is not finite: ${p}`);
        }
        if (p < 0) {
          throw new Error(`Likelihood ${dim}/${emo}/${bin} is negative: ${p}`);
        }
        binSum += p;
      }
      if (Math.abs(binSum - 1.0) > SUM_TOLERANCE) {
        throw new Error(
          `Likelihood sum for ${dim}/${emo} = ${binSum}, expected ≈ 1.0 (tolerance ${SUM_TOLERANCE})`
        );
      }
    }
  }

  // Check no dimension collapses: no single bin should have prob > 0.99
  for (const dim of Object.keys(likelihoods)) {
    for (const emo of Object.keys(likelihoods[dim])) {
      for (const bin of Object.keys(likelihoods[dim][emo])) {
        if (likelihoods[dim][emo][bin] > 0.99) {
          console.warn(
            `  WARNING: ${dim}/${emo}/${bin} = ${likelihoods[dim][emo][bin].toFixed(4)} (near-collapse)`
          );
        }
      }
    }
  }

  console.log("  All validation guards passed.");
}

// ============================================================
// Main
// ============================================================

function main(): void {
  const alphaPrior = parseFloat2("--alpha-prior", 1);
  const alphaCond = parseFloat2("--alpha-cond", 1);

  console.log("=== Layer-2: Empirical Likelihood Table Builder ===");
  console.log(`  alpha_prior = ${alphaPrior}`);
  console.log(`  alpha_cond  = ${alphaCond}`);
  console.log("");

  // 1. Load dataset
  if (!fs.existsSync(DATASET_PATH)) {
    console.error(`ERROR: Dataset not found at ${DATASET_PATH}`);
    console.error("Run 'npm run layer2:build-likelihood' first to generate the dataset.");
    process.exit(1);
  }

  const raw: DatasetRow[] = JSON.parse(fs.readFileSync(DATASET_PATH, "utf-8"));
  console.log(`Loaded ${raw.length} total rows from dataset.`);

  // 2. Filter to train split
  const trainRows = raw.filter((r) => r.split === "train");
  console.log(`Train split: ${trainRows.length} rows`);

  if (trainRows.length === 0) {
    console.error("ERROR: No train rows found.");
    process.exit(1);
  }

  // 3. Emotion distribution
  const emoCounts: Record<string, number> = {};
  for (const r of trainRows) {
    emoCounts[r.emotion] = (emoCounts[r.emotion] || 0) + 1;
  }
  const sortedEmotions = Object.keys(emoCounts).sort();
  console.log(`\nEmotion distribution (train):`);
  for (const emo of sortedEmotions) {
    console.log(`  ${emo}: ${emoCounts[emo]} (${((emoCounts[emo] / trainRows.length) * 100).toFixed(1)}%)`);
  }

  // 4. Build table
  console.log("\nEstimating priors and conditionals...");
  const table = buildTable(trainRows, alphaPrior, alphaCond);

  // 5. Validate
  console.log("\nValidating...");
  validate(table);

  // 6. Print example
  const firstDim = DIMENSIONS[0];
  const firstEmo = sortedEmotions[0];
  console.log(`\nExample: P(${firstDim} | ${firstEmo}):`);
  const exBins = table.likelihoods[firstDim][firstEmo];
  for (const bin of Object.keys(exBins)) {
    console.log(`  ${bin}: ${exBins[bin].toFixed(6)}`);
  }

  console.log(`\nPriors:`);
  for (const emo of sortedEmotions) {
    console.log(`  P(${emo}) = ${table.priors[emo].toFixed(6)}`);
  }

  // 7. Sum confirmation
  const priorTotal = Object.values(table.priors).reduce((a, b) => a + b, 0);
  console.log(`\nPrior sum: ${priorTotal.toFixed(10)} (expect 1.0)`);

  for (const dim of DIMENSIONS) {
    for (const emo of sortedEmotions) {
      const s = Object.values(table.likelihoods[dim][emo]).reduce((a, b) => a + b, 0);
      if (Math.abs(s - 1.0) > 1e-9) {
        console.error(`  SUM FAIL: ${dim}/${emo} = ${s}`);
      }
    }
  }
  console.log(`Likelihood sums: all ${DIMENSIONS.length * sortedEmotions.length} (dim × emo) combinations ≈ 1.0`);

  // 8. Save
  const outDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(table, null, 2), "utf-8");
  console.log(`\nArtifact written to: ${OUTPUT_PATH}`);
  console.log("Done.");
}

main();
