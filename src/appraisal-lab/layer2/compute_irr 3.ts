/**
 * Layer-2: Inter-Rater Reliability (IRR) for crowd-enVent validation subset.
 *
 * Computes:
 *   - Weighted Cohen's kappa (quadratic) for 21 appraisal dimensions (Likert 1–5)
 *   - Fleiss' kappa for emotion labels (13 categories)
 *
 * Input:  crowd-enVent_validation.tsv  (1200 texts × 5 reader raters)
 * Output: data/layer2/irr_kappa_table.csv
 *         docs/layer2/irr_kappa.md
 *
 * Fully isolated — uses only Node built-ins (fs, path).
 *
 * Usage:
 *   npx ts-node src/appraisal-lab/layer2/compute_irr.ts
 */

import * as fs from "fs";
import * as path from "path";

// ============================================================
// Paths
// ============================================================

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const TSV_PATH = path.join(
  REPO_ROOT,
  "src",
  "appraisal-lab",
  "dataset",
  "crowd-enVent2023",
  "corpus",
  "crowd-enVent_validation.tsv"
);
const CSV_OUT = path.join(REPO_ROOT, "data", "layer2", "irr_kappa_table.csv");
const MD_OUT = path.join(REPO_ROOT, "docs", "layer2", "irr_kappa.md");

const EXPECTED_TEXTS = 1200;
const EXPECTED_RATERS = 5;

const APPRAISAL_DIMS = [
  "suddenness",
  "familiarity",
  "predict_event",
  "pleasantness",
  "unpleasantness",
  "goal_relevance",
  "chance_responsblt",
  "self_responsblt",
  "other_responsblt",
  "predict_conseq",
  "goal_support",
  "urgency",
  "self_control",
  "other_control",
  "chance_control",
  "accept_conseq",
  "standards",
  "social_norms",
  "attention",
  "not_consider",
  "effort",
] as const;

// ============================================================
// TSV loader
// ============================================================

interface RawRow {
  text_id: string;
  emotion: string;
  appraisals: Record<string, number>;
}

function loadTSV(): RawRow[] {
  const content = fs.readFileSync(TSV_PATH, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) throw new Error("Empty TSV");

  const headers = lines[0].split("\t").map((h) => h.trim());

  for (const dim of APPRAISAL_DIMS) {
    if (!headers.includes(dim)) throw new Error(`Missing column: ${dim}`);
  }
  if (!headers.includes("text_id")) throw new Error("Missing column: text_id");
  if (!headers.includes("emotion")) throw new Error("Missing column: emotion");

  const rows: RawRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split("\t");
    const get = (col: string) => (cells[headers.indexOf(col)] ?? "").trim();

    const appraisals: Record<string, number> = {};
    for (const dim of APPRAISAL_DIMS) {
      const v = Number(get(dim));
      if (isNaN(v) || v < 1 || v > 5) {
        throw new Error(`Row ${i}: invalid ${dim} value "${get(dim)}"`);
      }
      appraisals[dim] = Math.round(v);
    }

    rows.push({
      text_id: get("text_id"),
      emotion: get("emotion"),
      appraisals,
    });
  }

  return rows;
}

// ============================================================
// Group by text_id
// ============================================================

function groupByTextId(rows: RawRow[]): Map<string, RawRow[]> {
  const map = new Map<string, RawRow[]>();
  for (const r of rows) {
    if (!map.has(r.text_id)) map.set(r.text_id, []);
    map.get(r.text_id)!.push(r);
  }
  return map;
}

// ============================================================
// Weighted Cohen's Kappa (quadratic, pooled pairwise)
// ============================================================

