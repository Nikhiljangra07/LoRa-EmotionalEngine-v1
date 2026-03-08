import type {
  ConsolidationInput,
  ConsolidationResult,
  ConsolidationEpisode,
  CSchema,
} from './consolidationTypes';
import { clamp, safeNumber, l2Normalize, cosineSimilarity } from './normalize';
import { MEMORY_V1_CONFIG } from './constants';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_SCHEMAS = 20;
const THETA_TOPIC = 0.65;
const THETA_MERGE = 0.80;
const DELTA_RELAX = 0.05;
const MAX_RELAX_STEPS = 3;
const MIN_COOCCUR = 3;
const MIN_SCHEMA_AGE_SESSIONS = 2;
const ALPHA_SCHEMA = 0.30;
const ALPHA_SALIENCE_W = 0.30;
const PRUNE_HALFLIFE_HOURS = 168;
const MAX_BIAS = 0.20;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function consolidate(input: ConsolidationInput): ConsolidationResult {
  const { nowMs, episodes, schemas } = input;

  let working: CSchema[] = schemas.map((s) => ({
    ...s,
    centroid: l2Normalize(
      s.centroid.map((v) => safeNumber(v, 0)),
      MEMORY_V1_CONFIG.L2_EPS,
    ),
    salienceWeight: clamp(safeNumber(s.salienceWeight, 0), 0, 1),
    retrievalBias: clamp(safeNumber(s.retrievalBias, 0), -MAX_BIAS, MAX_BIAS),
  }));

  const createdSchemaIds: string[] = [];
  const mergedPairs: Array<{ fromId: string; intoId: string }> = [];
  const prunedSchemaIds: string[] = [];
  const episodeAssignments: Array<{ eventId: string; schemaId: string }> = [];

  // -------------------------------------------------------------------
  // A) Assignment pass
  // -------------------------------------------------------------------
  const sorted = [...episodes].sort((a, b) => a.id.localeCompare(b.id));
  let newCounter = 0;

  for (const ep of sorted) {
    let bestSim = -Infinity;
    let bestId: string | null = null;

    for (const schema of working) {
      const sim = cosineSimilarity(ep.emotionVec, schema.centroid);
      if (sim > bestSim) {
        bestSim = sim;
        bestId = schema.schemaId;
      }
    }

    if (bestSim >= THETA_TOPIC && bestId !== null) {
      episodeAssignments.push({ eventId: ep.id, schemaId: bestId });
    } else {
      const newId = `schema_new_${newCounter}`;
      newCounter++;

      working.push({
        schemaId: newId,
        centroid: l2Normalize(ep.emotionVec.slice(), MEMORY_V1_CONFIG.L2_EPS),
        salienceWeight: clamp(safeNumber(ep.salience, 0), 0, 1),
        episodeCount: 0,
        retrievalBias: 0,
        createdAt: nowMs,
        lastUpdatedAt: nowMs,
        sessionCount: 0,
      });

      episodeAssignments.push({ eventId: ep.id, schemaId: newId });
      createdSchemaIds.push(newId);
    }
  }

  // -------------------------------------------------------------------
  // B) Update pass (EWMA)
  // -------------------------------------------------------------------
  const epMap = new Map<string, ConsolidationEpisode>();
  for (const ep of sorted) epMap.set(ep.id, ep);

  const groupedBySchema = new Map<string, ConsolidationEpisode[]>();
  for (const a of episodeAssignments) {
    const ep = epMap.get(a.eventId);
    if (!ep) continue;
    let arr = groupedBySchema.get(a.schemaId);
    if (!arr) {
      arr = [];
      groupedBySchema.set(a.schemaId, arr);
    }
    arr.push(ep);
  }

  working = working.map((schema) => {
    const assigned = groupedBySchema.get(schema.schemaId);
    if (!assigned || assigned.length === 0) return schema;

    const vecLen = schema.centroid.length;
    const meanVec = computeMeanVec(
      assigned.map((e) => e.emotionVec),
      vecLen,
    );

    const newCentroid = new Array(vecLen);
    for (let i = 0; i < vecLen; i++) {
      newCentroid[i] =
        (1 - ALPHA_SCHEMA) * safeNumber(schema.centroid[i], 0) +
        ALPHA_SCHEMA * safeNumber(meanVec[i], 0);
    }

    const meanSal =
      assigned.reduce((s, e) => s + clamp(safeNumber(e.salience, 0), 0, 1), 0) /
      assigned.length;

    return {
      ...schema,
      centroid: l2Normalize(newCentroid, MEMORY_V1_CONFIG.L2_EPS),
      salienceWeight: clamp(
        (1 - ALPHA_SALIENCE_W) * safeNumber(schema.salienceWeight, 0) +
          ALPHA_SALIENCE_W * meanSal,
        0,
        1,
      ),
      episodeCount: schema.episodeCount + assigned.length,
      sessionCount: schema.sessionCount + 1,
      lastUpdatedAt: nowMs,
    };
  });

  // -------------------------------------------------------------------
  // C) Capacity handling
  // -------------------------------------------------------------------
  const schemaCounts = new Map<string, number>();
  for (const a of episodeAssignments) {
    schemaCounts.set(a.schemaId, (schemaCounts.get(a.schemaId) || 0) + 1);
  }

  while (working.length > MAX_SCHEMAS) {
    let merged = false;

    for (let step = 0; step <= MAX_RELAX_STEPS; step++) {
      const threshold = THETA_MERGE - step * DELTA_RELAX;
      const pair = findBestMergePair(working, schemaCounts, threshold);

      if (pair) {
        const { into, from } = determineMergeDirection(pair[0], pair[1]);
        const result = mergeSchemas(into, from, nowMs);

        working = working
          .filter((s) => s.schemaId !== from.schemaId)
          .map((s) => (s.schemaId === into.schemaId ? result : s));

        schemaCounts.set(
          into.schemaId,
          (schemaCounts.get(into.schemaId) || 0) +
            (schemaCounts.get(from.schemaId) || 0),
        );
        schemaCounts.delete(from.schemaId);

        mergedPairs.push({ fromId: from.schemaId, intoId: into.schemaId });
        merged = true;
        break;
      }
    }

    if (!merged) {
      const pruneId = findPruneTarget(working, nowMs);
      working = working.filter((s) => s.schemaId !== pruneId);
      schemaCounts.delete(pruneId);
      prunedSchemaIds.push(pruneId);
    }
  }

  // -------------------------------------------------------------------
  // D) Sort deterministically
  // -------------------------------------------------------------------
  working.sort((a, b) => a.schemaId.localeCompare(b.schemaId));

  return {
    updatedSchemas: working,
    createdSchemaIds,
    mergedPairs,
    prunedSchemaIds,
    episodeAssignments,
    noveltyFlag: createdSchemaIds.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------


function computeMeanVec(vecs: number[][], length: number): number[] {
  const mean = new Array(length).fill(0);
  if (vecs.length === 0) return mean;
  for (const vec of vecs) {
    for (let i = 0; i < length; i++) {
      mean[i] += safeNumber(vec[i], 0);
    }
  }
  for (let i = 0; i < length; i++) {
    mean[i] /= vecs.length;
  }
  return mean;
}

function findBestMergePair(
  schemas: CSchema[],
  schemaCounts: Map<string, number>,
  threshold: number,
): [CSchema, CSchema] | null {
  let best: [CSchema, CSchema] | null = null;
  let bestSim = -Infinity;

  for (let i = 0; i < schemas.length; i++) {
    const a = schemas[i];
    if (a.sessionCount < MIN_SCHEMA_AGE_SESSIONS) continue;
    const countA = schemaCounts.get(a.schemaId) || 0;
    if (countA < 1) continue;

    for (let j = i + 1; j < schemas.length; j++) {
      const b = schemas[j];
      if (b.sessionCount < MIN_SCHEMA_AGE_SESSIONS) continue;
      const countB = schemaCounts.get(b.schemaId) || 0;
      if (countB < 1) continue;

      const cooccur = Math.min(countA, countB);
      if (cooccur < MIN_COOCCUR) continue;

      const sim = cosineSimilarity(a.centroid, b.centroid);
      if (sim >= threshold && sim > bestSim) {
        bestSim = sim;
        best = [a, b];
      }
    }
  }

  return best;
}

function determineMergeDirection(
  a: CSchema,
  b: CSchema,
): { into: CSchema; from: CSchema } {
  if (a.salienceWeight !== b.salienceWeight) {
    return a.salienceWeight > b.salienceWeight
      ? { into: a, from: b }
      : { into: b, from: a };
  }
  if (a.episodeCount !== b.episodeCount) {
    return a.episodeCount > b.episodeCount
      ? { into: a, from: b }
      : { into: b, from: a };
  }
  return a.schemaId.localeCompare(b.schemaId) <= 0
    ? { into: a, from: b }
    : { into: b, from: a };
}

function mergeSchemas(into: CSchema, from: CSchema, nowMs: number): CSchema {
  const total = into.episodeCount + from.episodeCount;
  const wI = total > 0 ? into.episodeCount / total : 0.5;
  const wF = total > 0 ? from.episodeCount / total : 0.5;

  const len = into.centroid.length;
  const merged = new Array(len);
  for (let i = 0; i < len; i++) {
    merged[i] =
      wI * safeNumber(into.centroid[i], 0) +
      wF * safeNumber(from.centroid[i], 0);
  }

  return {
    schemaId: into.schemaId,
    centroid: l2Normalize(merged, MEMORY_V1_CONFIG.L2_EPS),
    salienceWeight: clamp(
      wI * safeNumber(into.salienceWeight, 0) +
        wF * safeNumber(from.salienceWeight, 0),
      0,
      1,
    ),
    episodeCount: total,
    retrievalBias: clamp(
      (safeNumber(into.retrievalBias, 0) + safeNumber(from.retrievalBias, 0)) / 2,
      -MAX_BIAS,
      MAX_BIAS,
    ),
    createdAt: Math.min(into.createdAt, from.createdAt),
    lastUpdatedAt: nowMs,
    sessionCount: Math.max(into.sessionCount, from.sessionCount),
  };
}

function findPruneTarget(schemas: CSchema[], nowMs: number): string {
  const scored = schemas.map((s) => ({
    schemaId: s.schemaId,
    score: computePruneScore(s, nowMs),
    episodeCount: s.episodeCount,
    createdAt: s.createdAt,
  }));

  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    if (a.episodeCount !== b.episodeCount) return a.episodeCount - b.episodeCount;
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.schemaId.localeCompare(b.schemaId);
  });

  return scored[0].schemaId;
}

function computePruneScore(schema: CSchema, nowMs: number): number {
  const deltaMs = safeNumber(nowMs - schema.lastUpdatedAt, 0);
  const deltaHours = Math.max(0, deltaMs) / (1000 * 60 * 60);
  const recency = Math.exp(-deltaHours / PRUNE_HALFLIFE_HOURS);
  const sal = clamp(safeNumber(schema.salienceWeight, 0), 0, 1);
  return safeNumber(sal * clamp(safeNumber(recency, 0), 0, 1), 0);
}
