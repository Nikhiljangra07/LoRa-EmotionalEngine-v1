/**
 * Layer-2: Proper Evaluation (v1)
 *
 * Evaluates Ekman6 inference on deterministic stratified splits grouped by text_id.
 * Non-destructive: writes new versioned artifacts and throws if outputs already exist.
 */

import * as fs from "fs";
import * as path from "path";
import { collapseEmotion, COLLAPSED_EMOTIONS, CollapsedEmotion } from "./emotion_collapse_map";
import { inferEkman6, DEFAULT_CONFIG } from "./infer_ekman6";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const DATASET_PATH = path.join(REPO_ROOT, "data", "layer2", "layer2_likelihood_dataset_v1_1.json");
const WRITER_LIKELIHOOD_PATH = path.join(
  REPO_ROOT,
  "models",
  "likelihoods",
  "envent_likelihood_writer_v1.json"
);
const GENERATION_TSV_PATH = path.join(
  REPO_ROOT,
  "src",
  "appraisal-lab",
  "dataset",
  "crowd-enVent2023",
  "corpus",
  "crowd-enVent_generation.tsv"
);
const OUT_JSON = path.join(REPO_ROOT, "data", "layer2", "eval_metrics_v1.json");
const OUT_MD = path.join(REPO_ROOT, "reports", "eval_v1.md");

const SEED = 42;
const SUM_TOL = 1e-8;
const SPLIT_TOL_ROWS = 1;

const DIMS = ["valence", "arousal", "agency", "control", "certainty", "goalRelevance"] as const;
type Dim = (typeof DIMS)[number];

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
  split: "train" | "dev" | "test";
  appraisals: Bins;
};

type WriterLikelihood = {
  version: string;
  alpha: number;
  priors: Record<string, number>;
  likelihoods: Record<string, Record<string, Record<string, number>>>;
};

type EvalRow = {
  text_id: string;
  rawEmotion: string;
  collapsed: CollapsedEmotion;
  bins: Bins;
};

type SplitName = "train" | "dev" | "test";

function assertNotExists(p: string): void {
  if (fs.existsSync(p)) throw new Error(`Output already exists (refusing overwrite): ${p}`);
}

function assertFinite(name: string, n: number): void {
  if (!Number.isFinite(n)) throw new Error(`${name} is NaN/Infinity`);
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

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
}

function rankWithTies(vals: number[]): number[] {
  const idx = vals.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array(vals.length).fill(0);
  let p = 0;
  while (p < idx.length) {
    let q = p + 1;
    while (q < idx.length && idx[q].v === idx[p].v) q++;
    const r = (p + 1 + q) / 2;
    for (let i = p; i < q; i++) out[idx[i].i] = r;
    p = q;
  }
  return out;
}

function pearson(x: number[], y: number[]): number {
  const mx = mean(x);
  const my = mean(y);
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < x.length; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const den = Math.sqrt(dx2 * dy2);
  return den === 0 ? 0 : num / den;
}

function spearman(x: number[], y: number[]): number {
  return pearson(rankWithTies(x), rankWithTies(y));
}

function harmonicMean(p: number, r: number): number {
  return p + r === 0 ? 0 : (2 * p * r) / (p + r);
}

function binToScale5(dim: Dim, bin: string): number {
  if (dim === "certainty" || dim === "goalRelevance") {
    return bin === "LOW" ? 1 : 5;
  }
  if (dim === "valence") return bin === "NEG" ? 1 : bin === "NEU" ? 3 : 5;
  if (dim === "agency") return bin === "SELF" ? 1 : bin === "OTHER" ? 3 : 5;
  return bin === "LOW" ? 1 : bin === "MED" ? 3 : 5;
}

function argmax(dist: Record<string, number>): string {
  return Object.entries(dist).sort((a, b) => b[1] - a[1])[0][0];
}

