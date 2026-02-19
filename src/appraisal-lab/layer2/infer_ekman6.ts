/**
 * Layer-2: Experimental Ekman-6 inference wrapper (isolated).
 *
 * Loads the Ekman-6 likelihood table, accepts LoRa-6 appraisal bins,
 * computes posterior in log space with configurable dimension weighting,
 * and applies a reliability gate + harmful-pair conservative rule.
 *
 * Supports multiple configurations via Ekman6InferenceConfig:
 *   - Prior mode: learned (from data), uniform (1/K), or blend
 *   - Weight mode: linear_floor (κ-proportional) or tiered (step function)
 *   - Pair-aware boost: temporarily raise discriminative dimension weights
 *     when top-2 emotions form a known confusion pair
 *
 * NO integration with existing infer() or runtime code.
 * Fully isolated — imports only from sibling layer2 modules and Node built-ins.
 *
 * Usage:
 *   import { inferEkman6 } from './infer_ekman6';
 *   const result = inferEkman6({ valence: 'NEG', arousal: 'HIGH', ... });
 *   const result2 = inferEkman6(bins, { ...DEFAULT_CONFIG, priorMode: 'learned' });
 */

import * as fs from "fs";
import * as path from "path";
import type { CollapsedEmotion } from "./emotion_collapse_map";
import {
  DEFAULT_CONFIG,
  Ekman6InferenceConfig,
  RawEkman6Config,
  normalizeEkman6Config,
} from "./ekman6_inference_config";

// ============================================================
// Re-exports for consumers
// ============================================================

export {
  DEFAULT_CONFIG,
  Ekman6InferenceConfig,
  RawEkman6Config,
  ResolvedEkman6Config,
  normalizeEkman6Config,
} from "./ekman6_inference_config";

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
    pairBoostApplied: boolean;
    weights: Record<string, number>;
  };
}

// Layer-2 experimental harmful-pair safeguard
const HARMFUL_PAIRS: [CollapsedEmotion, CollapsedEmotion][] = [
  ["ANGER", "FEAR"],
  ["ANGER", "DISGUST"],
];
const HARMFUL_PAIR_MARGIN = 0.15;

// Confusion pairs for pair-aware discriminative boost
const CONFUSION_PAIRS: [CollapsedEmotion, CollapsedEmotion][] = [
  ["ANGER", "FEAR"],
  ["ANGER", "SADNESS"],
  ["FEAR", "SADNESS"],
];

// ============================================================
// Aggregated IRR κ per LoRa dimension
// Deterministically derived from data/layer2/irr_kappa_table.csv
// via the source-column mapping in mapping_spec.md v1.1.
// ============================================================

const AGGREGATED_KAPPAS: Record<string, number> = {
  valence: 0.729077,
  arousal: 0.331807,
  agency: 0.500846,
  control: 0.399613,
  certainty: 0.320924,
  goalRelevance: 0.375800,
};

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

function normalizeProbMap(map: Record<string, number>): Record<string, number> {
  const total = Object.values(map).reduce((a, b) => a + b, 0);
  if (!isFinite(total) || total <= 0) {
    throw new Error(`Invalid probability map total: ${total}`);
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(map)) {
    out[k] = v / total;
  }
  return out;
}

function computePriors(
  priorMode: Ekman6InferenceConfig["priorMode"],
  priorBlendLambda: number,
  learnedPriors: Record<string, number>,
  emotions: CollapsedEmotion[]
): Record<string, number> {
  const K = emotions.length;
  const uniformP = 1 / K;

  if (priorMode === "uniform") {
    const out: Record<string, number> = {};
    for (const emo of emotions) out[emo] = uniformP;
    return out;
  }

  if (priorMode === "learned") {
    const out: Record<string, number> = {};
    for (const emo of emotions) {
      const p = learnedPriors[emo];
      if (p === undefined || !isFinite(p) || p <= 0) {
        throw new Error(`Invalid learned prior for ${emo}: ${p}`);
      }
      out[emo] = p;
    }
    return normalizeProbMap(out);
  }

  // blend: π* = (1-λ)π_uniform + λπ_learned
  const lambda = Math.max(0, Math.min(1, priorBlendLambda));
  const blended: Record<string, number> = {};
  for (const emo of emotions) {
    const learned = learnedPriors[emo];
    if (learned === undefined || !isFinite(learned) || learned < 0) {
      throw new Error(`Invalid learned prior for ${emo}: ${learned}`);
    }
    blended[emo] = (1 - lambda) * uniformP + lambda * learned;
  }
  return normalizeProbMap(blended);
}

