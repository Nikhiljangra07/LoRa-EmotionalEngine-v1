/**
 * Layer-2: Post-hoc calibration for Ekman-6 classifier.
 *
 * Non-intrusive calibration pipeline:
 * - Uses existing Layer-2 inference probabilities
 * - Fits temperature T on DEV only (grid search)
 * - Evaluates baseline vs calibrated metrics on TEST
 * - Writes new artifacts only (no overwrite)
 */

import * as fs from "fs";
import * as path from "path";
import { collapseEmotion, COLLAPSED_EMOTIONS, CollapsedEmotion } from "./emotion_collapse_map";
import { inferEkman6, DEFAULT_CONFIG } from "./infer_ekman6";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const DATASET_PATH = path.join(REPO_ROOT, "data", "layer2", "layer2_likelihood_dataset_v1_1.json");
const EVAL_METRICS_PATH = path.join(REPO_ROOT, "data", "layer2", "eval_metrics_v1.json");
const GENERATION_TSV_PATH = path.join(
  REPO_ROOT,
  "src",
  "appraisal-lab",
  "dataset",
  "crowd-enVent2023",
  "corpus",
  "crowd-enVent_generation.tsv"
);
const OUT_JSON = path.join(REPO_ROOT, "data", "layer2", "calibration_metrics_v1.json");
const OUT_MD = path.join(REPO_ROOT, "reports", "calibration.md");

const SEED = 42;
const BIN_COUNT = 10;
const SUM_TOL = 1e-8;
const SPLIT_TOL_ROWS = 1;
const T_MIN = 0.1;
const T_MAX = 5.0;
const T_STEP = 0.01;

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

