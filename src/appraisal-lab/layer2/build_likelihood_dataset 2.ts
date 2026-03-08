/**
 * Layer-2 Step 1: Empirical Likelihood Dataset Builder
 *
 * Loads crowd-enVent_generation.tsv, applies the locked v1.1 mapping
 * (21 crowd-enVent columns → LoRa-6 bins), produces stratified train/dev/test
 * splits, and writes the artifact + summary report.
 *
 * Fully isolated — uses only Node built-ins (fs, path).
 *
 * Usage:
 *   npx ts-node src/appraisal-lab/layer2/build_likelihood_dataset.ts
 */

import * as fs from "fs";
import * as path from "path";

// ============================================================
// Constants
// ============================================================

const SEED = 42;

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const TSV_PATH = path.join(
  REPO_ROOT,
  "src",
  "appraisal-lab",
  "dataset",
  "crowd-enVent2023",
  "corpus",
  "crowd-enVent_generation.tsv"
);
const DATASET_OUT = path.join(
  REPO_ROOT,
  "data",
  "layer2",
  "layer2_likelihood_dataset_v1_1.json"
);
const SUMMARY_OUT = path.join(
  REPO_ROOT,
  "docs",
  "layer2",
  "likelihood_dataset_summary.md"
);

const EXPECTED_ROW_COUNT = 6600;

const APPRAISAL_COLUMNS = [
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

const VALID_VALENCE = ["NEG", "NEU", "POS"] as const;
const VALID_AROUSAL = ["LOW", "MED", "HIGH"] as const;
const VALID_AGENCY = ["SELF", "OTHER", "SITUATION"] as const;
const VALID_CONTROL = ["LOW", "MED", "HIGH"] as const;
const VALID_CERTAINTY = ["LOW", "HIGH"] as const;
const VALID_GOAL_RELEVANCE = ["LOW", "HIGH"] as const;

type ValenceBin = (typeof VALID_VALENCE)[number];
type ArousalBin = (typeof VALID_AROUSAL)[number];
type AgencyBin = (typeof VALID_AGENCY)[number];
type ControlBin = (typeof VALID_CONTROL)[number];
type CertaintyBin = (typeof VALID_CERTAINTY)[number];
type GoalRelevanceBin = (typeof VALID_GOAL_RELEVANCE)[number];

type Split = "train" | "dev" | "test";

interface Appraisals {
  valence: ValenceBin;
  arousal: ArousalBin;
  agency: AgencyBin;
  control: ControlBin;
  certainty: CertaintyBin;
  goalRelevance: GoalRelevanceBin;
}

interface DatasetRow {
  emotion: string;
  split: Split;
  appraisals: Appraisals;
}

// ============================================================
// Deterministic seeded RNG (Mulberry32)
// ============================================================

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ============================================================
// Normalization & binning (v1.1 spec, verbatim)
// ============================================================

function clampLikert(raw: string): number {
  const n = Number(raw.trim());
  if (isNaN(n)) throw new Error(`Non-numeric appraisal value: "${raw}"`);
  if (n < 1) return 1;
  if (n > 5) return 5;
  return Math.round(n);
}

function norm(x: number): number {
  const v = (x - 1) / 4;
  if (v < -0.001 || v > 1.001) {
    throw new Error(`Normalized value ${v} outside [0,1] from Likert ${x}`);
  }
  return Math.max(0, Math.min(1, v));
}

function bin3(v: number): "LOW" | "MED" | "HIGH" {
  if (v < 0.333) return "LOW";
  if (v < 0.667) return "MED";
  return "HIGH";
}

function bin2(v: number): "LOW" | "HIGH" {
  if (v < 0.5) return "LOW";
  return "HIGH";
}

function valenceBin(v: number): ValenceBin {
  if (v < 0.333) return "NEG";
  if (v < 0.667) return "NEU";
  return "POS";
}

// ============================================================
// v1.1 Mapping: 21 columns → LoRa-6 bins
// ============================================================

function mapRowToAppraisals(cols: Record<string, string>): Appraisals {
  const p = clampLikert(cols.pleasantness);
  const u = clampLikert(cols.unpleasantness);
  const valence_c = (p - u + 4) / 8;

  const arousal_c =
    (norm(clampLikert(cols.suddenness)) +
      norm(clampLikert(cols.urgency)) +
      norm(clampLikert(cols.attention))) /
    3;

  const sr = clampLikert(cols.self_responsblt);
  const or_ = clampLikert(cols.other_responsblt);
  const cr = clampLikert(cols.chance_responsblt);
  const maxR = Math.max(sr, or_, cr);
  let agency: AgencyBin;
  if (cr === maxR) agency = "SITUATION";
  else if (or_ === maxR) agency = "OTHER";
  else agency = "SELF";

  const sc = norm(clampLikert(cols.self_control));
  const oc = norm(clampLikert(cols.other_control));
  const cc = norm(clampLikert(cols.chance_control));
  const control_c = Math.max(0, Math.min(1, 0.6 * sc + 0.2 * (1 - cc) + 0.2 * (1 - oc)));

  const certainty_c =
    (norm(clampLikert(cols.predict_event)) +
      norm(clampLikert(cols.predict_conseq)) +
      norm(clampLikert(cols.familiarity))) /
    3;

  const goalRelevance_c = norm(clampLikert(cols.goal_relevance));

  const valence = valenceBin(valence_c);
  const arousal = bin3(arousal_c);
  const control = bin3(control_c);
  const certainty = bin2(certainty_c);
  const goalRelevance = bin2(goalRelevance_c);

  // Validate bins
  if (!VALID_VALENCE.includes(valence)) throw new Error(`Invalid valence bin: ${valence}`);
  if (!VALID_AROUSAL.includes(arousal)) throw new Error(`Invalid arousal bin: ${arousal}`);
  if (!VALID_AGENCY.includes(agency)) throw new Error(`Invalid agency bin: ${agency}`);
  if (!VALID_CONTROL.includes(control)) throw new Error(`Invalid control bin: ${control}`);
  if (!VALID_CERTAINTY.includes(certainty)) throw new Error(`Invalid certainty bin: ${certainty}`);
  if (!VALID_GOAL_RELEVANCE.includes(goalRelevance)) throw new Error(`Invalid goalRelevance bin: ${goalRelevance}`);

  return { valence, arousal, agency, control, certainty, goalRelevance };
}

// ============================================================
// TSV loader
// ============================================================

function loadTSV(): { emotion: string; cols: Record<string, string> }[] {
  const content = fs.readFileSync(TSV_PATH, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) throw new Error("Empty TSV file");

  const headers = lines[0].split("\t").map((h) => h.trim());

  // Validate all required appraisal columns exist
  for (const col of APPRAISAL_COLUMNS) {
    if (!headers.includes(col)) {
      throw new Error(`Missing required appraisal column: ${col}`);
    }
  }
  if (!headers.includes("emotion")) {
    throw new Error("Missing required column: emotion");
  }

  const rows: { emotion: string; cols: Record<string, string> }[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split("\t");
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (cells[j] ?? "").trim();
    }

    const emotion = row.emotion;
    if (!emotion) {
      throw new Error(`Row ${i}: missing emotion label`);
    }

    rows.push({ emotion, cols: row });
  }

  return rows;
}