function validateWriterLikelihood(table: WriterLikelihood): void {
  const pSum = Object.values(table.priors).reduce((a, b) => a + b, 0);
  assertFinite("priors sum", pSum);
  if (Math.abs(pSum - 1) > SUM_TOL) throw new Error(`Writer priors sum=${pSum}, expected 1`);
  for (const d of Object.keys(table.likelihoods)) {
    for (const e of Object.keys(table.likelihoods[d])) {
      const dist = table.likelihoods[d][e];
      const s = Object.values(dist).reduce((a, b) => a + b, 0);
      assertFinite(`likelihood sum ${d}/${e}`, s);
      if (Math.abs(s - 1) > SUM_TOL) {
        throw new Error(`Writer likelihood sum ${d}/${e}=${s}, expected 1`);
      }
    }
  }
}

function buildCollapsedDominantBinsFromWriter(table: WriterLikelihood): Record<CollapsedEmotion, Record<Dim, string>> {
  const collapsed = {} as Record<CollapsedEmotion, Record<Dim, string>>;
  for (const ce of COLLAPSED_EMOTIONS) {
    collapsed[ce] = {} as Record<Dim, string>;
    for (const d of DIMS) {
      const srcEmos = Object.keys(table.priors).filter((e) => collapseEmotion(e) === ce);
      if (srcEmos.length === 0) throw new Error(`No source emotions for collapsed class ${ce}`);
      const priorMass = srcEmos.reduce((s, e) => s + table.priors[e], 0);
      const bins = new Set<string>();
      for (const e of srcEmos) for (const b of Object.keys(table.likelihoods[d][e])) bins.add(b);
      const agg: Record<string, number> = {};
      for (const b of [...bins].sort()) agg[b] = 0;
      for (const e of srcEmos) {
        const w = table.priors[e] / priorMass;
        for (const b of Object.keys(agg)) {
          agg[b] += w * (table.likelihoods[d][e][b] ?? 0);
        }
      }
      const sum = Object.values(agg).reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 1) > 1e-6) throw new Error(`Aggregated collapsed dist sum mismatch ${ce}/${d}: ${sum}`);
      collapsed[ce][d] = argmax(agg);
    }
  }
  return collapsed;
}

function loadRowsWithTextId(): EvalRow[] {
  const ds = JSON.parse(fs.readFileSync(DATASET_PATH, "utf-8")) as DatasetRow[];
  const lines = fs.readFileSync(GENERATION_TSV_PATH, "utf-8").split("\n").filter((l) => l.trim());
  const headers = lines[0].split("\t");
  const textIdIdx = headers.indexOf("text_id");
  const emotionIdx = headers.indexOf("emotion");
  if (textIdIdx < 0 || emotionIdx < 0) throw new Error("generation TSV missing text_id/emotion columns");
  if (ds.length !== lines.length - 1) {
    throw new Error(`Row count mismatch dataset=${ds.length}, generation=${lines.length - 1}`);
  }
  const rows: EvalRow[] = [];
  let excluded = 0;
  for (let i = 0; i < ds.length; i++) {
    const tsv = lines[i + 1].split("\t");
    const text_id = (tsv[textIdIdx] ?? "").trim();
    const rawEmotion = (tsv[emotionIdx] ?? "").trim();
    const dsEmotion = ds[i].emotion.trim();
    if (rawEmotion !== dsEmotion) {
      throw new Error(`Row alignment mismatch at index ${i}: tsv=${rawEmotion}, dataset=${dsEmotion}`);
    }
    try {
      const collapsed = collapseEmotion(rawEmotion);
      rows.push({ text_id, rawEmotion, collapsed, bins: ds[i].appraisals });
    } catch {
      excluded++;
    }
  }
  if (excluded > 0) {
    console.log(`Excluded unsupported emotion rows: ${excluded}`);
  }
  return rows;
}

