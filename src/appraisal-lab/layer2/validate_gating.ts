/**
 * Layer-2 Step 7: Gating Validation (Coverage vs Safety)
 *
 * Evaluation-only. No inference or likelihood mutations.
 * Produces:
 *   - data/layer2/gating_metrics_v1.json
 *   - reports/gating.md
 */

import * as fs from "fs";
import * as path from "path";
import { collapseEmotion, COLLAPSED_EMOTIONS, CollapsedEmotion } from "./emotion_collapse_map";
import { inferEkman6, DEFAULT_CONFIG } from "./infer_ekman6";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const DATASET_PATH = path.join(REPO_ROOT, "data", "layer2", "layer2_likelihood_dataset_v1_1.json");
const GENERATION_TSV_PATH = path.join(
  REPO_ROOT,
  "src",
  "appraisal-lab",
  "dataset",
  "crowd-enVent2023",
  "corpus",
  "crowd-enVent_generation.tsv"
);
const CALIB_PATH = path.join(REPO_ROOT, "data", "layer2", "calibration_metrics_v1.json");
const OUT_JSON = path.join(REPO_ROOT, "data", "layer2", "gating_metrics_v1.json");
const OUT_MD = path.join(REPO_ROOT, "reports", "gating.md");

const SEED = 42;
const SPLIT_TOL_ROWS = 1;
const SUM_TOL = 1e-8;

type SplitName = "train" | "dev" | "test";
type Bins = {
  valence: "NEG" | "NEU" | "POS";
  arousal: "LOW" | "MED" | "HIGH";
  agency: "SELF" | "OTHER" | "SITUATION";
  control: "LOW" | "MED" | "HIGH";
  certainty: "LOW" | "HIGH";
  goalRelevance: "LOW" | "HIGH";
};
type DatasetRow = {
  emotion: string;
  split: SplitName;
  appraisals: Bins;
};
type EvalRow = {
  text_id: string;
  rawEmotion: string;
  collapsed: CollapsedEmotion;
  bins: Bins;
};
type Pred = {
  gold: CollapsedEmotion;
  probs: Record<CollapsedEmotion, number>;
  top1: CollapsedEmotion;
  pmax: number;
  margin: number;
  entropy: number;
  entropyNorm: number;
};

function assertNotExists(p: string): void {
  if (fs.existsSync(p)) throw new Error(`Output already exists (refusing overwrite): ${p}`);
}
function assertFinite(name: string, n: number): void {
  if (!Number.isFinite(n)) throw new Error(`${name} is NaN/Infinity`);
}
function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

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
function argmaxObj<T extends string>(obj: Record<T, number>): T {
  const entries = Object.entries(obj) as Array<[T, number]>;
  return entries.sort((a, b) => b[1] - a[1])[0][0];
}

function loadRowsWithTextId(): EvalRow[] {
  const ds = JSON.parse(fs.readFileSync(DATASET_PATH, "utf-8")) as DatasetRow[];
  const lines = fs.readFileSync(GENERATION_TSV_PATH, "utf-8").split("\n").filter((l) => l.trim());
  const headers = lines[0].split("\t");
  const textIdIdx = headers.indexOf("text_id");
  const emotionIdx = headers.indexOf("emotion");
  if (textIdIdx < 0 || emotionIdx < 0) throw new Error("generation TSV missing text_id/emotion");
  if (ds.length !== lines.length - 1) throw new Error("dataset/generation row mismatch");

  const rows: EvalRow[] = [];
  let excluded = 0;
  for (let i = 0; i < ds.length; i++) {
    const tsv = lines[i + 1].split("\t");
    const text_id = (tsv[textIdIdx] ?? "").trim();
    const rawEmotion = (tsv[emotionIdx] ?? "").trim();
    if (rawEmotion !== ds[i].emotion.trim()) throw new Error(`row alignment mismatch at ${i}`);
    try {
      const collapsed = collapseEmotion(rawEmotion);
      rows.push({ text_id, rawEmotion, collapsed, bins: ds[i].appraisals });
    } catch {
      excluded++;
    }
  }
  if (excluded > 0) console.log(`Excluded unsupported rows: ${excluded}`);
  return rows;
}

