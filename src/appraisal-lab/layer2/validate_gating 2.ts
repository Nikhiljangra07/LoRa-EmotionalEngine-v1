/**
 * Layer-2 Step 7: Strengthened Gating Validation (Coverage vs Safety)
 *
 * Evaluation-only. No inference, likelihood, calibration, or schema mutation.
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
const OUT_JSON_V1 = path.join(REPO_ROOT, "data", "layer2", "gating_metrics_v1.json");
const OUT_JSON_V11 = path.join(REPO_ROOT, "data", "layer2", "gating_metrics_v1_1.json");
const OUT_MD_V1 = path.join(REPO_ROOT, "reports", "gating.md");
const OUT_MD_V11 = path.join(REPO_ROOT, "reports", "gating_v1_1.md");

const SEED = 42;
const SPLIT_TOL_ROWS = 1;
const SUM_TOL = 1e-8;

type SplitName = "train" | "dev" | "test";
type GateKey =
  | "pmax"
  | "pmax_strict"
  | "pmax_margin"
  | "pmax_margin_strict"
  | "pmax_entropy"
  | "pmax_entropy_strict";
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
  top2: CollapsedEmotion;
  pmax: number;
  margin: number;
  entropyNorm: number;
};
type HarmStats = { numerator: number; denominator: number; rate: number };
type GateRow = {
  gate: GateKey;
  t1: number;
  t2: number | null;
  t3: number | null;
  strict: boolean;
  coverage: number;
  committed: number;
  abstained: number;
  accuracy: number;
  harmful_rate: number;
  harmful_reduction: number;
  avg_entropy: number;
  avg_margin: number;
  score: number;
};

const HARMFUL_PAIRS = new Set([
  "ANGER|FEAR",
  "FEAR|ANGER",
  "ANGER|DISGUST",
  "DISGUST|ANGER",
  "SHAME|GUILT",
  "GUILT|SHAME",
]);

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}
function assertFinite(name: string, n: number): void {
  if (!Number.isFinite(n)) throw new Error(`${name} is NaN/Infinity`);
}
function fmtPct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}
function resolveOutputPath(preferred: string, versioned: string): string {
  if (!fs.existsSync(preferred)) return preferred;
  if (!fs.existsSync(versioned)) return versioned;
  throw new Error(`Both output paths exist: ${preferred} and ${versioned}`);
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
      rows.push({
        text_id,
        rawEmotion,
        collapsed: collapseEmotion(rawEmotion),
        bins: ds[i].appraisals,
      });
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
    for (; i < n; i++) splitTextIds.test.add(ids[i]);
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
  COLLAPSED_EMOTIONS.forEach((c, i) => (out[c] = exps[i] / den));
  const s = sum(Object.values(out));
  if (Math.abs(s - 1) > SUM_TOL) throw new Error(`Scaled probabilities sum=${s}, expected 1`);
  return out;
}

function inferPredictions(rows: EvalRow[], useCalibration: boolean, temperature: number | null): Pred[] {
  return rows.map((r, i) => {
    const base = inferEkman6(r.bins, DEFAULT_CONFIG).posterior;
    const probs = useCalibration ? applyTemperature(base, temperature!) : base;
    const pSum = sum(Object.values(probs));
    if (Math.abs(pSum - 1) > SUM_TOL) throw new Error(`Posterior sum mismatch at row ${i}`);

    const sorted = (Object.entries(probs) as Array<[CollapsedEmotion, number]>).sort((a, b) => b[1] - a[1]);
    const top1 = sorted[0][0];
    const top2 = sorted[1][0];
    const pmax = sorted[0][1];
    const margin = sorted[0][1] - sorted[1][1];
    let H = 0;
    for (const p of Object.values(probs)) if (p > 0) H -= p * Math.log(p);
    const entropyNorm = H / Math.log(COLLAPSED_EMOTIONS.length);
    return { gold: r.collapsed, probs, top1, top2, pmax, margin, entropyNorm };
  });
}

function harmfulStats(preds: Array<{ gold: string; top1: string }>): HarmStats {
  let num = 0;
  for (const p of preds) if (p.gold !== p.top1 && HARMFUL_PAIRS.has(`${p.gold}|${p.top1}`)) num++;
  const den = preds.length;
  const rate = den ? num / den : 0;
  if (rate < 0 || rate > 1) throw new Error(`Harmful rate out of bounds: ${rate}`);
  return { numerator: num, denominator: den, rate };
}

function accuracy(preds: Array<{ gold: string; top1: string }>): number {
  const acc = preds.filter((p) => p.gold === p.top1).length / (preds.length || 1);
  assertFinite("accuracy", acc);
  return acc;
}

function isHarmfulTop2Pair(p: Pred): boolean {
  return HARMFUL_PAIRS.has(`${p.top1}|${p.top2}`) || HARMFUL_PAIRS.has(`${p.top2}|${p.top1}`);
}

function thresholdRange(start: number, end: number, step: number): number[] {
  const out: number[] = [];
  for (let x = start; x <= end + 1e-12; x += step) out.push(Number(x.toFixed(2)));
  return out;
}

function evaluateGate(
  preds: Pred[],
  baselineHarm: HarmStats,
  gate: GateKey,
  strict: boolean,
  t1: number,
  t2: number | null,
  t3: number | null
): GateRow {
  const committed = preds.filter((p) => {
    const t1Eff = strict && isHarmfulTop2Pair(p) ? t1 + 0.05 : t1;
    if (gate.startsWith("pmax_margin")) return p.pmax >= t1Eff && p.margin >= (t2 ?? 0);
    if (gate.startsWith("pmax_entropy")) return p.pmax >= t1Eff && p.entropyNorm <= (t3 ?? 1);
    return p.pmax >= t1Eff;
  });

  const cov = committed.length / preds.length;
  const abstained = preds.length - committed.length;
  const acc = committed.length ? accuracy(committed) : 0;
  const harm = committed.length ? harmfulStats(committed) : { numerator: 0, denominator: 0, rate: 0 };
  const reduction = baselineHarm.rate === 0 ? 0 : (baselineHarm.rate - harm.rate) / baselineHarm.rate;
  const avgEntropy = committed.length ? sum(committed.map((p) => p.entropyNorm)) / committed.length : 0;
  const avgMargin = committed.length ? sum(committed.map((p) => p.margin)) / committed.length : 0;
  const score = reduction - (1 - cov);
  return {
    gate,
    t1,
    t2,
    t3,
    strict,
    coverage: cov,
    committed: committed.length,
    abstained,
    accuracy: acc,
    harmful_rate: harm.rate,
    harmful_reduction: reduction,
    avg_entropy: avgEntropy,
    avg_margin: avgMargin,
    score,
  };
}

function sortRows(rows: GateRow[]): GateRow[] {
  return rows.slice().sort((a, b) => a.t1 - b.t1 || (a.t2 ?? 0) - (b.t2 ?? 0) || (a.t3 ?? 0) - (b.t3 ?? 0));
}

function summarizeFamily(rows: GateRow[]): {
  best_reduction_at_85_coverage: GateRow | null;
  best_coverage_at_40_reduction: GateRow | null;
  absolute_best_reduction: GateRow;
} {
  const at85 = rows.filter((r) => r.coverage >= 0.85);
  const at40 = rows.filter((r) => r.harmful_reduction >= 0.40);
  return {
    best_reduction_at_85_coverage: at85.length ? at85.sort((a, b) => b.harmful_reduction - a.harmful_reduction || b.coverage - a.coverage)[0] : null,
    best_coverage_at_40_reduction: at40.length ? at40.sort((a, b) => b.coverage - a.coverage || b.harmful_reduction - a.harmful_reduction)[0] : null,
    absolute_best_reduction: rows.slice().sort((a, b) => b.harmful_reduction - a.harmful_reduction || b.coverage - a.coverage)[0],
  };
}

function histogramPmax(preds: Pred[]): Array<{ bin: string; count: number; percentage: number }> {
  const bins = Array.from({ length: 10 }, (_, i) => ({
    lo: i / 10,
    hi: (i + 1) / 10,
    count: 0,
  }));
  for (const p of preds) {
    const idx = Math.min(9, Math.floor(p.pmax * 10));
    bins[idx].count += 1;
  }
  return bins.map((b) => ({
    bin: `${b.lo.toFixed(1)}-${b.hi.toFixed(1)}`,
    count: b.count,
    percentage: b.count / preds.length,
  }));
}

function applyGuards(results: Record<GateKey, GateRow[]>, baselineHarmRate: number): void {
  for (const rows of Object.values(results)) {
    const bySweep = new Map<string, GateRow[]>();
    for (const r of rows) {
      if (r.harmful_rate < 0) throw new Error(`Negative harmful rate for ${r.gate}`);
      const key = `${r.gate}|${r.t2 ?? "x"}|${r.t3 ?? "x"}`;
      if (!bySweep.has(key)) bySweep.set(key, []);
      bySweep.get(key)!.push(r);
    }
    for (const sweepRows of bySweep.values()) {
      const sorted = sweepRows.slice().sort((a, b) => a.t1 - b.t1);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].coverage - sorted[i - 1].coverage > 1e-12) {
          throw new Error(`Coverage increased when threshold increased for ${sorted[i].gate}`);
        }
      }
      for (const r of sorted.filter((x) => x.t1 >= 0.7 && x.coverage >= 0.05)) {
        if (r.harmful_rate - baselineHarmRate > 1e-12) {
          throw new Error(`High-threshold harmful rate exceeded baseline for ${r.gate} @ t1=${r.t1}`);
        }
      }
    }
  }
}

function main(): void {
  console.log("=== Layer-2: Strengthened Gating Validation ===");
  if (!fs.existsSync(DATASET_PATH)) throw new Error(`Missing input: ${DATASET_PATH}`);
  if (!fs.existsSync(GENERATION_TSV_PATH)) throw new Error(`Missing input: ${GENERATION_TSV_PATH}`);
  const outJson = resolveOutputPath(OUT_JSON_V1, OUT_JSON_V11);
  const outMd = resolveOutputPath(OUT_MD_V1, OUT_MD_V11);

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
  const pmaxHist = histogramPmax(preds);

  const t1A = thresholdRange(0.3, 0.95, 0.01);
  const t1BC = thresholdRange(0.2, 0.8, 0.01);
  const marginGrid = [0.05, 0.1, 0.15, 0.2];
  const entropyGrid = [0.85, 0.8, 0.75, 0.7];

  const results: Record<GateKey, GateRow[]> = {
    pmax: [],
    pmax_strict: [],
    pmax_margin: [],
    pmax_margin_strict: [],
    pmax_entropy: [],
    pmax_entropy_strict: [],
  };

  for (const t1 of t1A) {
    results.pmax.push(evaluateGate(preds, baselineHarm, "pmax", false, t1, null, null));
    results.pmax_strict.push(evaluateGate(preds, baselineHarm, "pmax_strict", true, t1, null, null));
  }
  for (const t2 of marginGrid) {
    for (const t1 of t1BC) {
      results.pmax_margin.push(evaluateGate(preds, baselineHarm, "pmax_margin", false, t1, t2, null));
      results.pmax_margin_strict.push(evaluateGate(preds, baselineHarm, "pmax_margin_strict", true, t1, t2, null));
    }
  }
  for (const t3 of entropyGrid) {
    for (const t1 of t1BC) {
      results.pmax_entropy.push(evaluateGate(preds, baselineHarm, "pmax_entropy", false, t1, null, t3));
      results.pmax_entropy_strict.push(evaluateGate(preds, baselineHarm, "pmax_entropy_strict", true, t1, null, t3));
    }
  }

  // Report rows with >=5% coverage only.
  for (const key of Object.keys(results) as GateKey[]) {
    results[key] = sortRows(results[key].filter((r) => r.coverage >= 0.05));
    if (!results[key].length) throw new Error(`No reportable rows for ${key}`);
  }

  applyGuards(results, baselineHarm.rate);

  const familySummary = {
    pmax: summarizeFamily(results.pmax),
    pmax_strict: summarizeFamily(results.pmax_strict),
    pmax_margin: summarizeFamily(results.pmax_margin),
    pmax_margin_strict: summarizeFamily(results.pmax_margin_strict),
    pmax_entropy: summarizeFamily(results.pmax_entropy),
    pmax_entropy_strict: summarizeFamily(results.pmax_entropy_strict),
  };

  const allRows = (Object.values(results).flat() as GateRow[]).filter((r) => r.coverage >= 0.05);
  const satisfying = allRows.filter((r) => r.coverage >= 0.85 && r.harmful_reduction >= 0.4);
  const constraintsMet = satisfying.length > 0;
  const selected = constraintsMet
    ? satisfying.sort((a, b) => b.coverage - a.coverage || b.harmful_reduction - a.harmful_reduction)[0]
    : allRows.sort((a, b) => b.score - a.score || b.harmful_reduction - a.harmful_reduction || b.coverage - a.coverage)[0];
  const selectionReason = constraintsMet
    ? "Meets target constraints: coverage >= 85% and harmful reduction >= 40%."
    : "No operating point satisfies both constraints; selected by balanced score = harmful_reduction - (1 - coverage).";

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
      coverage: 1,
    },
    gate_results: results,
    family_summary: familySummary,
    selected_operating_point: {
      gate: selected.gate,
      t1: selected.t1,
      t2: selected.t2,
      t3: selected.t3,
      strict: selected.strict,
      coverage: selected.coverage,
      accuracy: selected.accuracy,
      harmful_rate: selected.harmful_rate,
      harmful_reduction: selected.harmful_reduction,
      abstention_rate: selected.abstained / preds.length,
      score: selected.score,
      constraints_met: constraintsMet,
      selection_reason: selectionReason,
    },
    pmax_histogram: {
      bins: pmaxHist,
    },
    backward_compatibility: {
      threshold_rows: results.pmax,
      curves: {
        coverage_vs_accuracy: results.pmax.map((r) => ({ threshold: r.t1, coverage: r.coverage, accuracy: r.accuracy })),
        coverage_vs_harmful_rate: results.pmax.map((r) => ({ threshold: r.t1, coverage: r.coverage, harmful_rate: r.harmful_rate })),
        coverage_vs_harmful_reduction: results.pmax.map((r) => ({
          threshold: r.t1,
          coverage: r.coverage,
          harmful_reduction: r.harmful_reduction,
        })),
      },
    },
  };

  fs.mkdirSync(path.dirname(outJson), { recursive: true });
  fs.writeFileSync(outJson, JSON.stringify(jsonOut, null, 2), "utf-8");

  const md: string[] = [];
  md.push("# Gating Validation (Coverage vs Safety) — v1.1");
  md.push("");
  md.push(`Generated: ${new Date().toISOString()}`);
  md.push(`Probability source: ${useCalibration ? `calibrated (T=${temperature!.toFixed(2)})` : "uncalibrated"}`);
  md.push("");
  md.push("## 1) Baseline metrics");
  md.push("");
  md.push(`- Accuracy: ${fmtPct(baselineAcc)}`);
  md.push(`- Harmful confusion: ${baselineHarm.numerator}/${baselineHarm.denominator} (${fmtPct(baselineHarm.rate)})`);
  md.push(`- Coverage: 100%`);
  md.push("");
  md.push("## 2) Gate family summary");
  md.push("");
  md.push("| Gate family | Best harmful reduction @ coverage>=85% | Best coverage @ harmful reduction>=40% | Absolute best harmful reduction |");
  md.push("|---|---|---|---|");
  for (const key of Object.keys(familySummary) as Array<keyof typeof familySummary>) {
    const s = familySummary[key];
    const c85 = s.best_reduction_at_85_coverage
      ? `${fmtPct(s.best_reduction_at_85_coverage.harmful_reduction)} (cov ${fmtPct(s.best_reduction_at_85_coverage.coverage)})`
      : "none";
    const r40 = s.best_coverage_at_40_reduction
      ? `${fmtPct(s.best_coverage_at_40_reduction.coverage)} (red ${fmtPct(s.best_coverage_at_40_reduction.harmful_reduction)})`
      : "none";
    const abs = `${fmtPct(s.absolute_best_reduction.harmful_reduction)} (cov ${fmtPct(s.absolute_best_reduction.coverage)})`;
    md.push(`| ${key} | ${c85} | ${r40} | ${abs} |`);
  }
  md.push("");
  if (!constraintsMet) {
    md.push("**No operating point satisfies both constraints.**");
    md.push("");
  }
  md.push("## 3) Tradeoff table (compact)");
  md.push("");
  md.push("| Gate | Threshold config | Coverage | Accuracy | Harmful rate | Harmful reduction |");
  md.push("|---|---|---:|---:|---:|---:|");
  const compactRows = [
    familySummary.pmax.best_reduction_at_85_coverage ?? familySummary.pmax.absolute_best_reduction,
    familySummary.pmax_strict.best_reduction_at_85_coverage ?? familySummary.pmax_strict.absolute_best_reduction,
    familySummary.pmax_margin.best_reduction_at_85_coverage ?? familySummary.pmax_margin.absolute_best_reduction,
    familySummary.pmax_margin_strict.best_reduction_at_85_coverage ?? familySummary.pmax_margin_strict.absolute_best_reduction,
    familySummary.pmax_entropy.best_reduction_at_85_coverage ?? familySummary.pmax_entropy.absolute_best_reduction,
    familySummary.pmax_entropy_strict.best_reduction_at_85_coverage ?? familySummary.pmax_entropy_strict.absolute_best_reduction,
  ];
  for (const r of compactRows) {
    const cfg = `t1=${r.t1.toFixed(2)}${r.t2 !== null ? `, t2=${r.t2.toFixed(2)}` : ""}${r.t3 !== null ? `, t3=${r.t3.toFixed(2)}` : ""}`;
    md.push(`| ${r.gate} | ${cfg} | ${fmtPct(r.coverage)} | ${fmtPct(r.accuracy)} | ${fmtPct(r.harmful_rate)} | ${fmtPct(r.harmful_reduction)} |`);
  }
  md.push("");
  md.push("## 4) Confidence Distribution (TEST)");
  md.push("");
  md.push("| pmax bin | Count | Percentage |");
  md.push("|---|---:|---:|");
  for (const h of pmaxHist) md.push(`| ${h.bin} | ${h.count} | ${fmtPct(h.percentage)} |`);
  md.push("");
  md.push("## 5) Selected operating point");
  md.push("");
  md.push(`- Gate: ${selected.gate}`);
  md.push(`- Threshold config: t1=${selected.t1.toFixed(2)}${selected.t2 !== null ? `, t2=${selected.t2.toFixed(2)}` : ""}${selected.t3 !== null ? `, t3=${selected.t3.toFixed(2)}` : ""}`);
  md.push(`- Coverage: ${fmtPct(selected.coverage)}`);
  md.push(`- Accuracy (committed): ${fmtPct(selected.accuracy)}`);
  md.push(`- Harmful rate (committed): ${fmtPct(selected.harmful_rate)}`);
  md.push(`- Harmful reduction: ${fmtPct(selected.harmful_reduction)}`);
  md.push(`- Abstention rate: ${fmtPct(selected.abstained / preds.length)}`);
  md.push(`- Selection rationale: ${selectionReason}`);
  md.push("");
  md.push("## 6) Interpretation");
  md.push("");
  md.push("- Gating is evaluated as a safety filter: harmful reduction is primary, and coverage quantifies usability cost.");
  md.push("- Accuracy can rise from abstention; this is expected and should not be interpreted as model improvement.");
  md.push("- The target (coverage >=85% and harmful reduction >=40%) is reported explicitly as achievable or not under current distributions.");
  md.push("- Performance limits are tied to confidence concentration, class collapse (13->Ekman-6+Neutral), and reliability-weighted inference behavior; this step does not alter those mechanics.");
  md.push("");

  fs.mkdirSync(path.dirname(outMd), { recursive: true });
  fs.writeFileSync(outMd, md.join("\n"), "utf-8");

  console.log(`Wrote: ${outJson}`);
  console.log(`Wrote: ${outMd}`);
  console.log(`Baseline harmful ${fmtPct(baselineHarm.rate)}`);
  console.log(`Best >=85% coverage reduction (pmax): ${familySummary.pmax.best_reduction_at_85_coverage ? fmtPct(familySummary.pmax.best_reduction_at_85_coverage.harmful_reduction) : "none"}`);
  console.log(`Best >=40% reduction coverage (pmax): ${familySummary.pmax.best_coverage_at_40_reduction ? fmtPct(familySummary.pmax.best_coverage_at_40_reduction.coverage) : "none"}`);
  console.log(`Selected: ${selected.gate} @ t1=${selected.t1.toFixed(2)}; coverage=${fmtPct(selected.coverage)} reduction=${fmtPct(selected.harmful_reduction)}`);
}

main();

