/**
 * Layer-2 Step 3: Validate rule mapper against human-gold appraisals.
 *
 * Inputs:
 *   - data/layer2/gold_appraisals_test.json
 *   - data/layer2/rule_mapper_test_outputs.json
 *
 * Outputs:
 *   - data/layer2/rule_mapper_metrics.csv
 *   - docs/layer2/rule_mapper_validation.md
 */

import * as fs from "fs";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const GOLD_PATH = path.join(REPO_ROOT, "data", "layer2", "gold_appraisals_test.json");
const RULE_PATH = path.join(REPO_ROOT, "data", "layer2", "rule_mapper_test_outputs.json");
const CSV_PATH = path.join(REPO_ROOT, "data", "layer2", "rule_mapper_metrics.csv");
const MD_PATH = path.join(REPO_ROOT, "docs", "layer2", "rule_mapper_validation.md");

const DIMS = ["valence", "arousal", "agency", "control", "certainty", "goalRelevance"] as const;
type Dim = (typeof DIMS)[number];

type Bin = string;

interface Gold {
  text_id: string;
  scale5: Record<Dim, number>;
  bins: Record<Dim, Bin>;
}
interface Rule {
  text_id: string;
  skipped: boolean;
  scale5: Record<Dim, number> | null;
  bins: Record<Dim, Bin> | null;
}

interface Metrics {
  dimension: Dim;
  spearman: number;
  mae: number;
  binAccuracy: number;
  confusion: Record<string, Record<string, number>>;
}

function mean(a: number[]): number {
  return a.reduce((s, v) => s + v, 0) / (a.length || 1);
}

function rankWithTies(vals: number[]): number[] {
  const idx = vals.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array(vals.length).fill(0);
  let p = 0;
  while (p < idx.length) {
    let q = p + 1;
    while (q < idx.length && idx[q].v === idx[p].v) q++;
    const avgRank = (p + 1 + q) / 2;
    for (let k = p; k < q; k++) ranks[idx[k].i] = avgRank;
    p = q;
  }
  return ranks;
}

function pearson(x: number[], y: number[]): number {
  const mx = mean(x), my = mean(y);
  let num = 0, dx2 = 0, dy2 = 0;
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

function classify(rho: number): "Strong" | "Moderate" | "Weak" {
  if (rho >= 0.5) return "Strong";
  if (rho >= 0.3) return "Moderate";
  return "Weak";
}

function main(): void {
  console.log("=== Layer-2: Validate Rule Mapper ===");
  const gold: Gold[] = JSON.parse(fs.readFileSync(GOLD_PATH, "utf-8"));
  const rule: Rule[] = JSON.parse(fs.readFileSync(RULE_PATH, "utf-8"));

  const goldById = new Map(gold.map((g) => [g.text_id, g]));
  const ruleUsable = rule.filter((r) => !r.skipped && r.scale5 && r.bins);
  const pairs = ruleUsable
    .filter((r) => goldById.has(r.text_id))
    .map((r) => ({ g: goldById.get(r.text_id)!, r }));

  if (pairs.length === 0) throw new Error("No comparable rows between gold and rule outputs.");
  console.log(`Comparable rows: ${pairs.length} / ${gold.length} gold rows`);

  const metrics: Metrics[] = [];
  for (const dim of DIMS) {
    const gx = pairs.map((p) => p.g.scale5[dim]);
    const rx = pairs.map((p) => p.r.scale5![dim]);
    const rho = spearman(gx, rx);
    const mae = mean(gx.map((v, i) => Math.abs(v - rx[i])));
    const gb = pairs.map((p) => p.g.bins[dim]);
    const rb = pairs.map((p) => p.r.bins![dim]);
    const acc = gb.filter((b, i) => b === rb[i]).length / gb.length;

    const bins = [...new Set([...gb, ...rb])].sort();
    const conf: Record<string, Record<string, number>> = {};
    for (const gbin of bins) {
      conf[gbin] = {};
      for (const rbin of bins) conf[gbin][rbin] = 0;
    }
    for (let i = 0; i < gb.length; i++) conf[gb[i]][rb[i]]++;

    metrics.push({ dimension: dim, spearman: rho, mae, binAccuracy: acc, confusion: conf });
  }

  const sorted = metrics.slice().sort((a, b) => b.spearman - a.spearman);
  const worst = sorted[sorted.length - 1];

  // CSV
  const csv = ["dimension,spearman_rho,mae_scale5,bin_accuracy,interpretation"];
  for (const m of metrics) {
    csv.push(`${m.dimension},${m.spearman.toFixed(6)},${m.mae.toFixed(6)},${m.binAccuracy.toFixed(6)},${classify(m.spearman)}`);
  }
  fs.writeFileSync(CSV_PATH, csv.join("\n") + "\n", "utf-8");

  // Markdown
  const md: string[] = [];
  md.push("# Rule Mapper Validation (Layer-2 Step 3)");
  md.push("");
  md.push(`- Gold rows (test): ${gold.length}`);
  md.push(`- Rule rows usable: ${ruleUsable.length}`);
  md.push(`- Comparable rows: ${pairs.length}`);
  md.push("");
  md.push("## Per-Dimension Metrics");
  md.push("");
  md.push("| Dimension | Spearman ρ | MAE (1-5) | Bin Accuracy | Interpretation |");
  md.push("|---|---:|---:|---:|---|");
  for (const m of sorted) {
    md.push(`| ${m.dimension} | ${m.spearman.toFixed(4)} | ${m.mae.toFixed(4)} | ${(m.binAccuracy * 100).toFixed(1)}% | ${classify(m.spearman)} |`);
  }
  md.push("");
  md.push("## Confusion Matrices");
  md.push("");
  for (const m of metrics) {
    md.push(`### ${m.dimension}`);
    const bins = Object.keys(m.confusion).sort();
    md.push("");
    md.push(`Gold \\\\ Rule | ${bins.join(" | ")}`);
    md.push(`${["---", ...bins.map(() => "---")].join(" | ")}`);
    for (const g of bins) {
      md.push(`${g} | ${bins.map((r) => String(m.confusion[g][r])).join(" | ")}`);
    }
    md.push("");
  }
  md.push("## Interpretation");
  md.push("");
  md.push("- Strong: ρ ≥ 0.5");
  md.push("- Moderate: 0.3 ≤ ρ < 0.5");
  md.push("- Weak: ρ < 0.3");
  md.push("");
  md.push("### Dimensions Sorted by Spearman");
  md.push("");
  for (const m of sorted) {
    md.push(`- ${m.dimension}: ρ=${m.spearman.toFixed(4)}, MAE=${m.mae.toFixed(4)}, acc=${(m.binAccuracy * 100).toFixed(1)}%`);
  }
  md.push("");
  md.push(`### Worst Dimension`);
  md.push(`- ${worst.dimension} (ρ=${worst.spearman.toFixed(4)})`);
  md.push("");

  fs.writeFileSync(MD_PATH, md.join("\n"), "utf-8");
  console.log(`Wrote: ${CSV_PATH}`);
  console.log(`Wrote: ${MD_PATH}`);
}

main();