function weightedCohenKappaPooled(
  groups: Map<string, RawRow[]>,
  dim: string
): number {
  const K = 5; // Likert scale 1–5
  const maxDist = K - 1; // 4

  // Quadratic weight matrix (agreement-based)
  // w(i,j) = 1 - (i-j)^2 / maxDist^2
  const w = (a: number, b: number) =>
    1 - ((a - b) * (a - b)) / (maxDist * maxDist);

  // Build observed frequency matrix from pooled pairwise comparisons
  // O[r][c] counts pairs where rater A gave r+1 and rater B gave c+1
  const O: number[][] = Array.from({ length: K }, () => Array(K).fill(0));
  let totalPairs = 0;

  for (const [, raters] of groups) {
    const vals = raters.map((r) => r.appraisals[dim]);
    // All (5 choose 2) = 10 unordered pairs
    for (let a = 0; a < vals.length; a++) {
      for (let b = a + 1; b < vals.length; b++) {
        const ra = vals[a] - 1; // 0-indexed
        const rb = vals[b] - 1;
        O[ra][rb]++;
        O[rb][ra]++;
        totalPairs += 2;
      }
    }
  }

  if (totalPairs === 0) return 0;

  // Normalize to proportions
  const o: number[][] = O.map((row) => row.map((v) => v / totalPairs));

  // Marginals
  const rowMarg: number[] = Array(K).fill(0);
  const colMarg: number[] = Array(K).fill(0);
  for (let i = 0; i < K; i++) {
    for (let j = 0; j < K; j++) {
      rowMarg[i] += o[i][j];
      colMarg[j] += o[i][j];
    }
  }

  // Expected under independence
  const e: number[][] = Array.from({ length: K }, (_, i) =>
    Array.from({ length: K }, (_, j) => rowMarg[i] * colMarg[j])
  );

  // Weighted observed and expected agreement
  let poW = 0;
  let peW = 0;
  for (let i = 0; i < K; i++) {
    for (let j = 0; j < K; j++) {
      poW += w(i + 1, j + 1) * o[i][j];
      peW += w(i + 1, j + 1) * e[i][j];
    }
  }

  if (Math.abs(1 - peW) < 1e-15) return 1; // perfect expected agreement
  return (poW - peW) / (1 - peW);
}

// ============================================================
// Fleiss' Kappa
// ============================================================

function fleissKappa(groups: Map<string, RawRow[]>): number {
  // Discover all emotion categories
  const allEmotions = new Set<string>();
  for (const [, raters] of groups) {
    for (const r of raters) allEmotions.add(r.emotion);
  }
  const categories = [...allEmotions].sort();
  const k = categories.length;
  const catIdx = new Map(categories.map((c, i) => [c, i]));

  const N = groups.size; // number of items
  const n = EXPECTED_RATERS; // raters per item

  // n_ij: for each item i, count of raters assigning category j
  const items: number[][] = [];
  for (const [, raters] of groups) {
    const counts = Array(k).fill(0);
    for (const r of raters) {
      const idx = catIdx.get(r.emotion);
      if (idx === undefined) throw new Error(`Unknown emotion: ${r.emotion}`);
      counts[idx]++;
    }
    items.push(counts);
  }

  // p_j = proportion of all ratings in category j
  const pj: number[] = Array(k).fill(0);
  for (const counts of items) {
    for (let j = 0; j < k; j++) {
      pj[j] += counts[j];
    }
  }
  const totalRatings = N * n;
  for (let j = 0; j < k; j++) {
    pj[j] /= totalRatings;
  }

  // P_e = sum(p_j^2)
  let Pe = 0;
  for (let j = 0; j < k; j++) {
    Pe += pj[j] * pj[j];
  }

  // P_i for each item, then P_bar = mean(P_i)
  let Pbar = 0;
  for (const counts of items) {
    let sumSq = 0;
    for (let j = 0; j < k; j++) {
      sumSq += counts[j] * counts[j];
    }
    const Pi = (sumSq - n) / (n * (n - 1));
    Pbar += Pi;
  }
  Pbar /= N;

  if (Math.abs(1 - Pe) < 1e-15) return 1;
  return (Pbar - Pe) / (1 - Pe);
}

// ============================================================
// Threshold classification
// ============================================================