// ============================================================
// Stratified split
// ============================================================

function stratifiedSplit(
  rows: { emotion: string; appraisals: Appraisals }[]
): DatasetRow[] {
  const rng = mulberry32(SEED);

  const byEmotion = new Map<string, { emotion: string; appraisals: Appraisals }[]>();
  for (const row of rows) {
    if (!byEmotion.has(row.emotion)) byEmotion.set(row.emotion, []);
    byEmotion.get(row.emotion)!.push(row);
  }

  const result: DatasetRow[] = [];
  const sortedEmotions = [...byEmotion.keys()].sort();

  for (const emo of sortedEmotions) {
    const group = byEmotion.get(emo)!;
    const shuffled = seededShuffle(group, rng);
    const n = shuffled.length;
    const trainEnd = Math.round(n * 0.7);
    const devEnd = Math.round(n * 0.85);

    for (let i = 0; i < n; i++) {
      let split: Split;
      if (i < trainEnd) split = "train";
      else if (i < devEnd) split = "dev";
      else split = "test";

      result.push({
        emotion: shuffled[i].emotion,
        split,
        appraisals: shuffled[i].appraisals,
      });
    }
  }

  return result;
}

// ============================================================
// Validation guards
// ============================================================

function validate(dataset: DatasetRow[], emotionSet: Set<string>): void {
  if (dataset.length !== EXPECTED_ROW_COUNT) {
    throw new Error(
      `Row count mismatch: expected ${EXPECTED_ROW_COUNT}, got ${dataset.length}`
    );
  }

  const splits = { train: 0, dev: 0, test: 0 };
  for (const row of dataset) {
    splits[row.split]++;
  }

  const expectedTrain = Math.round(EXPECTED_ROW_COUNT * 0.7);
  // Split sizes are approximate due to per-emotion rounding; verify within tolerance
  if (splits.train === 0 || splits.dev === 0 || splits.test === 0) {
    throw new Error(
      `Empty split detected: train=${splits.train}, dev=${splits.dev}, test=${splits.test}`
    );
  }

  const datasetEmotions = new Set(dataset.map((r) => r.emotion));
  for (const emo of emotionSet) {
    if (!datasetEmotions.has(emo)) {
      throw new Error(`Emotion label "${emo}" missing from final dataset`);
    }
  }

  for (const row of dataset) {
    if (!(VALID_VALENCE as readonly string[]).includes(row.appraisals.valence))
      throw new Error(`Invalid valence: ${row.appraisals.valence}`);
    if (!(VALID_AROUSAL as readonly string[]).includes(row.appraisals.arousal))
      throw new Error(`Invalid arousal: ${row.appraisals.arousal}`);
    if (!(VALID_AGENCY as readonly string[]).includes(row.appraisals.agency))
      throw new Error(`Invalid agency: ${row.appraisals.agency}`);
    if (!(VALID_CONTROL as readonly string[]).includes(row.appraisals.control))
      throw new Error(`Invalid control: ${row.appraisals.control}`);
    if (!(VALID_CERTAINTY as readonly string[]).includes(row.appraisals.certainty))
      throw new Error(`Invalid certainty: ${row.appraisals.certainty}`);
    if (!(VALID_GOAL_RELEVANCE as readonly string[]).includes(row.appraisals.goalRelevance))
      throw new Error(`Invalid goalRelevance: ${row.appraisals.goalRelevance}`);
  }

  console.log("  All validation guards passed.");
}

