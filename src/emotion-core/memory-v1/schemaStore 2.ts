import { clamp, safeNumber, l2Normalize } from './normalize';
import { MEMORY_V1_CONFIG } from './constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SchemaRecord = {
  schemaId: string;
  centroid: number[];
  salienceWeight: number;
  episodeCount: number;
  retrievalBias: number;
  createdAt: number;
  lastUpdatedAt: number;
};

export type SchemaStoreState = {
  userId: string;
  schemas: SchemaRecord[];
  maxSchemas: number;
};

// ---------------------------------------------------------------------------
// Local constants
// ---------------------------------------------------------------------------

const MAX_SCHEMAS = 20;
const SALIENCE_EWMA_ALPHA = 0.2;
const CENTROID_EWMA_ALPHA = 0.2;
const PRUNE_RECENCY_HALF_LIFE_HOURS = 168;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createSchemaStore(
  userId: string,
  maxSchemas: number = MAX_SCHEMAS,
): SchemaStoreState {
  return { userId, schemas: [], maxSchemas };
}

export function listSchemas(state: SchemaStoreState): SchemaRecord[] {
  return state.schemas.map((s) => ({ ...s, centroid: s.centroid.slice() }));
}

export function upsertSchema(
  state: SchemaStoreState,
  schema: SchemaRecord,
): SchemaStoreState {
  const idx = state.schemas.findIndex((s) => s.schemaId === schema.schemaId);
  let next: SchemaRecord[];
  if (idx >= 0) {
    next = state.schemas.map((s, i) =>
      i === idx ? { ...schema, centroid: schema.centroid.slice() } : s,
    );
  } else {
    next = [...state.schemas, { ...schema, centroid: schema.centroid.slice() }];
  }
  return { ...state, schemas: next };
}

export function pruneIfNeeded(
  state: SchemaStoreState,
  nowMs: number,
): { nextState: SchemaStoreState; prunedSchemaId?: string } {
  if (state.schemas.length <= state.maxSchemas) {
    return { nextState: state };
  }

  const scored = state.schemas.map((s) => ({
    schemaId: s.schemaId,
    score: computePruneScore(s, nowMs),
    episodeCount: s.episodeCount,
    createdAt: s.createdAt,
  }));

  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    if (a.episodeCount !== b.episodeCount) return a.episodeCount - b.episodeCount;
    return a.createdAt - b.createdAt;
  });

  const pruneId = scored[0].schemaId;
  const remaining = state.schemas.filter((s) => s.schemaId !== pruneId);

  return {
    nextState: { ...state, schemas: remaining },
    prunedSchemaId: pruneId,
  };
}

export function updateSchemaFromEpisode(
  state: SchemaStoreState,
  schemaId: string,
  episodeVec: number[],
  episodeSalience: number,
  nowMs: number,
): SchemaStoreState {
  const safeSalience = clamp(safeNumber(episodeSalience, 0), 0, 1);

  const next = state.schemas.map((s) => {
    if (s.schemaId !== schemaId) return s;

    const newCentroid = new Array(s.centroid.length);
    for (let i = 0; i < s.centroid.length; i++) {
      const oldVal = safeNumber(s.centroid[i], 0);
      const newVal = safeNumber(episodeVec[i], 0);
      newCentroid[i] = ewma(oldVal, newVal, CENTROID_EWMA_ALPHA);
    }
    const normalizedCentroid = l2Normalize(newCentroid, MEMORY_V1_CONFIG.L2_EPS);

    const newSalience = clamp(
      ewma(safeNumber(s.salienceWeight, 0), safeSalience, SALIENCE_EWMA_ALPHA),
      0,
      1,
    );

    return {
      ...s,
      centroid: normalizedCentroid,
      salienceWeight: newSalience,
      episodeCount: s.episodeCount + 1,
      lastUpdatedAt: nowMs,
    };
  });

  return { ...state, schemas: next };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function computeRecencyFactor(schema: SchemaRecord, nowMs: number): number {
  const deltaMs = safeNumber(nowMs - schema.lastUpdatedAt, 0);
  const deltaHours = Math.max(0, deltaMs) / (1000 * 60 * 60);
  const factor = Math.exp(-deltaHours / PRUNE_RECENCY_HALF_LIFE_HOURS);
  return clamp(safeNumber(factor, 0), 0, 1);
}

function computePruneScore(schema: SchemaRecord, nowMs: number): number {
  const sal = clamp(safeNumber(schema.salienceWeight, 0), 0, 1);
  const recency = computeRecencyFactor(schema, nowMs);
  return safeNumber(sal * recency, 0);
}

function ewma(oldValue: number, newValue: number, alpha: number): number {
  const o = safeNumber(oldValue, 0);
  const n = safeNumber(newValue, 0);
  return (1 - alpha) * o + alpha * n;
}