// ============================================================
// Weight computation
// ============================================================

const DIMENSIONS = [
  "valence",
  "arousal",
  "agency",
  "control",
  "certainty",
  "goalRelevance",
] as const;

function computeWeights(config: Ekman6InferenceConfig): Record<string, number> {
  const weights: Record<string, number> = {};

  for (const dim of DIMENSIONS) {
    const kappa = AGGREGATED_KAPPAS[dim];

    if (config.weightMode === "linear_floor") {
      const raw = config.weightFloor + config.weightSlope * kappa;
      weights[dim] = Math.max(config.weightFloor, Math.min(1.0, raw));
    } else {
      // tiered
      if (kappa >= 0.60) weights[dim] = 1.00;
      else if (kappa >= 0.50) weights[dim] = 0.70;
      else if (kappa >= 0.40) weights[dim] = 0.50;
      else weights[dim] = 0.30;
    }
  }

  return weights;
}

// ============================================================
// Core posterior computation (pure, no side effects)
// ============================================================

function computePosterior(
  bins: AppraisalBins,
  table: Ekman6Table,
  emotions: CollapsedEmotion[],
  weights: Record<string, number>,
  priors: Record<string, number>
): Record<string, number> {
  const logPosterior: Record<string, number> = {};

  for (const emo of emotions) {
    let logP = Math.log(priors[emo]);

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
      logP += (weights[dim] ?? 1.0) * Math.log(likelihood);
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

  return posterior;
}

// ============================================================
// Inference
// ============================================================

export function inferEkman6(
  bins: AppraisalBins,
  userConfig?: RawEkman6Config
): Ekman6InferenceResult {
  const config = normalizeEkman6Config(userConfig ?? DEFAULT_CONFIG);
  const table = loadTable();
  const emotions = table.metadata.collapsed_emotions as CollapsedEmotion[];

  // Prior selection
  const priors = computePriors(
    config.priorMode,
    config.priorBlendLambda,
    table.priors,
    emotions
  );

  // Weight computation
  let weights = computeWeights(config);

  // Initial posterior
  let posterior = computePosterior(bins, table, emotions, weights, priors);

  // Pair-aware discriminative boost
  let pairBoostApplied = false;
  if (config.pairAwareBoost) {
    const sorted = emotions.slice().sort((a, b) => posterior[b] - posterior[a]);
    if (sorted.length >= 2) {
      const top2Set = new Set([sorted[0], sorted[1]]);
      const isConfusionPair = CONFUSION_PAIRS.some(
        ([a, b]) => top2Set.has(a) && top2Set.has(b)
      );

      if (isConfusionPair) {
        // Boost discriminative dimensions (local copy, no global mutation)
        const boosted = { ...weights };
        boosted.control = Math.max(boosted.control, config.controlMinBoost);
        boosted.certainty = Math.max(boosted.certainty, config.certaintyMinBoost);
        boosted.arousal = Math.max(boosted.arousal, config.arousalMinBoost);

        // Recompute with boosted weights
        posterior = computePosterior(bins, table, emotions, boosted, priors);
        weights = boosted;
        pairBoostApplied = true;
      }
    }
  }

  // Sort final posterior
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

  // Gating decision
  let decision: GatingDecision;
  if (pmax >= config.pmaxCommit && margin >= config.marginCommit && entropyNorm < config.entropyHedge) {
    decision = "COMMIT";
  } else if (entropyNorm >= config.entropyHedge) {
    decision = "NEUTRAL";
  } else {
    decision = "HEDGE";
  }

  // Harmful-pair safeguard (post-gate override)
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
      pairBoostApplied,
      weights: { ...weights },
    },
  };
}