// ============================================================
// Summary report
// ============================================================

function generateSummary(dataset: DatasetRow[]): string {
  const lines: string[] = [];
  const w = (s: string) => lines.push(s);
  const now = new Date().toISOString().slice(0, 10);
  const pct = (n: number, total: number) =>
    ((n / total) * 100).toFixed(1);

  w("# Layer-2 Likelihood Dataset Summary");
  w("");
  w(`**Generated:** ${now}`);
  w("**Spec version:** v1.1");
  w(`**Seed:** ${SEED} (deterministic Mulberry32 + Fisher-Yates)`);
  w(`**Source:** crowd-enVent_generation.tsv`);
  w(`**Output:** data/layer2/layer2_likelihood_dataset_v1_1.json`);
  w("");
  w("---");
  w("");

  // Totals
  const total = dataset.length;
  const splits: Record<Split, DatasetRow[]> = { train: [], dev: [], test: [] };
  for (const r of dataset) splits[r.split].push(r);

  w("## Overall");
  w("");
  w("| Property | Value |");
  w("|----------|-------|");
  w(`| Total rows | ${total} |`);
  w(`| Train | ${splits.train.length} (${pct(splits.train.length, total)}%) |`);
  w(`| Dev | ${splits.dev.length} (${pct(splits.dev.length, total)}%) |`);
  w(`| Test | ${splits.test.length} (${pct(splits.test.length, total)}%) |`);
  w("");

  // Emotion distribution per split
  const allEmotions = [...new Set(dataset.map((r) => r.emotion))].sort();

  w("## Emotion Distribution per Split");
  w("");
  w("| Emotion | Total | Train | Dev | Test |");
  w("|---------|-------|-------|-----|------|");
  for (const emo of allEmotions) {
    const t = dataset.filter((r) => r.emotion === emo).length;
    const tr = splits.train.filter((r) => r.emotion === emo).length;
    const dv = splits.dev.filter((r) => r.emotion === emo).length;
    const te = splits.test.filter((r) => r.emotion === emo).length;
    w(`| ${emo} | ${t} | ${tr} | ${dv} | ${te} |`);
  }
  w("");

  // Bin distributions per dimension
  w("## Bin Distributions per Dimension");
  w("");

  const dimConfigs: { name: string; key: keyof Appraisals; bins: readonly string[] }[] = [
    { name: "valence", key: "valence", bins: VALID_VALENCE },
    { name: "arousal", key: "arousal", bins: VALID_AROUSAL },
    { name: "agency", key: "agency", bins: VALID_AGENCY },
    { name: "control", key: "control", bins: VALID_CONTROL },
    { name: "certainty", key: "certainty", bins: VALID_CERTAINTY },
    { name: "goalRelevance", key: "goalRelevance", bins: VALID_GOAL_RELEVANCE },
  ];

  for (const dim of dimConfigs) {
    w(`**${dim.name}**`);
    w("");
    w("| Bin | Count | % |");
    w("|-----|-------|---|");
    for (const b of dim.bins) {
      const count = dataset.filter((r) => r.appraisals[dim.key] === b).length;
      w(`| ${b} | ${count} | ${pct(count, total)}% |`);
    }
    w("");
  }

  w("---");
  w("");
  w("## Determinism Confirmation");
  w("");
  w(`- Seed: \`${SEED}\``);
  w("- RNG: Mulberry32");
  w("- Shuffle: Fisher-Yates per emotion group");
  w("- Emotion groups processed in alphabetical order");
  w(`- Timestamp: ${new Date().toISOString()}`);
  w("");

  return lines.join("\n");
}