function splitByTextId(rows: EvalRow[]): Record<SplitName, EvalRow[]> {
  const byText = new Map<string, EvalRow[]>();
  for (const r of rows) {
    if (!byText.has(r.text_id)) byText.set(r.text_id, []);
    byText.get(r.text_id)!.push(r);
  }
  const textGroups: Array<{ text_id: string; collapsed: CollapsedEmotion }> = [];
  for (const [tid, rs] of byText) {
    const counts = new Map<CollapsedEmotion, number>();
    for (const r of rs) counts.set(r.collapsed, (counts.get(r.collapsed) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))[0][0];
    textGroups.push({ text_id: tid, collapsed: top });
  }
  const byEmotion = new Map<CollapsedEmotion, string[]>();
  for (const g of textGroups) {
    if (!byEmotion.has(g.collapsed)) byEmotion.set(g.collapsed, []);
    byEmotion.get(g.collapsed)!.push(g.text_id);
  }
  const splitTextIds: Record<SplitName, Set<string>> = { train: new Set(), dev: new Set(), test: new Set() };
  const rng = mulberry32(SEED);
  for (const emo of [...byEmotion.keys()].sort()) {
    const ids = seededShuffle(byEmotion.get(emo)!, rng);
    const n = ids.length;
    const nTrain = Math.round(n * 0.7);
    const nDev = Math.round(n * 0.15);
    const nTest = n - nTrain - nDev;
    if (Math.abs(nTrain - n * 0.7) > SPLIT_TOL_ROWS) throw new Error(`split tolerance exceeded for ${emo} train`);
    if (Math.abs(nDev - n * 0.15) > SPLIT_TOL_ROWS) throw new Error(`split tolerance exceeded for ${emo} dev`);
    if (Math.abs(nTest - n * 0.15) > SPLIT_TOL_ROWS) throw new Error(`split tolerance exceeded for ${emo} test`);
    let i = 0;
    for (; i < nTrain; i++) splitTextIds.train.add(ids[i]);
    for (; i < nTrain + nDev; i++) splitTextIds.dev.add(ids[i]);
    for (; i < ids.length; i++) splitTextIds.test.add(ids[i]);
  }
  for (const id of splitTextIds.train) if (splitTextIds.dev.has(id) || splitTextIds.test.has(id)) throw new Error(`text_id overlap: ${id}`);
  for (const id of splitTextIds.dev) if (splitTextIds.test.has(id)) throw new Error(`text_id overlap: ${id}`);
  const out: Record<SplitName, EvalRow[]> = { train: [], dev: [], test: [] };
  for (const r of rows) {
    if (splitTextIds.train.has(r.text_id)) out.train.push(r);
    else if (splitTextIds.dev.has(r.text_id)) out.dev.push(r);
    else if (splitTextIds.test.has(r.text_id)) out.test.push(r);
    else throw new Error(`missing split for text_id ${r.text_id}`);
  }
  return out;
}

function applyTemperature(probs: Record<CollapsedEmotion, number>, T: number): Record<CollapsedEmotion, number> {
  if (!(T > 0)) throw new Error(`Invalid T: ${T}`);
  const logits: Record<CollapsedEmotion, number> = {} as Record<CollapsedEmotion, number>;
  for (const c of COLLAPSED_EMOTIONS) {
    const p = probs[c];
    if (!(p > 0)) throw new Error(`Non-positive probability for ${c}: ${p}`);
    logits[c] = Math.log(p) / T;
  }
  const maxLog = Math.max(...COLLAPSED_EMOTIONS.map((c) => logits[c]));
  const exps = COLLAPSED_EMOTIONS.map((c) => Math.exp(logits[c] - maxLog));
  const den = sum(exps);
  const out: Record<CollapsedEmotion, number> = {} as Record<CollapsedEmotion, number>;
  COLLAPSED_EMOTIONS.forEach((c, i) => {
    out[c] = exps[i] / den;
  });
  const s = Object.values(out).reduce((a, b) => a + b, 0);
  if (Math.abs(s - 1) > SUM_TOL) throw new Error(`Scaled probabilities sum=${s}, expected 1`);
  return out;
}

