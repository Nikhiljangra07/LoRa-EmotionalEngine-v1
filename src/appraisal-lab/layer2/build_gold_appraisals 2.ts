/**
 * Layer-2 Step 3: Build human-gold appraisal vectors for TEST text_ids.
 *
 * Reads crowd-enVent validation TSV, aggregates 5 reader annotations per text_id
 * using per-column medians, maps to LoRa-6 (v1.1 formulas), and writes:
 *   data/layer2/gold_appraisals_test.json
 *
 * Deterministic split assignment uses seed=42 and stratification by original_emotion,
 * matching the Layer-2 dataset split policy.
 */

import * as fs from "fs";
import * as path from "path";

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
const OUT_PATH = path.join(REPO_ROOT, "data", "layer2", "gold_appraisals_test.json");

const SEED = 42;
const EXPECTED_TEXT_IDS = 1200;
const RATERS_PER_TEXT = 5;

const APPRAISAL_COLS = [
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

type Split = "train" | "dev" | "test";

interface GoldRow {
  text_id: string;
  original_emotion: string;
  split: Split;
  continuous: {
    valence: number;
    arousal: number;
    agency: number;
    control: number;
    certainty: number;
    goalRelevance: number;
  };
  scale5: {
    valence: number;
    arousal: number;
    agency: number;
    control: number;
    certainty: number;
    goalRelevance: number;
  };
  bins: {
    valence: "NEG" | "NEU" | "POS";
    arousal: "LOW" | "MED" | "HIGH";
    agency: "SELF" | "OTHER" | "SITUATION";
    control: "LOW" | "MED" | "HIGH";
    certainty: "LOW" | "HIGH";
    goalRelevance: "LOW" | "HIGH";
  };
  medians: Record<string, number>;
}

interface RawValidationRow {
  text_id: string;
  original_emotion: string;
  appraisals: Record<string, number>;
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

function norm(x: number): number {
  return (x - 1) / 4;
}

function bin3(v: number): "LOW" | "MED" | "HIGH" {
  if (v < 0.333) return "LOW";
  if (v < 0.667) return "MED";
  return "HIGH";
}

function bin2(v: number): "LOW" | "HIGH" {
  return v < 0.5 ? "LOW" : "HIGH";
}

function valenceBin(v: number): "NEG" | "NEU" | "POS" {
  if (v < 0.333) return "NEG";
  if (v < 0.667) return "NEU";
  return "POS";
}

function median(nums: number[]): number {
  const s = nums.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

function parseValidationRows(): RawValidationRow[] {
  if (!fs.existsSync(TSV_PATH)) {
    throw new Error(`Validation TSV not found: ${TSV_PATH}`);
  }
  const lines = fs.readFileSync(TSV_PATH, "utf-8").split("\n").filter((l) => l.trim());
  const headers = lines[0].split("\t");
  const idx = (c: string) => headers.indexOf(c);
  const missing = ["text_id", "original_emotion", ...APPRAISAL_COLS].filter((c) => idx(c) < 0);
  if (missing.length) throw new Error(`Missing columns: ${missing.join(", ")}`);

  const rows: RawValidationRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split("\t");
    const row: RawValidationRow = {
      text_id: (cells[idx("text_id")] ?? "").trim(),
      original_emotion: (cells[idx("original_emotion")] ?? "").trim(),
      appraisals: {},
    };
    for (const c of APPRAISAL_COLS) {
      const v = Number((cells[idx(c)] ?? "").trim());
      if (!Number.isFinite(v)) throw new Error(`Row ${i + 1}: non-numeric ${c}`);
      row.appraisals[c] = v;
    }
    rows.push(row);
  }
  return rows;
}

function assignSplitsByEmotion(groups: Array<{ text_id: string; original_emotion: string }>): Map<string, Split> {
  const byEmotion = new Map<string, Array<{ text_id: string; original_emotion: string }>>();
  for (const g of groups) {
    if (!byEmotion.has(g.original_emotion)) byEmotion.set(g.original_emotion, []);
    byEmotion.get(g.original_emotion)!.push(g);
  }
  const rng = mulberry32(SEED);
  const out = new Map<string, Split>();
  const emos = [...byEmotion.keys()].sort();
  for (const emo of emos) {
    const shuffled = seededShuffle(byEmotion.get(emo)!, rng);
    const n = shuffled.length;
    const trainEnd = Math.round(n * 0.7);
    const devEnd = Math.round(n * 0.85);
    for (let i = 0; i < n; i++) {
      const split: Split = i < trainEnd ? "train" : i < devEnd ? "dev" : "test";
      out.set(shuffled[i].text_id, split);
    }
  }
  return out;
}

function main(): void {
  console.log("=== Layer-2: Build Gold Appraisals (TEST) ===");
  const rows = parseValidationRows();
  const byText = new Map<string, RawValidationRow[]>();
  for (const r of rows) {
    if (!byText.has(r.text_id)) byText.set(r.text_id, []);
    byText.get(r.text_id)!.push(r);
  }
  if (byText.size !== EXPECTED_TEXT_IDS) {
    throw new Error(`Expected ${EXPECTED_TEXT_IDS} text_ids, got ${byText.size}`);
  }

  const textMeta: Array<{ text_id: string; original_emotion: string }> = [];
  for (const [text_id, rs] of byText) {
    if (rs.length !== RATERS_PER_TEXT) {
      throw new Error(`text_id ${text_id}: expected ${RATERS_PER_TEXT} rows, got ${rs.length}`);
    }
    const emoSet = new Set(rs.map((r) => r.original_emotion));
    if (emoSet.size !== 1) throw new Error(`text_id ${text_id}: inconsistent original_emotion`);
    textMeta.push({ text_id, original_emotion: rs[0].original_emotion });
  }
  const splitMap = assignSplitsByEmotion(textMeta);

  const out: GoldRow[] = [];
  for (const [text_id, rs] of byText) {
    if (splitMap.get(text_id) !== "test") continue;

    const med: Record<string, number> = {};
    for (const c of APPRAISAL_COLS) med[c] = median(rs.map((r) => r.appraisals[c]));

    const valence = (med.pleasantness - med.unpleasantness + 4) / 8;
    const arousal = (norm(med.suddenness) + norm(med.urgency) + norm(med.attention)) / 3;
    const sc = norm(med.self_control);
    const oc = norm(med.other_control);
    const cc = norm(med.chance_control);
    const control = Math.max(0, Math.min(1, 0.6 * sc + 0.2 * (1 - cc) + 0.2 * (1 - oc)));
    const certainty = (norm(med.predict_event) + norm(med.predict_conseq) + norm(med.familiarity)) / 3;
    const goalRelevance = norm(med.goal_relevance);

    const sr = med.self_responsblt;
    const or = med.other_responsblt;
    const cr = med.chance_responsblt;
    const m = Math.max(sr, or, cr);
    const agencyBin: "SELF" | "OTHER" | "SITUATION" = cr === m ? "SITUATION" : or === m ? "OTHER" : "SELF";
    const agency = agencyBin === "SELF" ? 0 : agencyBin === "OTHER" ? 0.5 : 1;

    out.push({
      text_id,
      original_emotion: rs[0].original_emotion,
      split: "test",
      continuous: { valence, arousal, agency, control, certainty, goalRelevance },
      scale5: {
        valence: 1 + 4 * valence,
        arousal: 1 + 4 * arousal,
        agency: 1 + 4 * agency,
        control: 1 + 4 * control,
        certainty: 1 + 4 * certainty,
        goalRelevance: 1 + 4 * goalRelevance,
      },
      bins: {
        valence: valenceBin(valence),
        arousal: bin3(arousal),
        agency: agencyBin,
        control: bin3(control),
        certainty: bin2(certainty),
        goalRelevance: bin2(goalRelevance),
      },
      medians: med,
    });
  }

  const outDir = path.dirname(OUT_PATH);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), "utf-8");
  console.log(`Wrote ${out.length} rows: ${OUT_PATH}`);
}

main();