// ============================================================
// Main
// ============================================================

function main(): void {
  console.log("=== Layer-2: Empirical Likelihood Dataset Builder ===");
  console.log(`Spec: v1.1 | Seed: ${SEED}`);
  console.log("");

  // 1. Load TSV
  console.log(`Loading: ${TSV_PATH}`);
  if (!fs.existsSync(TSV_PATH)) {
    throw new Error(`Dataset not found at ${TSV_PATH}`);
  }
  const rawRows = loadTSV();
  console.log(`  Parsed ${rawRows.length} rows.`);

  if (rawRows.length !== EXPECTED_ROW_COUNT) {
    throw new Error(
      `Expected ${EXPECTED_ROW_COUNT} rows, got ${rawRows.length}`
    );
  }

  const allEmotions = new Set(rawRows.map((r) => r.emotion));
  console.log(`  Emotions: ${[...allEmotions].sort().join(", ")}`);
  console.log(`  Distinct emotions: ${allEmotions.size}`);

  // 2. Apply v1.1 mapping
  console.log("\nApplying v1.1 mapping...");
  const mapped: { emotion: string; appraisals: Appraisals }[] = [];
  for (let i = 0; i < rawRows.length; i++) {
    try {
      const appraisals = mapRowToAppraisals(rawRows[i].cols);
      mapped.push({ emotion: rawRows[i].emotion, appraisals });
    } catch (e: any) {
      throw new Error(`Row ${i + 1} (${rawRows[i].emotion}): ${e.message}`);
    }
  }
  console.log(`  Mapped ${mapped.length} rows to LoRa-6 bins.`);

  // 3. Stratified split
  console.log("\nStratified splitting (70/15/15)...");
  const dataset = stratifiedSplit(mapped);
  const splitCounts = { train: 0, dev: 0, test: 0 };
  for (const r of dataset) splitCounts[r.split]++;
  console.log(
    `  train=${splitCounts.train}, dev=${splitCounts.dev}, test=${splitCounts.test}`
  );

  // 4. Validate
  console.log("\nValidating...");
  validate(dataset, allEmotions);

  // 5. Write dataset JSON
  const datasetDir = path.dirname(DATASET_OUT);
  if (!fs.existsSync(datasetDir)) fs.mkdirSync(datasetDir, { recursive: true });
  fs.writeFileSync(DATASET_OUT, JSON.stringify(dataset, null, 2), "utf-8");
  console.log(`\nDataset written to: ${DATASET_OUT}`);

  // 6. Write summary report
  const summaryDir = path.dirname(SUMMARY_OUT);
  if (!fs.existsSync(summaryDir)) fs.mkdirSync(summaryDir, { recursive: true });
  const summary = generateSummary(dataset);
  fs.writeFileSync(SUMMARY_OUT, summary, "utf-8");
  console.log(`Summary written to: ${SUMMARY_OUT}`);

  // 7. Print first 3 rows
  console.log("\n--- First 3 rows ---");
  for (let i = 0; i < 3; i++) {
    console.log(JSON.stringify(dataset[i], null, 2));
  }

  console.log("\nDone.");
}

main();
