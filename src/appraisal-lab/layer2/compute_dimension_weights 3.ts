/**
 * Layer-2: Compute IRR-based per-dimension reliability weights.
 *
 * Reads data/layer2/irr_kappa_table.csv, aggregates κ per LoRa-6 dimension,
 * maps to a discrete weight tier, and writes a report.
 *
 * Fully isolated — uses only Node built-ins (fs, path).
 *
 * Usage:
 *   npx ts-node src/appraisal-lab/layer2/compute_dimension_weights.ts
 */

import * as fs from "fs";
import * as path from "path";

// ============================================================
// Paths
// ============================================================

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const KAPPA_CSV = path.join(REPO_ROOT, "data", "layer2", "irr_kappa_table.csv");
const REPORT_OUT = path.join(REPO_ROOT, "docs", "layer2", "dimension_weights.md");
const WEIGHTS_JSON = path.join(REPO_ROOT, "data", "layer2", "dimension_weights.json");

// ============================================================
// LoRa-6 → source column mapping (from mapping_spec.md v1.1)
// ============================================================

type LoRaDimension =
  | "valence"
  | "arousal"
  | "agency"
  | "control"
  | "certainty"
  | "goalRelevance";

const LORA_SOURCE_COLUMNS: Record<LoRaDimension, string[]> = {
  valence: ["pleasantness", "unpleasantness"],
  arousal: ["suddenness", "urgency", "attention"],
  agency: ["self_responsblt", "other_responsblt", "chance_responsblt"],
  control: ["self_control", "other_control", "chance_control"],
  certainty: ["predict_event", "predict_conseq", "familiarity"],
  goalRelevance: ["goal_relevance"],
};

const LORA_DIMS: LoRaDimension[] = [
  "valence",
  "arousal",
  "agency",
  "control",
  "certainty",
  "goalRelevance",
];

// ============================================================
// κ → weight tier
// ============================================================

function kappaToWeight(kappa: number): number {
  if (kappa >= 0.6) return 1.0;
  if (kappa >= 0.5) return 0.6;
  if (kappa >= 0.4) return 0.3;
  return 0.15;
}

function weightTierLabel(w: number): string {
  if (w === 1.0) return "FULL (κ ≥ 0.60)";
  if (w === 0.6) return "MODERATE (0.50–0.59)";
  if (w === 0.3) return "REDUCED (0.40–0.49)";
  return "MINIMAL (κ < 0.40)";
}

// ============================================================
// CSV parser
// ============================================================

function loadKappaCSV(): Record<string, number> {
  const content = fs.readFileSync(KAPPA_CSV, "utf-8");
  const lines = content.trim().split("\n");
  const map: Record<string, number> = {};
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");
    if (parts[1] === "appraisal") {
      map[parts[0]] = parseFloat(parts[2]);
    }
  }
  return map;
}

// ============================================================
// Main
// ============================================================

function main(): void {
  console.log("=== Layer-2: Dimension Weight Computation ===\n");

  if (!fs.existsSync(KAPPA_CSV)) {
    console.error(`FATAL: IRR kappa table not found at ${KAPPA_CSV}`);
    process.exit(1);
  }

  const kappaMap = loadKappaCSV();
  console.log(`Loaded ${Object.keys(kappaMap).length} appraisal κ values.\n`);

  const results: {
    dim: LoRaDimension;
    sources: { col: string; kappa: number }[];
    aggregatedKappa: number;
    weight: number;
  }[] = [];

  for (const dim of LORA_DIMS) {
    const cols = LORA_SOURCE_COLUMNS[dim];
    const sources = cols.map((col) => {
      const k = kappaMap[col];
      if (k === undefined) throw new Error(`Missing κ for column: ${col}`);
      return { col, kappa: k };
    });
    const aggKappa = sources.reduce((s, c) => s + c.kappa, 0) / sources.length;
    const weight = kappaToWeight(aggKappa);

    results.push({ dim, sources, aggregatedKappa: aggKappa, weight });
    console.log(
      `  ${dim.padEnd(16)} agg_κ=${aggKappa.toFixed(4)}  weight=${weight.toFixed(2)}  [${weightTierLabel(weight)}]`
    );
  }

  // Write JSON
  const weightsObj: Record<string, number> = {};
  for (const r of results) weightsObj[r.dim] = r.weight;

  const outDir = path.dirname(WEIGHTS_JSON);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(WEIGHTS_JSON, JSON.stringify(weightsObj, null, 2), "utf-8");
  console.log(`\nWeights JSON written to: ${WEIGHTS_JSON}`);

  // Write markdown report
  const lines: string[] = [];
  const w = (s: string) => lines.push(s);
  const now = new Date().toISOString().slice(0, 10);

  w("# Layer-2 Dimension Reliability Weights");
  w("");
  w(`**Generated:** ${now}`);
  w("**Source:** data/layer2/irr_kappa_table.csv");
  w("**Method:** IRR κ → weight tier mapping");
  w("");
  w("---");
  w("");
  w("## Weight Tiers");
  w("");
  w("| κ Range | Weight | Tier |");
  w("|---------|--------|------|");
  w("| ≥ 0.60 | 1.00 | FULL |");
  w("| 0.50–0.59 | 0.60 | MODERATE |");
  w("| 0.40–0.49 | 0.30 | REDUCED |");
  w("| < 0.40 | 0.15 | MINIMAL |");
  w("");
  w("---");
  w("");
  w("## Per-Dimension Results");
  w("");
  w("| LoRa Dimension | Source Columns | Raw κ values | Aggregated κ | Weight | Tier |");
  w("|---------------|---------------|-------------|-------------|--------|------|");

  for (const r of results) {
    const srcCols = r.sources.map((s) => s.col).join(", ");
    const rawKappas = r.sources.map((s) => s.kappa.toFixed(4)).join(", ");
    w(
      `| ${r.dim} | ${srcCols} | ${rawKappas} | ${r.aggregatedKappa.toFixed(4)} | ${r.weight.toFixed(2)} | ${weightTierLabel(r.weight)} |`
    );
  }
  w("");
  w("---");
  w("");
  w("## Implications");
  w("");
  w("These weights are used as exponents in Layer-2 experimental inference:");
  w("");
  w("```");
  w("log P(E|D) += w_i * log P(D_i | E)");
  w("```");
  w("");
  w("Dimensions with low IRR contribute less to the posterior,");
  w("reflecting their inherent measurement noise.");
  w("");

  const mdDir = path.dirname(REPORT_OUT);
  if (!fs.existsSync(mdDir)) fs.mkdirSync(mdDir, { recursive: true });
  fs.writeFileSync(REPORT_OUT, lines.join("\n"), "utf-8");
  console.log(`Report written to: ${REPORT_OUT}`);

  console.log("\nDone.");
}

main();
