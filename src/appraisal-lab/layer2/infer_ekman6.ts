/**
 * Layer-2: Experimental Ekman-6 inference wrapper (isolated).
 *
 * Loads the Ekman-6 likelihood table, accepts LoRa-6 appraisal bins,
 * computes posterior in log space with IRR-based dimension weighting,
 * and applies a reliability gate + harmful-pair conservative rule.
 *
 * NO integration with existing infer() or runtime code.
 * Fully isolated — imports only from sibling layer2 modules and Node built-ins.
 *
 * Usage as library:
 *   import { inferEkman6 } from './infer_ekman6';
 *   const result = inferEkman6({ valence: 'NEG', arousal: 'HIGH', ... });
 */

import * as fs from "fs";
import * as path from "path";
import type { CollapsedEmotion } from "./emotion_collapse_map";

// ============================================================
// Types
// ============================================================

export interface AppraisalBins {
  valence: string;
  arousal: string;
  agency: string;
  control: string;
  certainty: string;
  goalRelevance: string;
}

export type GatingDecision = "COMMIT" | "HEDGE" | "NEUTRAL";

export interface Ekman6InferenceResult {
  posterior: Record<CollapsedEmotion, number>;
  topEmotion: CollapsedEmotion;
  decision: GatingDecision;
  diagnostics: {
    pmax: number;
    margin: number;
    entropy: number;
    entropyNorm: number;
    harmfulPairOverride: boolean;
  };
}

// ============================================================
// Gate thresholds (mirrored from reliability_gate.ts, not imported)
// ============================================================

const PMAX_COMMIT = 0.60;
const MARGIN_COMMIT = 0.15;
const ENTROPY_HEDGE = 0.80;

// Layer-2 experimental harmful-pair safeguard
const HARMFUL_PAIRS: [CollapsedEmotion, CollapsedEmotion][] = [
  ["ANGER", "FEAR"],
];
const HARMFUL_PAIR_MARGIN = 0.15;

// ============================================================
// Table types
// ============================================================

interface Ekman6Table {
  metadata: {
    dimension_weights: Record<string, number>;
    collapsed_emotions: string[];
  };
  priors: Record<string, number>;
  likelihoods: Record<string, Record<string, Record<string, number>>>;
}

// ============================================================
// Singleton table loader
// ============================================================

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const TABLE_PATH = path.join(REPO_ROOT, "data", "layer2", "likelihood_table_ekman6_v1_1.json");

let _cachedTable: Ekman6Table | null = null;

function loadTable(): Ekman6Table {
  if (_cachedTable) return _cachedTable;
  if (!fs.existsSync(TABLE_PATH)) {
    throw new Error(`Ekman-6 table not found at ${TABLE_PATH}. Run build_likelihood_table_ekman6.ts first.`);
  }
  _cachedTable = JSON.parse(fs.readFileSync(TABLE_PATH, "utf-8"));
  return _cachedTable!;
}

// ============================================================
// Inference
// ============================================================

const DIMENSIONS = [
  "valence",
  "arousal",
  "agency",
  "control",
  "certainty",
  "goalRelevance",
] as const;

export function inferEkman6(bins: AppraisalBins): Ekman6InferenceResult {
  const table = loadTable();
  const emotions = table.metadata.collapsed_emotions as CollapsedEmotion[];
  const weights = table.metadata.dimension_weights;

  // Log-space posterior: log P(E|D) ∝ log P(E) + Σ w_i * log P(D_i | E)
  const logPosterior: Record<string, number> = {};

  for (const emo of emotions) {
    let logP = Math.log(table.priors[emo]);

    for (const dim of DIMENSIONS) {
      const binVal = bins[dim];
      const dimLikelihoods = table.likelihoods[dim]?.[emo];
      if (!dimLikelihoods) {
        throw new Error(`Missing likelihoods for ${dim}/${emo}`);
      }

      const likelihood = dimLikelihoods[binVal];
      if (likelihood === undefined || likelihood <= 0) {
        throw new Error(`Missing or zero likelihood for ${dim}/${emo}/${binVal}`);
      }

      const w = weights[dim] ?? 1.0;
      logP += w * Math.log(likelihood);
    }

    logPosterior[emo] = logP;
  }

  // Normalize via log-sum-exp
  const maxLog = Math.max(...Object.values(logPosterior));
  let sumExp = 0;
  for (const emo of emotions) {
    sumExp += Math.exp(logPosterior[emo] - maxLog);
  }
  const logNorm = maxLog + Math.log(sumExp);

  const posterior: Record<string, number> = {};
  for (const emo of emotions) {
    posterior[emo] = Math.exp(logPosterior[emo] - logNorm);
  }

  // Sort by probability descending
  const sorted = emotions.slice().sort((a, b) => posterior[b] - posterior[a]);
  const topEmotion = sorted[0];
  const pmax = posterior[topEmotion];
  const p2 = posterior[sorted[1]] ?? 0;
  const margin = pmax - p2;

  // Shannon entropy
  const K = emotions.length;
  let H = 0;
  for (const emo of emotions) {
    const p = posterior[emo];
    if (p > 0) H -= p * Math.log(p);
  }
  const Hmax = K > 1 ? Math.log(K) : 1;
  const entropyNorm = H / Hmax;

  // Gating decision (mirrors reliability_gate.ts logic)
  let decision: GatingDecision;
  if (pmax >= PMAX_COMMIT && margin >= MARGIN_COMMIT && entropyNorm < ENTROPY_HEDGE) {
    decision = "COMMIT";
  } else if (entropyNorm >= ENTROPY_HEDGE) {
    decision = "NEUTRAL";
  } else {
    decision = "HEDGE";
  }

  // Layer-2 experimental harmful-pair safeguard:
  // If top-2 emotions form a harmful pair and margin is tight, force HEDGE.
  let harmfulPairOverride = false;
  if (margin < HARMFUL_PAIR_MARGIN && sorted.length >= 2) {
    const top2Set = new Set([sorted[0], sorted[1]]);
    for (const [a, b] of HARMFUL_PAIRS) {
      if (top2Set.has(a) && top2Set.has(b)) {
        if (decision === "COMMIT") {
          decision = "HEDGE";
          harmfulPairOverride = true;
        }
        break;
      }
    }
  }

  return {
    posterior: posterior as Record<CollapsedEmotion, number>,
    topEmotion,
    decision,
    diagnostics: {
      pmax,
      margin,
      entropy: H,
      entropyNorm,
      harmfulPairOverride,
    },
  };
}
