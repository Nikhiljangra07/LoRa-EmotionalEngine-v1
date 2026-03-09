/**
 * Layer-2 Step 3: Run existing Layer-1 rule mapper on TEST text_ids.
 *
 * Uses deterministic split assignment (seed=42; stratified by original_emotion),
 * then applies Layer-1 appraisal mapper to test items.
 *
 * Output:
 *   data/layer2/rule_mapper_test_outputs.json
 */

import * as fs from "fs";
import * as path from "path";
import { getAppraisalMapping } from "../dataset/appraisal_mapper";

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
const OUT_PATH = path.join(REPO_ROOT, "data", "layer2", "rule_mapper_test_outputs.json");

const SUPPORTED = new Set(["anger", "fear", "disgust", "sadness", "joy"]);
const SEED = 42;

type Split = "train" | "dev" | "test";
type Layer1Emotion = "ANGER" | "FEAR" | "DISGUST" | "SADNESS" | "JOY";

interface TestOut {
  text_id: string;
  original_emotion: string;
  mapped_emotion: Layer1Emotion | null;
  skipped: boolean;
  reason: string | null;
  continuous: {
    valence: number;
    arousal: number;
    agency: number;
    control: number;
    certainty: number;
    goalRelevance: number;
  } | null;
  scale5: {
    valence: number;
    arousal: number;
    agency: number;
    control: number;
    certainty: number;
    goalRelevance: number;
  } | null;
  bins: {
    valence: "NEG" | "NEU" | "POS";
    arousal: "LOW" | "MED" | "HIGH";
    agency: "SELF" | "OTHER" | "SITUATION";
    control: "LOW" | "MED" | "HIGH";
    certainty: "LOW" | "HIGH";
    goalRelevance: "LOW" | "HIGH";
  } | null;
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
function assignSplitsByEmotion(groups: Array<{ text_id: string; original_emotion: string }>): Map<string, Split> {
  const byEmotion = new Map<string, Array<{ text_id: string; original_emotion: string }>>();
  for (const g of groups) {
    if (!byEmotion.has(g.original_emotion)) byEmotion.set(g.original_emotion, []);
    byEmotion.get(g.original_emotion)!.push(g);
  }
  const out = new Map<string, Split>();
  const rng = mulberry32(SEED);
  for (const emo of [...byEmotion.keys()].sort()) {
    const shuffled = seededShuffle(byEmotion.get(emo)!, rng);
    const n = shuffled.length;
    const trainEnd = Math.round(n * 0.7);
    const devEnd = Math.round(n * 0.85);
    for (let i = 0; i < n; i++) {
      out.set(shuffled[i].text_id, i < trainEnd ? "train" : i < devEnd ? "dev" : "test");
    }
  }
  return out;
}

function toContinuousAndScale5FromBins(v: {
  valence: "NEG" | "NEU" | "POS";
  arousal: "LOW" | "MED" | "HIGH";
  agency: "SELF" | "OTHER" | "SITUATION";
  control: "LOW" | "MED" | "HIGH";
  certainty: "LOW" | "HIGH";
  goalRelevance: "LOW" | "HIGH";
}) {
  const valence = v.valence === "NEG" ? 0 : v.valence === "NEU" ? 0.5 : 1;
  const arousal = v.arousal === "LOW" ? 0 : v.arousal === "MED" ? 0.5 : 1;
  const agency = v.agency === "SELF" ? 0 : v.agency === "OTHER" ? 0.5 : 1;
  const control = v.control === "LOW" ? 0 : v.control === "MED" ? 0.5 : 1;
  const certainty = v.certainty === "LOW" ? 0 : 1;
  const goalRelevance = v.goalRelevance === "LOW" ? 0 : 1;
  return {
    continuous: { valence, arousal, agency, control, certainty, goalRelevance },
    scale5: {
      valence: 1 + 4 * valence,
      arousal: 1 + 4 * arousal,
      agency: 1 + 4 * agency,
      control: 1 + 4 * control,
      certainty: 1 + 4 * certainty,
      goalRelevance: 1 + 4 * goalRelevance,
    },
  };
}

function main(): void {
  console.log("=== Layer-2: Run Rule Mapper on TEST ===");
  const lines = fs.readFileSync(TSV_PATH, "utf-8").split("\n").filter((l) => l.trim());
  const headers = lines[0].split("\t");
  const idIdx = headers.indexOf("text_id");
  const emoIdx = headers.indexOf("original_emotion");
  if (idIdx < 0 || emoIdx < 0) throw new Error("Missing text_id/original_emotion");

  const byText = new Map<string, { text_id: string; original_emotion: string }>();
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split("\t");
    const tid = (c[idIdx] ?? "").trim();
    const emo = (c[emoIdx] ?? "").trim();
    if (!byText.has(tid)) byText.set(tid, { text_id: tid, original_emotion: emo });
  }
  const splitMap = assignSplitsByEmotion([...byText.values()]);

  const out: TestOut[] = [];
  let skipped = 0;
  for (const row of byText.values()) {
    if (splitMap.get(row.text_id) !== "test") continue;
    if (!SUPPORTED.has(row.original_emotion)) {
      skipped++;
      out.push({
        text_id: row.text_id,
        original_emotion: row.original_emotion,
        mapped_emotion: null,
        skipped: true,
        reason: "unsupported_emotion_for_layer1_mapper",
        continuous: null,
        scale5: null,
        bins: null,
      });
      continue;
    }
    const mappedEmotion = row.original_emotion.toUpperCase() as Layer1Emotion;
    const bins = getAppraisalMapping(mappedEmotion);
    const conv = toContinuousAndScale5FromBins(bins);
    out.push({
      text_id: row.text_id,
      original_emotion: row.original_emotion,
      mapped_emotion: mappedEmotion,
      skipped: false,
      reason: null,
      bins,
      continuous: conv.continuous,
      scale5: conv.scale5,
    });
  }

  const outDir = path.dirname(OUT_PATH);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), "utf-8");
  console.log(`Wrote ${out.length} TEST rows (${skipped} skipped unsupported): ${OUT_PATH}`);
}

main();

