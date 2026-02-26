import { clamp, safeNumber, cosineSimilarity } from './normalize';
import type { SchemaRecord } from './schemaStore';
import { applyRIF, applyBiasDecay, type RIFState } from './rif';
import { updateGuard, type RIFGuardState } from './rifGuard';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const THETA_RETRIEVE = 0.50;
const SOFTMAX_TEMPERATURE = 0.15;
const BIAS_DECAY = 0.01;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RetrievalResult = {
  topSchemaIds: string[];
  winnerId?: string;
  confidence: number;
  noMatch: boolean;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function retrieveSchemas(
  queryVec: number[],
  schemas: SchemaRecord[],
  rifState: RIFState,
  guardState: RIFGuardState,
): {
  result: RetrievalResult;
  updatedSchemas: SchemaRecord[];
  updatedGuard: RIFGuardState;
} {
  if (schemas.length === 0) {
    return {
      result: { topSchemaIds: [], winnerId: undefined, confidence: 0, noMatch: true },
      updatedSchemas: [],
      updatedGuard: guardState,
    };
  }

  const cosSims = schemas.map((s) => cosineSimilarity(queryVec, s.centroid));

  const maxCos = Math.max(...cosSims);

  if (maxCos < THETA_RETRIEVE) {
    return {
      result: {
        topSchemaIds: schemas.map((s) => s.schemaId),
        winnerId: undefined,
        confidence: 0,
        noMatch: true,
      },
      updatedSchemas: schemas.map((s) => ({ ...s })),
      updatedGuard: guardState,
    };
  }

  const scores = schemas.map((s, i) =>
    clamp(safeNumber(cosSims[i], 0) + safeNumber(s.retrievalBias, 0), -1, 1),
  );

  const probs = softmax(scores, SOFTMAX_TEMPERATURE);

  let winnerIdx = 0;
  for (let i = 1; i < probs.length; i++) {
    if (probs[i] > probs[winnerIdx]) winnerIdx = i;
  }

  const winnerId = schemas[winnerIdx].schemaId;
  const confidence = clamp(safeNumber(probs[winnerIdx], 0), 0, 1);

  const sorted = probs
    .map((p, i) => ({ id: schemas[i].schemaId, p }))
    .sort((a, b) => b.p - a.p);
  const topSchemaIds = sorted.map((e) => e.id);

  let updatedSchemas = applyBiasDecay(schemas, BIAS_DECAY);

  const { newGuard, effectiveAlpha, effectiveBeta } = updateGuard(guardState, winnerId);

  const alpha = safeNumber(rifState.alpha, 0) * effectiveAlpha;
  const beta = safeNumber(rifState.beta, 0) * effectiveBeta;

  updatedSchemas = applyRIF(updatedSchemas, winnerId, alpha, beta);

  return {
    result: { topSchemaIds, winnerId, confidence, noMatch: false },
    updatedSchemas,
    updatedGuard: newGuard,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------


function softmax(scores: number[], temperature: number): number[] {
  const t = Math.max(temperature, 1e-12);
  const scaled = scores.map((s) => safeNumber(s, 0) / t);
  const maxScaled = Math.max(...scaled);
  const exps = scaled.map((s) => Math.exp(s - maxScaled));
  const sum = exps.reduce((a, b) => a + b, 0);
  if (sum < 1e-12) {
    return new Array(scores.length).fill(1 / scores.length);
  }
  return exps.map((e) => safeNumber(e / sum, 0));
}