function inferPredictions(rows: EvalRow[], useCalibration: boolean, temperature: number | null): Pred[] {
  return rows.map((r, i) => {
    const base = inferEkman6(r.bins, DEFAULT_CONFIG).posterior;
    const probs = useCalibration ? applyTemperature(base, temperature!) : base;
    const pSum = Object.values(probs).reduce((a, b) => a + b, 0);
    if (Math.abs(pSum - 1) > SUM_TOL) throw new Error(`Posterior sum mismatch at row ${i}`);
    const top1 = argmaxObj(probs);
    const pmax = probs[top1];
    const sorted = Object.values(probs).sort((a, b) => b - a);
    const margin = (sorted[0] ?? 0) - (sorted[1] ?? 0);
    let H = 0;
    for (const p of Object.values(probs)) if (p > 0) H -= p * Math.log(p);
    const Hn = H / Math.log(COLLAPSED_EMOTIONS.length);
    return { gold: r.collapsed, probs, top1, pmax, margin, entropy: H, entropyNorm: Hn };
  });
}

function harmfulStats(preds: Array<{ gold: CollapsedEmotion; top1: CollapsedEmotion }>): { numerator: number; denominator: number; rate: number } {
  const harmfulPairs = new Set(["ANGER|FEAR", "FEAR|ANGER", "ANGER|DISGUST", "DISGUST|ANGER"]);
  let num = 0;
  for (const p of preds) {
    if (p.gold !== p.top1 && harmfulPairs.has(`${p.gold}|${p.top1}`)) num++;
  }
  const den = preds.length;
  const rate = den ? num / den : 0;
  if (rate < 0 || rate > 1) throw new Error(`Harmful rate out of bounds: ${rate}`);
  return { numerator: num, denominator: den, rate };
}

function accuracy(preds: Array<{ gold: CollapsedEmotion; top1: CollapsedEmotion }>): number {
  const acc = preds.filter((p) => p.gold === p.top1).length / (preds.length || 1);
  assertFinite("accuracy", acc);
  return acc;
}