type Status = "ACCEPTABLE" | "WEAK" | "UNSTABLE";

function classify(kappa: number): Status {
  if (isNaN(kappa) || kappa < 0.5) return "UNSTABLE";
  if (kappa < 0.6) return "WEAK";
  return "ACCEPTABLE";
}

// ============================================================
// Output generation
// ============================================================

interface KappaResult {
  dimension: string;
  type: "appraisal" | "emotion";
  kappa: number;
  status: Status;
}

function writeCSV(results: KappaResult[]): void {
  const lines = ["dimension,type,kappa,status"];
  for (const r of results) {
    lines.push(`${r.dimension},${r.type},${r.kappa.toFixed(6)},${r.status}`);
  }
  const dir = path.dirname(CSV_OUT);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CSV_OUT, lines.join("\n") + "\n", "utf-8");
}

function writeMarkdown(results: KappaResult[], uniqueTexts: number): void {
  const appraisalResults = results.filter((r) => r.type === "appraisal");
  const emotionResult = results.find((r) => r.type === "emotion")!;
  const now = new Date().toISOString().slice(0, 10);

  const acceptable = appraisalResults.filter((r) => r.status === "ACCEPTABLE").length;
  const weak = appraisalResults.filter((r) => r.status === "WEAK").length;
  const unstable = appraisalResults.filter((r) => r.status === "UNSTABLE").length;

  const lines: string[] = [];
  const w = (s: string) => lines.push(s);

  w("# Inter-Rater Reliability Report");
  w("");
  w(`**Generated:** ${now}`);
  w("**Source:** crowd-enVent_validation.tsv");
  w(`**Unique texts:** ${uniqueTexts}`);
  w(`**Raters per text:** ${EXPECTED_RATERS}`);
  w("**Method (appraisals):** Weighted Cohen's kappa (quadratic), pooled pairwise");
  w("**Method (emotion):** Fleiss' kappa");
  w("");
  w("---");
  w("");

  w("## Emotion Agreement");
  w("");
  w(`| Measure | Value | Status |`);
  w(`|---------|-------|--------|`);
  w(
    `| Fleiss' kappa (13 emotions) | ${emotionResult.kappa.toFixed(4)} | ${emotionResult.status} |`
  );
  w("");

  w("## Appraisal Dimension Agreement");
  w("");
  w("| Dimension | Weighted κ (quadratic) | Status |");
  w("|-----------|----------------------|--------|");
  for (const r of appraisalResults) {
    w(`| ${r.dimension} | ${r.kappa.toFixed(4)} | ${r.status} |`);
  }
  w("");

  w("## Summary Counts");
  w("");
  w("| Status | Count |");
  w("|--------|-------|");
  w(`| ACCEPTABLE (κ ≥ 0.60) | ${acceptable} |`);
  w(`| WEAK (0.50 ≤ κ < 0.60) | ${weak} |`);
  w(`| UNSTABLE (κ < 0.50) | ${unstable} |`);
  w("");

  w("---");
  w("");
  w("## Interpretation");
  w("");

  if (unstable > 5) {
    w(
      `- **${unstable} of 21 appraisal dimensions are UNSTABLE (κ < 0.50).** ` +
        "This suggests that bin collapse or dimension merging should be considered " +
        "for low-agreement dimensions before using them in likelihood estimation."
    );
  } else if (unstable > 0) {
    w(
      `- ${unstable} appraisal dimension(s) are UNSTABLE. ` +
        "These should be monitored but do not yet warrant bin collapse."
    );
  } else {
    w("- All appraisal dimensions have κ ≥ 0.50. No bin collapse recommended.");
  }
  w("");

  if (emotionResult.kappa < 0.6) {
    w(
      `- **Emotion Fleiss' κ = ${emotionResult.kappa.toFixed(4)} (< 0.60).** ` +
        "Reader emotion perception is noisy. This is expected for crowd-sourced " +
        "data with fine-grained emotion categories. Appraisal-based inference " +
        "may be more reliable than categorical emotion labels."
    );
  } else {
    w(
      `- Emotion Fleiss' κ = ${emotionResult.kappa.toFixed(4)} (≥ 0.60). ` +
        "Reader emotion agreement is acceptable."
    );
  }
  w("");

  const dir = path.dirname(MD_OUT);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(MD_OUT, lines.join("\n"), "utf-8");
}