function splitByTextId(rows: EvalRow[]): Record<SplitName, EvalRow[]> {
  const byText = new Map<string, EvalRow[]>();
  for (const r of rows) {
    if (!byText.has(r.text_id)) byText.set(r.text_id, []);
    byText.get(r.text_id)!.push(r);
  }
  // label each text by dominant collapsed emotion count (deterministic tie-break alpha sort)
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

  const splitTextIds: Record<SplitName, Set<string>> = {
    train: new Set(),
    dev: new Set(),
    test: new Set(),
  };
  const rng = mulberry32(SEED);
  for (const emo of [...byEmotion.keys()].sort()) {
    const ids = seededShuffle(byEmotion.get(emo)!, rng);
    const n = ids.length;
    const nTrain = Math.round(n * 0.7);
    const nDev = Math.round(n * 0.15);
    const nTest = n - nTrain - nDev;
    const target = { train: nTrain, dev: nDev, test: nTest };
    if (Math.abs(nTrain - n * 0.7) > SPLIT_TOL_ROWS) throw new Error(`split tolerance exceeded for ${emo} train`);
    if (Math.abs(nDev - n * 0.15) > SPLIT_TOL_ROWS) throw new Error(`split tolerance exceeded for ${emo} dev`);
    if (Math.abs(nTest - n * 0.15) > SPLIT_TOL_ROWS) throw new Error(`split tolerance exceeded for ${emo} test`);
    let i = 0;
    for (; i < target.train; i++) splitTextIds.train.add(ids[i]);
    for (; i < target.train + target.dev; i++) splitTextIds.dev.add(ids[i]);
    for (; i < ids.length; i++) splitTextIds.test.add(ids[i]);
  }

  // No overlap by text_id
  for (const id of splitTextIds.train) {
    if (splitTextIds.dev.has(id) || splitTextIds.test.has(id)) throw new Error(`text_id ${id} in multiple splits`);
  }
  for (const id of splitTextIds.dev) {
    if (splitTextIds.test.has(id)) throw new Error(`text_id ${id} in multiple splits`);
  }

  const out: Record<SplitName, EvalRow[]> = { train: [], dev: [], test: [] };
  for (const r of rows) {
    if (splitTextIds.train.has(r.text_id)) out.train.push(r);
    else if (splitTextIds.dev.has(r.text_id)) out.dev.push(r);
    else if (splitTextIds.test.has(r.text_id)) out.test.push(r);
    else throw new Error(`text_id ${r.text_id} missing split assignment`);
  }

  // class presence check "if possible"
  const totalClasses = new Set(rows.map((r) => r.collapsed));
  for (const split of ["train", "dev", "test"] as const) {
    const seen = new Set(out[split].map((r) => r.collapsed));
    if (out[split].length >= totalClasses.size) {
      for (const c of totalClasses) {
        if (!seen.has(c)) throw new Error(`Class ${c} missing in ${split} split though possible`);
      }
    }
  }

  return out;
}

function evaluateClassification(testRows: EvalRow[]): {
  accuracy: number;
  macro_f1: number;
  per_class: Record<string, { precision: number; recall: number; f1: number; support: number }>;
  confusion_matrix: Record<string, Record<string, number>>;
  harmful_confusion_rate: { numerator: number; denominator: number; rate: number };
  predictions: Array<{ gold: CollapsedEmotion; pred: CollapsedEmotion; decision: string }>;
} {
  const classes = [...COLLAPSED_EMOTIONS].sort();
  const cm: Record<string, Record<string, number>> = {};
  for (const g of classes) {
    cm[g] = {};
    for (const p of classes) cm[g][p] = 0;
  }
  const preds: Array<{ gold: CollapsedEmotion; pred: CollapsedEmotion; decision: string }> = [];

  for (const r of testRows) {
    const res = inferEkman6(r.bins, DEFAULT_CONFIG);
    cm[r.collapsed][res.topEmotion] += 1;
    preds.push({ gold: r.collapsed, pred: res.topEmotion, decision: res.decision });
  }

  for (const c of classes) if (!cm[c]) throw new Error(`Missing class in confusion matrix: ${c}`);

  const total = testRows.length;
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
    assertFinite(`${c} precision`, precision);
    assertFinite(`${c} recall`, recall);
    assertFinite(`${c} f1`, f1);
    perClass[c] = { precision, recall, f1, support: tp + fn };
    f1s.push(f1);
  }
  const macro_f1 = mean(f1s);
  assertFinite("macro_f1", macro_f1);

  const harmfulPairs = new Set(["ANGER|FEAR", "FEAR|ANGER", "ANGER|DISGUST", "DISGUST|ANGER"]);
  let harmful = 0;
  for (const p of preds) {
    if (p.gold !== p.pred && harmfulPairs.has(`${p.gold}|${p.pred}`)) harmful++;
  }
  const harmfulRate = harmful / total;
  assertFinite("harmful_rate", harmfulRate);

  return {
    accuracy,
    macro_f1,
    per_class: perClass,
    confusion_matrix: cm,
    harmful_confusion_rate: { numerator: harmful, denominator: total, rate: harmfulRate },
    predictions: preds,
  };
}