function main(): void {
  console.log("=== Layer-2: Gating Validation ===");
  assertNotExists(OUT_JSON);
  assertNotExists(OUT_MD);
  if (!fs.existsSync(DATASET_PATH)) throw new Error(`Missing input: ${DATASET_PATH}`);
  if (!fs.existsSync(GENERATION_TSV_PATH)) throw new Error(`Missing input: ${GENERATION_TSV_PATH}`);

  const rows = loadRowsWithTextId();
  const splits = splitByTextId(rows);
  const testRows = splits.test;

  let useCalibration = false;
  let temperature: number | null = null;
  if (fs.existsSync(CALIB_PATH)) {
    const calib = JSON.parse(fs.readFileSync(CALIB_PATH, "utf-8")) as { calibration?: { optimal_temperature?: number } };
    if (calib.calibration?.optimal_temperature && calib.calibration.optimal_temperature > 0) {
      useCalibration = true;
      temperature = calib.calibration.optimal_temperature;
    }
  }
  console.log(`Probability source: ${useCalibration ? `calibrated (T=${temperature!.toFixed(2)})` : "uncalibrated"}`);

  const preds = inferPredictions(testRows, useCalibration, temperature);
  const baselineAcc = accuracy(preds);
  const baselineHarm = harmfulStats(preds);

  type Row = {
    threshold: number;
    coverage: number;
    committed: number;
    abstained: number;
    accuracy_committed: number;
    harmful_rate_committed: number;
    harmful_reduction_vs_baseline: number;
    avg_entropy_committed: number;
    avg_margin_committed: number;
  };
  const sweep: Row[] = [];

  for (let t = 0.3; t <= 0.95 + 1e-12; t += 0.01) {
    const th = Number(t.toFixed(2));
    const committed = preds.filter((p) => p.pmax >= th);
    const cov = committed.length / preds.length;
    const abstained = preds.length - committed.length;
    const acc = committed.length ? accuracy(committed) : 0;
    const harm = committed.length ? harmfulStats(committed).rate : 0;
    if (harm < 0) throw new Error(`Negative harmful rate at threshold ${th}`);
    const reduction = baselineHarm.rate === 0 ? 0 : (baselineHarm.rate - harm) / baselineHarm.rate;
    const avgEntropy = committed.length ? sum(committed.map((p) => p.entropyNorm)) / committed.length : 0;
    const avgMargin = committed.length ? sum(committed.map((p) => p.margin)) / committed.length : 0;
    sweep.push({
      threshold: th,
      coverage: cov,
      committed: committed.length,
      abstained,
      accuracy_committed: acc,
      harmful_rate_committed: harm,
      harmful_reduction_vs_baseline: reduction,
      avg_entropy_committed: avgEntropy,
      avg_margin_committed: avgMargin,
    });
  }

  // Guards
  for (let i = 1; i < sweep.length; i++) {
    if (sweep[i].coverage - sweep[i - 1].coverage > 1e-12) {
      throw new Error(`Coverage increased at threshold ${sweep[i].threshold}`);
    }
  }
  for (const r of sweep) {
    if (r.harmful_rate_committed < 0) throw new Error(`Negative harmful rate at ${r.threshold}`);
  }
  // high-threshold guard (reported range only)
  for (const r of sweep.filter((x) => x.threshold >= 0.85 && x.coverage >= 0.05)) {
    if (r.harmful_rate_committed - baselineHarm.rate > 1e-12) {
      throw new Error(`High-threshold harmful rate exceeded baseline at ${r.threshold}`);
    }
  }

  const reportedRows = sweep.filter((r) => r.coverage >= 0.05); // skip extreme thresholds per instruction
  if (!reportedRows.length) throw new Error("No reportable thresholds (coverage >=5%).");

  // operating point selection
  let selected = reportedRows.find((r) => r.coverage >= 0.85 && r.harmful_reduction_vs_baseline >= 0.40);
  let fallbackUsed = false;
  if (!selected) {
    fallbackUsed = true;
    const cands = reportedRows.filter((r) => r.harmful_reduction_vs_baseline >= 0.30);
    selected = cands.length
      ? cands.sort((a, b) => b.coverage - a.coverage || a.threshold - b.threshold)[0]
      : reportedRows.sort((a, b) => b.coverage - a.coverage || a.threshold - b.threshold)[0];
  }

  const jsonOut = {
    source: {
      split_logic: "deterministic split-by-text_id stratified by collapsed emotion seed=42",
      probabilities: useCalibration ? "calibrated" : "uncalibrated",
      temperature: temperature,
      test_size: preds.length,
    },
    baseline: {
      accuracy: baselineAcc,
      harmful_confusion_rate: baselineHarm,
      coverage: 1.0,
    },
    threshold_rows: reportedRows,
    curves: {
      coverage_vs_accuracy: reportedRows.map((r) => ({ threshold: r.threshold, coverage: r.coverage, accuracy: r.accuracy_committed })),
      coverage_vs_harmful_rate: reportedRows.map((r) => ({ threshold: r.threshold, coverage: r.coverage, harmful_rate: r.harmful_rate_committed })),
      coverage_vs_harmful_reduction: reportedRows.map((r) => ({ threshold: r.threshold, coverage: r.coverage, harmful_reduction: r.harmful_reduction_vs_baseline })),
    },
    selected_operating_point: {
      threshold: selected.threshold,
      coverage: selected.coverage,
      accuracy_committed: selected.accuracy_committed,
      harmful_reduction: selected.harmful_reduction_vs_baseline,
      abstention_rate: selected.abstained / preds.length,
      fallback_used: fallbackUsed,
    },
  };

  const jsonDir = path.dirname(OUT_JSON);
  if (!fs.existsSync(jsonDir)) fs.mkdirSync(jsonDir, { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(jsonOut, null, 2), "utf-8");

  const keyThresholds = [0.3, 0.45, 0.6, 0.75, 0.85];
  const keyed = keyThresholds
    .map((t) => reportedRows.find((r) => Math.abs(r.threshold - t) < 1e-9))
    .filter((x): x is Row => Boolean(x));

  const md: string[] = [];
  md.push("# Gating Validation (Coverage vs Safety)");
  md.push("");
  md.push(`Generated: ${new Date().toISOString()}`);
  md.push(`Probability source: ${useCalibration ? `calibrated (T=${temperature!.toFixed(2)})` : "uncalibrated"}`);
  md.push("");
  md.push("## 1) Baseline metrics (No Gating)");
  md.push("");
  md.push(`- Accuracy: ${(baselineAcc * 100).toFixed(2)}%`);
  md.push(`- Harmful confusion: ${baselineHarm.numerator}/${baselineHarm.denominator} (${(baselineHarm.rate * 100).toFixed(2)}%)`);
  md.push(`- Coverage: 100%`);
  md.push("");
  md.push("## 2) Curve Summary Table");
  md.push("");
  md.push("| Threshold | Coverage | Accuracy(committed) | Harmful Rate(committed) | Harmful Reduction | Avg Entropy | Avg Margin | Abstained |");
  md.push("|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const r of keyed) {
    md.push(
      `| ${r.threshold.toFixed(2)} | ${(r.coverage * 100).toFixed(1)}% | ${(r.accuracy_committed * 100).toFixed(1)}% | ${(r.harmful_rate_committed * 100).toFixed(2)}% | ${(r.harmful_reduction_vs_baseline * 100).toFixed(1)}% | ${r.avg_entropy_committed.toFixed(4)} | ${r.avg_margin_committed.toFixed(4)} | ${r.abstained} |`
    );
  }
  md.push("");
  md.push("## 3) Selected Operating Point");
  md.push("");
  md.push(`Selected Threshold: ${selected.threshold.toFixed(2)}`);
  md.push(`Coverage: ${(selected.coverage * 100).toFixed(1)}%`);
  md.push(`Accuracy (committed): ${(selected.accuracy_committed * 100).toFixed(1)}%`);
  md.push(`Harmful Reduction: ${(selected.harmful_reduction_vs_baseline * 100).toFixed(1)}%`);
  md.push(`Abstention Rate: ${((selected.abstained / preds.length) * 100).toFixed(1)}%`);
  if (fallbackUsed) {
    md.push("- Fallback used: yes (no threshold met coverage>=85% AND harmful reduction>=40%).");
  } else {
    md.push("- Fallback used: no.");
  }
  md.push("");
  md.push("## 4) Interpretation");
  md.push("");
  md.push("- Gating is a safety mechanism: it reduces harmful errors by abstaining on low-confidence cases.");
  md.push("- Committed-only accuracy can rise due to abstention; this is expected and should be interpreted with coverage.");
  md.push("- Coverage and safety are a direct tradeoff; higher thresholds are more conservative.");
  md.push(`- The selected point is ${selected.coverage < 0.8 ? "conservative" : "moderate/aggressive"} based on coverage ${(selected.coverage * 100).toFixed(1)}%.`);
  md.push("");

  const mdDir = path.dirname(OUT_MD);
  if (!fs.existsSync(mdDir)) fs.mkdirSync(mdDir, { recursive: true });
  fs.writeFileSync(OUT_MD, md.join("\n"), "utf-8");

  console.log(`Wrote: ${OUT_JSON}`);
  console.log(`Wrote: ${OUT_MD}`);
  console.log(
    `Baseline harmful ${(baselineHarm.rate * 100).toFixed(2)}% | Selected th=${selected.threshold.toFixed(2)} | Coverage ${(selected.coverage * 100).toFixed(1)}% | Harmful reduction ${(selected.harmful_reduction_vs_baseline * 100).toFixed(1)}%`
  );
}

main();