// ============================================================
// Main
// ============================================================

function main(): void {
  console.log("=== Layer-2: Inter-Rater Reliability (IRR) ===");
  console.log("");

  if (!fs.existsSync(TSV_PATH)) {
    console.error(`FATAL: Validation file not found at ${TSV_PATH}`);
    process.exit(1);
  }

  // 1. Load & parse
  console.log("Loading validation data...");
  const rows = loadTSV();
  console.log(`  Parsed ${rows.length} rows.`);

  // 2. Group by text_id
  const groups = groupByTextId(rows);
  console.log(`  Unique text_ids: ${groups.size}`);

  // 3. Assert structure
  if (groups.size !== EXPECTED_TEXTS) {
    throw new Error(
      `Expected ${EXPECTED_TEXTS} unique text_ids, got ${groups.size}`
    );
  }
  for (const [tid, raters] of groups) {
    if (raters.length !== EXPECTED_RATERS) {
      throw new Error(
        `text_id ${tid}: expected ${EXPECTED_RATERS} raters, got ${raters.length}`
      );
    }
  }
  console.log(`  Structure verified: ${EXPECTED_TEXTS} texts × ${EXPECTED_RATERS} raters.`);

  // 4. Compute weighted Cohen's kappa for each appraisal dimension
  console.log("\nComputing weighted Cohen's kappa (quadratic) per dimension...");
  const results: KappaResult[] = [];

  for (const dim of APPRAISAL_DIMS) {
    const kappa = weightedCohenKappaPooled(groups, dim);

    if (isNaN(kappa)) throw new Error(`NaN kappa for dimension: ${dim}`);
    if (!isFinite(kappa)) throw new Error(`Infinite kappa for dimension: ${dim}`);

    const status = classify(kappa);
    results.push({ dimension: dim, type: "appraisal", kappa, status });
    console.log(`  ${dim.padEnd(20)} κ = ${kappa.toFixed(4)}  ${status}`);
  }

  // 5. Compute Fleiss' kappa for emotion
  console.log("\nComputing Fleiss' kappa for emotion labels...");
  const emotionKappa = fleissKappa(groups);

  if (isNaN(emotionKappa)) throw new Error("NaN kappa for emotion");
  if (!isFinite(emotionKappa)) throw new Error("Infinite kappa for emotion");

  const emotionStatus = classify(emotionKappa);
  results.push({
    dimension: "emotion",
    type: "emotion",
    kappa: emotionKappa,
    status: emotionStatus,
  });
  console.log(`  emotion (Fleiss)     κ = ${emotionKappa.toFixed(4)}  ${emotionStatus}`);

  // 6. Summary
  const appraisalResults = results.filter((r) => r.type === "appraisal");
  const acceptable = appraisalResults.filter((r) => r.status === "ACCEPTABLE").length;
  const weak = appraisalResults.filter((r) => r.status === "WEAK").length;
  const unstable = appraisalResults.filter((r) => r.status === "UNSTABLE").length;

  console.log("\n--- Summary ---");
  console.log(`  ACCEPTABLE: ${acceptable}`);
  console.log(`  WEAK:       ${weak}`);
  console.log(`  UNSTABLE:   ${unstable}`);

  // 7. Write outputs
  writeCSV(results);
  console.log(`\nCSV written to: ${CSV_OUT}`);

  writeMarkdown(results, groups.size);
  console.log(`Report written to: ${MD_OUT}`);

  console.log("\nDone. No files modified (read-only diagnostic).");
}

main();