function evaluateAppraisalMetrics(
  testRows: EvalRow[],
  preds: Array<{ gold: CollapsedEmotion; pred: CollapsedEmotion; decision: string }>,
  dominantBins: Record<CollapsedEmotion, Record<Dim, string>>
): Record<Dim, { mae_scale5: number; spearman: number; bin_accuracy: number }> {
  const out = {} as Record<Dim, { mae_scale5: number; spearman: number; bin_accuracy: number }>;
  for (const d of DIMS) {
    const goldScale: number[] = [];
    const predScale: number[] = [];
    let correct = 0;
    for (let i = 0; i < testRows.length; i++) {
      const goldBin = testRows[i].bins[d];
      const predBin = dominantBins[preds[i].pred][d];
      if (goldBin === predBin) correct++;
      goldScale.push(binToScale5(d, goldBin));
      predScale.push(binToScale5(d, predBin));
    }
    const mae = mean(goldScale.map((g, i) => Math.abs(g - predScale[i])));
    const rho = spearman(goldScale, predScale);
    const acc = correct / testRows.length;
    assertFinite(`${d} mae`, mae);
    assertFinite(`${d} spearman`, rho);
    assertFinite(`${d} bin_accuracy`, acc);
    out[d] = { mae_scale5: mae, spearman: rho, bin_accuracy: acc };
  }
  return out;
}

