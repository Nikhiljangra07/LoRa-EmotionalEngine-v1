import type {
  MemoryV1State,
  ProcessMessageInput,
  ProcessMessageOutput,
  EndSessionOutput,
} from './memoryV1EngineTypes';
import type { SalienceInput } from './types';
import type { SchemaRecord } from './schemaStore';
import type { CSchema, ConsolidationEpisode } from './consolidationTypes';
import type { RIFState } from './rif';
import type { RetrievalResult } from './retrievalEngine';
import type { BuildMemoryContextInput } from './memoryContextTypes';

import { encodeEvent } from './eventEncoder';
import { computeSalience } from './salience';
import { createBuffer, pushEvent } from './episodicBuffer';
import { createSchemaStore } from './schemaStore';
import { retrieveSchemas } from './retrievalEngine';
import { buildMemoryContext } from './memoryContext';
import { consolidate } from './consolidationEngine';
import { safeNumber, clamp } from './normalize';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_RIF_ALPHA = 0.04;
const DEFAULT_RIF_BETA = 0.02;
const CONTEXT_THETA = 0.40;
const CONTEXT_C_MIN = 0.15;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createMemoryV1(userId: string): MemoryV1State {
  return {
    userId,
    episodic: createBuffer(),
    schemas: createSchemaStore(userId),
    rifGuard: { recentWinners: [], cooldownRemaining: 0 },
  };
}

export function processMessage(
  state: MemoryV1State,
  input: ProcessMessageInput,
): ProcessMessageOutput {
  const encoded = encodeEvent(input.encoderInput);

  const salienceInput: SalienceInput = {
    eivValue: safeNumber(input.encoderInput.eivValue, 0),
    avi: safeNumber(input.encoderInput.avi, 0),
    escalationScore: input.encoderInput.escalationScore,
    appraisalBridgeEnabled: input.encoderInput.appraisalBridgeEnabled ?? false,
    hasViolation: false,
    collapseEvent: false,
  };
  const salience = computeSalience(salienceInput);

  let nextEpisodic = state.episodic;
  if (salience.shouldWrite) {
    const { nextState } = pushEvent(
      state.episodic,
      {
        id: input.eventId,
        emotionVec: encoded.emotionVec,
        salience: salience.salience,
        timestampMs: input.timestampMs,
      },
      input.timestampMs,
    );
    nextEpisodic = nextState;
  }

  const rifState: RIFState = {
    alpha: input.rifAlpha ?? DEFAULT_RIF_ALPHA,
    beta: input.rifBeta ?? DEFAULT_RIF_BETA,
  };
  const {
    result: retrievalResult,
    updatedSchemas,
    updatedGuard,
  } = retrieveSchemas(
    encoded.emotionVec,
    state.schemas.schemas,
    rifState,
    state.rifGuard,
  );

  const contextInput = prepareContextInput(
    encoded.emotionVec,
    state.schemas.schemas,
    retrievalResult,
  );
  if (contextInput && input.policy) {
    contextInput.policy = input.policy;
  }
  const memoryContext = contextInput ? buildMemoryContext(contextInput) : null;

  return {
    nextState: {
      userId: state.userId,
      episodic: nextEpisodic,
      schemas: { ...state.schemas, schemas: updatedSchemas },
      rifGuard: updatedGuard,
    },
    memoryContext,
    retrievalResult,
    salience,
  };
}

export function endSession(
  state: MemoryV1State,
  nowMs: number,
): EndSessionOutput {
  const episodes: ConsolidationEpisode[] = state.episodic.events.map((e) => ({
    id: e.id,
    emotionVec: e.emotionVec.slice(),
    salience: e.salience,
  }));

  const schemas: CSchema[] = state.schemas.schemas.map((s) => ({
    ...s,
    centroid: s.centroid.slice(),
    sessionCount: (s as Record<string, unknown>).sessionCount as number ?? 0,
  }));

  const consolidationResult = consolidate({
    nowMs,
    episodes,
    schemas,
    mode: 'baseline',
  });

  return {
    nextState: {
      userId: state.userId,
      episodic: createBuffer(),
      schemas: {
        ...state.schemas,
        schemas: consolidationResult.updatedSchemas as SchemaRecord[],
      },
      rifGuard: state.rifGuard,
    },
    consolidationResult,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function prepareContextInput(
  queryVec: number[],
  schemas: SchemaRecord[],
  retrieval: RetrievalResult,
): BuildMemoryContextInput | null {
  if (retrieval.noMatch || retrieval.topSchemaIds.length === 0) return null;

  const schemaMap = new Map(schemas.map((s) => [s.schemaId, s]));
  const n = retrieval.topSchemaIds.length;
  const nonWinnerProb = n > 1 ? (1 - retrieval.confidence) / (n - 1) : 0;

  const results = retrieval.topSchemaIds.map((id) => {
    const schema = schemaMap.get(id);
    return {
      schemaId: id,
      prob: id === retrieval.winnerId ? retrieval.confidence : nonWinnerProb,
      sim: schema ? cosineSim(queryVec, schema.centroid) : 0,
    };
  });

  const schemasById: Record<string, { schemaId: string }> = {};
  for (const id of retrieval.topSchemaIds) {
    schemasById[id] = { schemaId: id };
  }

  return {
    results,
    schemasById,
    thetaRetrieve: CONTEXT_THETA,
    cMin: CONTEXT_C_MIN,
  };
}

function cosineSim(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let nA = 0;
  let nB = 0;
  for (let i = 0; i < len; i++) {
    const va = safeNumber(a[i], 0);
    const vb = safeNumber(b[i], 0);
    dot += va * vb;
    nA += va * va;
    nB += vb * vb;
  }
  const denom = Math.sqrt(nA) * Math.sqrt(nB);
  return denom < 1e-12 ? 0 : clamp(safeNumber(dot / denom, 0), -1, 1);
}
