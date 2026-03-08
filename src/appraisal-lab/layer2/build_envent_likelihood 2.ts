/**
 * Layer-2: Build empirical likelihood tables from crowd-enVent.
 *
 * Outputs (versioned, non-overwriting):
 *  - models/likelihoods/envent_likelihood_writer_v1.json
 *  - models/likelihoods/envent_likelihood_reader_v1.json
 */

import * as fs from "fs";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const WRITER_DATASET_PATH = path.join(REPO_ROOT, "data", "layer2", "layer2_likelihood_dataset_v1_1.json");
const IRR_PATH = path.join(REPO_ROOT, "data", "layer2", "irr_kappa_table.csv");
const VALIDATION_TSV_PATH = path.join(
  REPO_ROOT,
  "src",
  "appraisal-lab",
  "dataset",
  "crowd-enVent2023",
  "corpus",
  "crowd-enVent_validation.tsv"
);
const WRITER_OUT_PATH = path.join(REPO_ROOT, "models", "likelihoods", "envent_likelihood_writer_v1.json");
const READER_OUT_PATH = path.join(REPO_ROOT, "models", "likelihoods", "envent_likelihood_reader_v1.json");

const ALPHA = 1;
const TRAIN_SIZE_EXPECTED = 4621;
const SUM_TOL = 1e-10;

const DIMENSIONS = ["valence", "arousal", "agency", "control", "certainty", "goalRelevance"] as const;
type Dimension = (typeof DIMENSIONS)[number];

type WriterRow = {
  emotion: string;
  split: "train" | "dev" | "test";
  appraisals: Record<Dimension, string>;
};

type LikelihoodTable = {
  version: string;
  alpha: number;
  priors: Record<string, number>;
  likelihoods: Record<string, Record<string, Record<string, number>>>;
};

function assertFileExists(p: string): void {
  if (!fs.existsSync(p)) throw new Error(`Missing file: ${p}`);
}