function main(): void {
  console.log("=== Layer-2: Proper Evaluation v1 ===");
  assertNotExists(OUT_JSON);
  assertNotExists(OUT_MD);
  if (!fs.existsSync(DATASET_PATH)) throw new Error(`Missing input: ${DATASET_PATH}`);
  if (!fs.existsSync(WRITER_LIKELIHOOD_PATH)) throw new Error(`Missing input: ${WRITER_LIKELIHOOD_PATH}`);
  if (!fs.existsSync(GENERATION_TSV_PATH)) throw new Error(`Missing input: ${GENERATION_TSV_PATH}`);

  const writer = JSON.parse(fs.readFileSync(WRITER_LIKELIHOOD_PATH, "utf-8")) as WriterLikelihood;
  validateWriterLikelihood(writer);
  const dominantBins = buildCollapsedDominantBinsFromWriter(writer);

  const rows = loadRowsWithTextId();
  const splits = splitByTextId(rows);
  const splitSizes = {
    train: splits.train.length,
    dev: splits.dev.length,
    test: splits.test.length,
  };
  console.log(`Split sizes: train=${splitSizes.train}, dev=${splitSizes.dev}, test=${splitSizes.test}`);
  if (splitSizes.test < 900) throw new Error(`Test size too small: ${splitSizes.test} (<900)`);

  const cls = evaluateClassification(splits.test);
  const appraisal = evaluateAppraisalMetrics(splits.test, cls.predictions, dominantBins);

  const output = {
    split_sizes: splitSizes,
    classification: {
      accuracy: cls.accuracy,
      macro_f1: cls.macro_f1,
      per_class: cls.per_class,
      confusion_matrix: cls.confusion_matrix,
      harmful_confusion_rate: cls.harmful_confusion_rate,
    },
    appraisal_metrics: appraisal,
  };

  const outDirJson = path.dirname(OUT_JSON);
  if (!fs.existsSync(outDirJson)) fs.mkdirSync(outDirJson, { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(output, null, 2), "utf-8");

  const strongDims = DIMS.filter((d) => appraisal[d].spearman >= 0.5);
  const weakDims = DIMS.filter((d) => appraisal[d].spearman < 0.3);
  const sortedDims = DIMS.slice().sort((a, b) => appraisal[b].spearman - appraisal[a].spearman);

  const md: string[] = [];
  md.push("# Proper Evaluation v1");
  md.push("");
  md.push(`Generated: ${new Date().toISOString()}`);
  md.push("");
  md.push("## 1) Split Summary");
  md.push("");
  md.push(`- Train: ${splitSizes.train}`);
  md.push(`- Dev: ${splitSizes.dev}`);
  md.push(`- Test: ${splitSizes.test}`);
  md.push("");
  md.push("## 2) Emotion Classification Results");
  md.push("");
  md.push(`- Accuracy: ${(cls.accuracy * 100).toFixed(2)}%`);
  md.push(`- Macro F1: ${cls.macro_f1.toFixed(4)}`);
  md.push("");
  md.push("| Class | Precision | Recall | F1 | Support |");
  md.push("|---|---:|---:|---:|---:|");
  for (const c of [...COLLAPSED_EMOTIONS].sort()) {
    const m = cls.per_class[c];
    md.push(`| ${c} | ${m.precision.toFixed(4)} | ${m.recall.toFixed(4)} | ${m.f1.toFixed(4)} | ${m.support} |`);
  }
  md.push("");
  md.push("## 3) Confusion Matrix");
  md.push("");
  const classes = [...COLLAPSED_EMOTIONS].sort();
  md.push(`Gold \\\\ Pred | ${classes.join(" | ")}`);
  md.push(`${["---", ...classes.map(() => "---")].join(" | ")}`);
  for (const g of classes) {
    md.push(`${g} | ${classes.map((p) => String(cls.confusion_matrix[g][p])).join(" | ")}`);
  }
  md.push("");
  md.push("## 4) Harmful Confusion Analysis");
  md.push("");
  md.push(`- Harmful pairs evaluated: ANGER↔FEAR, ANGER↔DISGUST`);
  md.push(`- Harmful misclassifications: ${cls.harmful_confusion_rate.numerator} / ${cls.harmful_confusion_rate.denominator}`);
  md.push(`- Harmful confusion rate: ${(cls.harmful_confusion_rate.rate * 100).toFixed(2)}%`);
  md.push("");
  md.push("## 5) Appraisal Prediction Metrics");
  md.push("");
  md.push("| Dimension | MAE (1-5) | Spearman | Bin Accuracy |");
  md.push("|---|---:|---:|---:|");
  for (const d of sortedDims) {
    md.push(`| ${d} | ${appraisal[d].mae_scale5.toFixed(4)} | ${appraisal[d].spearman.toFixed(4)} | ${(appraisal[d].bin_accuracy * 100).toFixed(2)}% |`);
  }
  md.push("");
  md.push("## 6) Observations");
  md.push("");
  md.push(`- Strong dimensions (ρ ≥ 0.5): ${strongDims.length ? strongDims.join(", ") : "none"}`);
  md.push(`- Weak dimensions (ρ < 0.3): ${weakDims.length ? weakDims.join(", ") : "none"}`);
  md.push(`- Highest Spearman: ${sortedDims[0]} (${appraisal[sortedDims[0]].spearman.toFixed(4)})`);
  md.push(`- Lowest Spearman: ${sortedDims[sortedDims.length - 1]} (${appraisal[sortedDims[sortedDims.length - 1]].spearman.toFixed(4)})`);
  md.push(`- Harmful confusion remained ${(cls.harmful_confusion_rate.rate * 100).toFixed(2)}% on TEST.`);
  md.push("");

  const outDirMd = path.dirname(OUT_MD);
  if (!fs.existsSync(outDirMd)) fs.mkdirSync(outDirMd, { recursive: true });
  fs.writeFileSync(OUT_MD, md.join("\n"), "utf-8");

  console.log(`Wrote: ${OUT_JSON}`);
  console.log(`Wrote: ${OUT_MD}`);
  console.log(`Accuracy=${(cls.accuracy * 100).toFixed(2)}% MacroF1=${cls.macro_f1.toFixed(4)} Harmful=${(cls.harmful_confusion_rate.rate * 100).toFixed(2)}%`);
}

main();