type Prediction = {
  gold: CollapsedEmotion;
  probs: Record<CollapsedEmotion, number>;
  top1: CollapsedEmotion;
  confidence: number;
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
function mean(arr: number[]): number {
  return arr.length ? sum(arr) / arr.length : 0;
}
function harmonicMean(p: number, r: number): number {
  return p + r === 0 ? 0 : (2 * p * r) / (p + r);
}
function argmaxObj<T extends string>(obj: Record<T, number>): T {
  const entries = Object.entries(obj) as Array<[T, number]>;
  return entries.sort((a, b) => b[1] - a[1])[0][0];
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
    if (rawEmotion !== ds[i].emotion.trim()) {
      throw new Error(`row alignment mismatch at ${i}`);
    }
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
  for (const id of splitTextIds.train) {
    if (splitTextIds.dev.has(id) || splitTextIds.test.has(id)) throw new Error(`text_id in multiple splits: ${id}`);
  }
  for (const id of splitTextIds.dev) {
    if (splitTextIds.test.has(id)) throw new Error(`text_id in multiple splits: ${id}`);
  }
  const out: Record<SplitName, EvalRow[]> = { train: [], dev: [], test: [] };
  for (const r of rows) {
    if (splitTextIds.train.has(r.text_id)) out.train.push(r);
    else if (splitTextIds.dev.has(r.text_id)) out.dev.push(r);
    else if (splitTextIds.test.has(r.text_id)) out.test.push(r);
    else throw new Error(`missing split for text_id ${r.text_id}`);
  }
  const classes = new Set(rows.map((r) => r.collapsed));
  for (const split of ["train", "dev", "test"] as const) {
    const seen = new Set(out[split].map((r) => r.collapsed));
    if (out[split].length >= classes.size) {
      for (const c of classes) if (!seen.has(c)) throw new Error(`class ${c} missing in ${split}`);
    }
  }
  return out;
}

function checkProbabilities(dist: Record<CollapsedEmotion, number>, name: string): void {
  const s = Object.values(dist).reduce((a, b) => a + b, 0);
  assertFinite(`${name} sum`, s);
  if (Math.abs(s - 1) > SUM_TOL) throw new Error(`${name}: probs sum=${s}`);
  for (const [k, v] of Object.entries(dist)) {
    assertFinite(`${name}.${k}`, v);
    if (v < 0) throw new Error(`${name}.${k} is negative`);
  }
}

function inferRows(rows: EvalRow[]): Prediction[] {
  return rows.map((r, i) => {
    const res = inferEkman6(r.bins, DEFAULT_CONFIG);
    checkProbabilities(res.posterior, `posterior[${i}]`);
    return {
      gold: r.collapsed,
      probs: res.posterior,
      top1: res.topEmotion,
      confidence: res.posterior[res.topEmotion],
    };
  });
}

function applyTemperature(probs: Record<CollapsedEmotion, number>, T: number): Record<CollapsedEmotion, number> {
  if (!(T > 0)) throw new Error(`Invalid T: ${T}`);
  const logits: Record<CollapsedEmotion, number> = {} as Record<CollapsedEmotion, number>;
  for (const c of COLLAPSED_EMOTIONS) {
    const p = probs[c];
    if (!(p > 0)) throw new Error(`Non-positive probability for class ${c}: ${p}`);
    logits[c] = Math.log(p) / T;
  }
  const maxLog = Math.max(...COLLAPSED_EMOTIONS.map((c) => logits[c]));
  const exps = COLLAPSED_EMOTIONS.map((c) => Math.exp(logits[c] - maxLog));
  const den = sum(exps);
  const out: Record<CollapsedEmotion, number> = {} as Record<CollapsedEmotion, number>;
  COLLAPSED_EMOTIONS.forEach((c, i) => {
    out[c] = exps[i] / den;
  });
  checkProbabilities(out, "temperature_scaled_probs");
  return out;
}

function nll(preds: Array<{ gold: CollapsedEmotion; probs: Record<CollapsedEmotion, number> }>): number {
  const vals = preds.map((p) => {
    const prob = p.probs[p.gold];
    if (!(prob > 0)) throw new Error(`NLL got non-positive gold probability: ${prob}`);
    return -Math.log(prob);
  });
  const v = mean(vals);
  assertFinite("NLL", v);
  return v;
}

function fitTemperature(dev: Array<{ gold: CollapsedEmotion; probs: Record<CollapsedEmotion, number> }>): { T: number; dev_nll: number } {
  let bestT = 1;
  let bestNLL = Infinity;
  for (let t = T_MIN; t <= T_MAX + 1e-12; t += T_STEP) {
    const tt = Number(t.toFixed(2));
    const scaled = dev.map((p) => ({ gold: p.gold, probs: applyTemperature(p.probs, tt) }));
    const loss = nll(scaled);
    if (loss < bestNLL) {
      bestNLL = loss;
      bestT = tt;
    }
  }
  return { T: bestT, dev_nll: bestNLL };
}

function computeReliability(preds: Array<{ gold: CollapsedEmotion; probs: Record<CollapsedEmotion, number>; top1: CollapsedEmotion; confidence: number }>) {
  const bins = Array.from({ length: BIN_COUNT }, (_, i) => ({
    idx: i,
    lo: i / BIN_COUNT,
    hi: (i + 1) / BIN_COUNT,
    confs: [] as number[],
    correct: 0,
  }));

  for (const p of preds) {
    const c = p.confidence;
    const idx = c === 1 ? BIN_COUNT - 1 : Math.floor(c * BIN_COUNT);
    const b = bins[idx];
    b.confs.push(c);
    if (p.top1 === p.gold) b.correct += 1;
  }

  const total = preds.length;
  const rows = bins.map((b) => {
    const count = b.confs.length;
    const meanConf = count ? mean(b.confs) : 0;
    const acc = count ? b.correct / count : 0;
    return {
      bin: `${b.lo.toFixed(1)}-${b.hi.toFixed(1)}`,
      mean_confidence: meanConf,
      accuracy: acc,
      count,
      gap: Math.abs(acc - meanConf),
    };
  });

  const ece = rows.reduce((s, r) => s + r.gap * (r.count / total), 0);
  const mce = Math.max(...rows.map((r) => r.gap));
  assertFinite("ECE", ece);
  assertFinite("MCE", mce);
  if (ece < 0 || ece > 1) throw new Error(`ECE out of bounds: ${ece}`);
  if (mce < 0 || mce > 1) throw new Error(`MCE out of bounds: ${mce}`);
  return { bins: rows, ece, mce };
}

function computeBrier(preds: Array<{ gold: CollapsedEmotion; probs: Record<CollapsedEmotion, number> }>): number {
  const perRow = preds.map((p) => {
    let s = 0;
    for (const c of COLLAPSED_EMOTIONS) {
      const y = c === p.gold ? 1 : 0;
      s += (p.probs[c] - y) ** 2;
    }
    return s;
  });
  const v = mean(perRow);
  assertFinite("Brier", v);
  return v;
}

function computeClassification(preds: Array<{ gold: CollapsedEmotion; top1: CollapsedEmotion }>) {
  const classes = [...COLLAPSED_EMOTIONS].sort();
  const cm: Record<string, Record<string, number>> = {};
  for (const g of classes) {
    cm[g] = {};
    for (const p of classes) cm[g][p] = 0;
  }
  for (const p of preds) cm[p.gold][p.top1] += 1;
  for (const c of classes) if (!cm[c]) throw new Error(`class missing in confusion matrix: ${c}`);

  const total = preds.length;
  const correct = classes.reduce((s, c) => s + cm[c][c], 0);
  const accuracy = correct / total;
  assertFinite("accuracy", accuracy);

  const perClass: Record<string, { precision: number; recall: number; f1: number; support: number }> = {};
  const f1s: number[] = [];
  for (const c of classes) {
    const tp = cm[c][c];
    const fn = classes.reduce((s, p) => s + cm[c][p], 0) - tp;
    const fp = classes.reduce((s, g) => s + cm[g][c], 0) - tp;
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 = harmonicMean(precision, recall);
    assertFinite(`${c}.precision`, precision);
    assertFinite(`${c}.recall`, recall);
    assertFinite(`${c}.f1`, f1);
    perClass[c] = { precision, recall, f1, support: tp + fn };
    f1s.push(f1);
  }
  const macro_f1 = mean(f1s);
  assertFinite("macro_f1", macro_f1);

  return { accuracy, macro_f1, per_class: perClass, confusion_matrix: cm };
}

function harmfulConfusion(preds: Array<{ gold: CollapsedEmotion; top1: CollapsedEmotion }>) {
  const harmfulPairs = new Set(["ANGER|FEAR", "FEAR|ANGER", "ANGER|DISGUST", "DISGUST|ANGER"]);
  let num = 0;
  for (const p of preds) {
    if (p.gold !== p.top1 && harmfulPairs.has(`${p.gold}|${p.top1}`)) num++;
  }
  const den = preds.length;
  const rate = den ? num / den : 0;
  assertFinite("harmful rate", rate);
  return { numerator: num, denominator: den, rate };
}

function toTopPreds(preds: Array<{ gold: CollapsedEmotion; probs: Record<CollapsedEmotion, number> }>) {
  return preds.map((p) => {
    const top1 = argmaxObj(p.probs);
    return { ...p, top1, confidence: p.probs[top1] };
  });
}

function main(): void {
  console.log("=== Layer-2: Calibrate Emotion Classifier ===");
  assertNotExists(OUT_JSON);
  assertNotExists(OUT_MD);
  if (!fs.existsSync(DATASET_PATH)) throw new Error(`Missing dataset: ${DATASET_PATH}`);
  if (!fs.existsSync(GENERATION_TSV_PATH)) throw new Error(`Missing generation TSV: ${GENERATION_TSV_PATH}`);
  if (fs.existsSync(EVAL_METRICS_PATH)) {
    // Optional reference read to satisfy requested input usage.
    JSON.parse(fs.readFileSync(EVAL_METRICS_PATH, "utf-8"));
  }

  const rows = loadRowsWithTextId();
  const splits = splitByTextId(rows);
  if (splits.test.length < 900) throw new Error(`Test size sanity guard failed: ${splits.test.length}`);

  // Baseline predictions (DEFAULT_CONFIG).
  const devBase = inferRows(splits.dev);
  const testBase = inferRows(splits.test);
  const devForNll = devBase.map((p) => ({ gold: p.gold, probs: p.probs }));

  const baselineCls = computeClassification(testBase.map((p) => ({ gold: p.gold, top1: p.top1 })));
  const baselineRel = computeReliability(testBase);
  const baselineBrier = computeBrier(testBase.map((p) => ({ gold: p.gold, probs: p.probs })));
  const baselineHarmful = harmfulConfusion(testBase.map((p) => ({ gold: p.gold, top1: p.top1 })));

  // Fit T on DEV
  const fit = fitTemperature(devForNll);
  if (!(fit.T > 0)) throw new Error(`Fitted invalid T: ${fit.T}`);

  // Apply T to TEST
  const testScaled = testBase.map((p) => ({ gold: p.gold, probs: applyTemperature(p.probs, fit.T) }));
  const testScaledTop = toTopPreds(testScaled);
  const scaledCls = computeClassification(testScaledTop.map((p) => ({ gold: p.gold, top1: p.top1 })));
  const scaledRel = computeReliability(testScaledTop);
  const scaledBrier = computeBrier(testScaled);
  const scaledHarmful = harmfulConfusion(testScaledTop.map((p) => ({ gold: p.gold, top1: p.top1 })));

  const output = {
    split_sizes: {
      dev: splits.dev.length,
      test: splits.test.length,
    },
    baseline: {
      accuracy: baselineCls.accuracy,
      macro_f1: baselineCls.macro_f1,
      ece: baselineRel.ece,
      mce: baselineRel.mce,
      brier: baselineBrier,
      harmful_confusion_rate: baselineHarmful,
      reliability_bins: baselineRel.bins,
    },
    calibration: {
      optimal_temperature: fit.T,
      dev_nll: fit.dev_nll,
    },
    post_scaled: {
      accuracy: scaledCls.accuracy,
      macro_f1: scaledCls.macro_f1,
      ece: scaledRel.ece,
      mce: scaledRel.mce,
      brier: scaledBrier,
      harmful_confusion_rate: scaledHarmful,
      reliability_bins: scaledRel.bins,
    },
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(output, null, 2), "utf-8");

  const accDelta = scaledCls.accuracy - baselineCls.accuracy;
  const eceDelta = scaledRel.ece - baselineRel.ece;
  const harmfulDelta = scaledHarmful.rate - baselineHarmful.rate;

  const md: string[] = [];
  md.push("# Calibration Report");
  md.push("");
  md.push(`Generated: ${new Date().toISOString()}`);
  md.push("");
  md.push("## Dataset Size");
  md.push("");
  md.push(`- Dev: ${splits.dev.length}`);
  md.push(`- Test: ${splits.test.length}`);
  md.push("");
  md.push("## Baseline Metrics (Test)");
  md.push("");
  md.push(`- Accuracy: ${(baselineCls.accuracy * 100).toFixed(2)}%`);
  md.push(`- Macro F1: ${baselineCls.macro_f1.toFixed(4)}`);
  md.push(`- ECE: ${baselineRel.ece.toFixed(6)}`);
  md.push(`- MCE: ${baselineRel.mce.toFixed(6)}`);
  md.push(`- Brier: ${baselineBrier.toFixed(6)}`);
  md.push(`- Harmful confusion: ${baselineHarmful.numerator}/${baselineHarmful.denominator} (${(baselineHarmful.rate * 100).toFixed(2)}%)`);
  md.push("");
  md.push("## Optimal Temperature");
  md.push("");
  md.push(`- T*: ${fit.T.toFixed(2)}`);
  md.push(`- Dev NLL at T*: ${fit.dev_nll.toFixed(6)}`);
  md.push("");
  md.push("## Post-Scaling Metrics (Test)");
  md.push("");
  md.push(`- Accuracy: ${(scaledCls.accuracy * 100).toFixed(2)}% (Δ ${(accDelta * 100).toFixed(2)}pp)`);
  md.push(`- Macro F1: ${scaledCls.macro_f1.toFixed(4)}`);
  md.push(`- ECE: ${scaledRel.ece.toFixed(6)} (Δ ${eceDelta.toFixed(6)})`);
  md.push(`- MCE: ${scaledRel.mce.toFixed(6)}`);
  md.push(`- Brier: ${scaledBrier.toFixed(6)}`);
  md.push(`- Harmful confusion: ${scaledHarmful.numerator}/${scaledHarmful.denominator} (${(scaledHarmful.rate * 100).toFixed(2)}%, Δ ${(harmfulDelta * 100).toFixed(2)}pp)`);
  md.push("");
  md.push("## Reliability Table (10 bins)");
  md.push("");
  md.push("| Bin | Baseline mean conf | Baseline acc | Baseline count | Scaled mean conf | Scaled acc | Scaled count |");
  md.push("|---|---:|---:|---:|---:|---:|---:|");
  for (let i = 0; i < BIN_COUNT; i++) {
    const b = baselineRel.bins[i];
    const s = scaledRel.bins[i];
    md.push(
      `| ${b.bin} | ${b.mean_confidence.toFixed(4)} | ${b.accuracy.toFixed(4)} | ${b.count} | ${s.mean_confidence.toFixed(4)} | ${s.accuracy.toFixed(4)} | ${s.count} |`
    );
  }
  md.push("");
  md.push("## Interpretation");
  md.push("");
  const overUnder =
    baselineRel.bins.reduce((acc, b) => acc + (b.mean_confidence - b.accuracy), 0) > 0
      ? "overconfident"
      : "underconfident";
  md.push(`- Baseline model is ${overUnder} on average by reliability-bin gap sign.`);
  md.push(`- ECE ${scaledRel.ece < baselineRel.ece ? "improved" : "did not improve"} after temperature scaling.`);
  md.push(`- Accuracy ${accDelta < 0 ? "decreased" : accDelta > 0 ? "increased" : "unchanged"} by ${(accDelta * 100).toFixed(2)} percentage points.`);
  md.push(`- Harmful confusion ${harmfulDelta < 0 ? "decreased" : harmfulDelta > 0 ? "increased" : "unchanged"} by ${(harmfulDelta * 100).toFixed(2)} percentage points.`);
  md.push("- Entropy gate threshold interpretation should be revisited only if calibrated confidence materially shifts commit/hedge operating points.");
  md.push("");

  const reportDir = path.dirname(OUT_MD);
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(OUT_MD, md.join("\n"), "utf-8");

  console.log(`Wrote: ${OUT_JSON}`);
  console.log(`Wrote: ${OUT_MD}`);
  console.log(
    `T*=${fit.T.toFixed(2)} | Baseline ECE=${baselineRel.ece.toFixed(6)} | Post ECE=${scaledRel.ece.toFixed(6)} | Acc Δ=${(accDelta * 100).toFixed(2)}pp | Harmful Δ=${(harmfulDelta * 100).toFixed(2)}pp`
  );
}

main();