function median(nums: number[]): number {
  const s = nums.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

function norm(x: number): number {
  return (x - 1) / 4;
}

function valenceBin(v: number): "NEG" | "NEU" | "POS" {
  if (v < 0.333) return "NEG";
  if (v < 0.667) return "NEU";
  return "POS";
}
function bin3(v: number): "LOW" | "MED" | "HIGH" {
  if (v < 0.333) return "LOW";
  if (v < 0.667) return "MED";
  return "HIGH";
}
function bin2(v: number): "LOW" | "HIGH" {
  return v < 0.5 ? "LOW" : "HIGH";
}

function validateDistribution(name: string, probs: Record<string, number>): void {
  let s = 0;
  let maxP = -Infinity;
  for (const p of Object.values(probs)) {
    if (!Number.isFinite(p)) throw new Error(`${name}: NaN/Infinity probability`);
    if (p < 0) throw new Error(`${name}: negative probability`);
    s += p;
    if (p > maxP) maxP = p;
  }
  if (Math.abs(s - 1) > SUM_TOL) throw new Error(`${name}: probability sum=${s}, expected 1`);
  if (maxP > 0.99) throw new Error(`${name}: collapsed distribution (max=${maxP})`);
}

function buildFromRows(version: string, rows: Array<{ emotion: string; bins: Record<Dimension, string> }>, alpha: number): LikelihoodTable {
  if (alpha <= 0) throw new Error(`alpha must be > 0, got ${alpha}`);
  const emotions = [...new Set(rows.map((r) => r.emotion))].sort();
  if (emotions.length === 0) throw new Error("No emotions found.");
  const binsByDim: Record<Dimension, string[]> = {} as Record<Dimension, string[]>;
  for (const d of DIMENSIONS) {
    binsByDim[d] = [...new Set(rows.map((r) => r.bins[d]))].sort();
    if (binsByDim[d].length === 0) throw new Error(`Missing bins for ${d}`);
  }

  const N = rows.length;
  const K = emotions.length;
  const priorDen = N + alpha * K;

  const emotionCounts: Record<string, number> = {};
  for (const e of emotions) emotionCounts[e] = 0;
  for (const r of rows) emotionCounts[r.emotion]++;

  const priors: Record<string, number> = {};
  for (const e of emotions) priors[e] = (emotionCounts[e] + alpha) / priorDen;
  validateDistribution("priors", priors);

  const likelihoods: Record<string, Record<string, Record<string, number>>> = {};
  for (const d of DIMENSIONS) {
    likelihoods[d] = {};
    const B = binsByDim[d].length;
    for (const e of emotions) {
      const counts: Record<string, number> = {};
      for (const b of binsByDim[d]) counts[b] = 0;
      for (const r of rows) if (r.emotion === e) counts[r.bins[d]]++;
      const den = emotionCounts[e] + alpha * B;
      const probs: Record<string, number> = {};
      for (const b of binsByDim[d]) probs[b] = (counts[b] + alpha) / den;
      validateDistribution(`likelihoods.${d}.${e}`, probs);
      likelihoods[d][e] = probs;
    }
  }

  for (const d of DIMENSIONS) {
    if (!likelihoods[d]) throw new Error(`Missing dimension in likelihoods: ${d}`);
  }

  return { version, alpha, priors, likelihoods };
}

function buildWriter(): LikelihoodTable {
  const data = JSON.parse(fs.readFileSync(WRITER_DATASET_PATH, "utf-8")) as WriterRow[];
  const train = data.filter((r) => r.split === "train");
  if (train.length !== TRAIN_SIZE_EXPECTED) {
    throw new Error(`Unexpected train size: ${train.length}, expected ${TRAIN_SIZE_EXPECTED}`);
  }
  const rows = train.map((r) => ({ emotion: r.emotion, bins: r.appraisals }));

  const emoCounts = new Map<string, number>();
  for (const r of rows) emoCounts.set(r.emotion, (emoCounts.get(r.emotion) ?? 0) + 1);
  console.log(`Writer train row count: ${rows.length}`);
  console.log("Writer emotion distribution:");
  for (const e of [...emoCounts.keys()].sort()) {
    console.log(`  ${e}: ${emoCounts.get(e)}`);
  }

  const table = buildFromRows("envent_writer_v1", rows, ALPHA);
  const priorSum = Object.values(table.priors).reduce((a, b) => a + b, 0);
  console.log(`Writer priors sum = ${priorSum.toFixed(6)}`);
  return table;
}

function buildReader(): LikelihoodTable {
  const lines = fs.readFileSync(VALIDATION_TSV_PATH, "utf-8").split("\n").filter((l) => l.trim());
  const headers = lines[0].split("\t");
  const idx = (c: string) => headers.indexOf(c);
  const required = [
    "text_id",
    "original_emotion",
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
    "urgency",
    "self_control",
    "other_control",
    "chance_control",
    "attention",
  ];
  const miss = required.filter((c) => idx(c) < 0);
  if (miss.length) throw new Error(`Validation TSV missing columns: ${miss.join(", ")}`);

  const byText = new Map<string, Array<{ emo: string; v: Record<string, number> }>>();
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split("\t");
    const tid = (c[idx("text_id")] ?? "").trim();
    const emo = (c[idx("original_emotion")] ?? "").trim();
    const vals: Record<string, number> = {};
    for (const k of required.slice(2)) {
      const n = Number((c[idx(k)] ?? "").trim());
      if (!Number.isFinite(n)) throw new Error(`Non-numeric ${k} at row ${i + 1}`);
      vals[k] = n;
    }
    if (!byText.has(tid)) byText.set(tid, []);
    byText.get(tid)!.push({ emo, v: vals });
  }

  const rows: Array<{ emotion: string; bins: Record<Dimension, string> }> = [];
  for (const [tid, rs] of byText) {
    if (rs.length !== 5) throw new Error(`text_id ${tid} has ${rs.length} rows (expected 5)`);
    const emoSet = new Set(rs.map((r) => r.emo));
    if (emoSet.size !== 1) throw new Error(`text_id ${tid} has inconsistent original_emotion`);
    const med: Record<string, number> = {};
    for (const k of required.slice(2)) med[k] = median(rs.map((r) => r.v[k]));

    const valence = (med.pleasantness - med.unpleasantness + 4) / 8;
    const arousal = (norm(med.suddenness) + norm(med.urgency) + norm(med.attention)) / 3;
    const control = 0.6 * norm(med.self_control) + 0.2 * (1 - norm(med.chance_control)) + 0.2 * (1 - norm(med.other_control));
    const certainty = (norm(med.predict_event) + norm(med.predict_conseq) + norm(med.familiarity)) / 3;
    const goalRel = norm(med.goal_relevance);
    const sr = med.self_responsblt;
    const or = med.other_responsblt;
    const cr = med.chance_responsblt;
    const m = Math.max(sr, or, cr);
    const agency: "SELF" | "OTHER" | "SITUATION" = cr === m ? "SITUATION" : or === m ? "OTHER" : "SELF";

    rows.push({
      emotion: rs[0].emo,
      bins: {
        valence: valenceBin(valence),
        arousal: bin3(arousal),
        agency,
        control: bin3(Math.max(0, Math.min(1, control))),
        certainty: bin2(certainty),
        goalRelevance: bin2(goalRel),
      },
    });
  }

  const table = buildFromRows("envent_reader_v1", rows, ALPHA);
  const priorSum = Object.values(table.priors).reduce((a, b) => a + b, 0);
  console.log(`Reader priors sum = ${priorSum.toFixed(6)}`);
  return table;
}

function writeJsonNoOverwrite(p: string, obj: unknown): void {
  if (fs.existsSync(p)) throw new Error(`Refusing to overwrite existing artifact: ${p}`);
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf-8");
}

function main(): void {
  console.log("=== Layer-2: Build enVent Likelihood Tables ===");
  assertFileExists(WRITER_DATASET_PATH);
  assertFileExists(IRR_PATH);
  assertFileExists(VALIDATION_TSV_PATH);
  const irrRows = fs.readFileSync(IRR_PATH, "utf-8").split("\n").filter((l) => l.trim()).length - 1;
  console.log(`IRR reference rows loaded: ${irrRows}`);

  const writer = buildWriter();
  const reader = buildReader();

  writeJsonNoOverwrite(WRITER_OUT_PATH, writer);
  writeJsonNoOverwrite(READER_OUT_PATH, reader);
  console.log(`Wrote: ${WRITER_OUT_PATH}`);
  console.log(`Wrote: ${READER_OUT_PATH}`);
}

main();

