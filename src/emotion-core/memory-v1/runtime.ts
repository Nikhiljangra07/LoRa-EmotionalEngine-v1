import type { RuntimeScenario, RuntimeRunResult } from './runtimeTypes';
import type { MemoryV1State } from './memoryV1EngineTypes';
import type { MemoryContext } from './memoryContextTypes';
import type { SchemaRecord } from './schemaStore';
import type { RetrievalResult } from './retrievalEngine';
import type { StoredMemoryV1State } from './storageTypes';
import {
  type MemoryLogEvent,
  makeMemoryEncodeLog,
  makeMemoryRetrieveLog,
  makeMemoryConsolidateLog,
} from './decisionLogs';
import { createMemoryV1, processMessage, endSession } from './memoryV1Engine';
import { createJSONStorage } from './storage';
import { encodeEvent } from './eventEncoder';
import { createBuffer } from './episodicBuffer';
import { safeNumber, clamp, cosineSimilarity } from './normalize';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function runScenario(
  scenario: RuntimeScenario,
  opts?: { baseDir?: string; decisionLogEnabled?: boolean },
): RuntimeRunResult {
  const baseDir = opts?.baseDir ?? '.lora/memory-v1';
  const logEnabled = opts?.decisionLogEnabled !== false;

  const storage = createJSONStorage(baseDir);
  const logs: MemoryLogEvent[] = [];
  const memoryContexts: Array<{ messageId: string; ctx: MemoryContext | null }> = [];

  const stored = storage.load(scenario.userId);
  let state: MemoryV1State = stored
    ? hydrateState(stored)
    : createMemoryV1(scenario.userId);

  for (const msg of scenario.messages) {
    const encoded = encodeEvent(msg.input.encoderInput);
    const schemasSnapshot = state.schemas.schemas;

    const result = processMessage(state, msg.input);

    if (logEnabled) {
      logs.push(makeMemoryEncodeLog({
        userId: scenario.userId,
        sessionId: scenario.sessionId,
        messageId: msg.messageId,
        tsMs: msg.tsMs,
        eventId: msg.input.eventId,
        salience: result.salience.salience,
        mode: encoded.mode,
        matchedSchemaId: result.retrievalResult.winnerId ?? null,
        topDims: encoded.dimSummary.topDims,
      }));

      logs.push(makeMemoryRetrieveLog({
        userId: scenario.userId,
        sessionId: scenario.sessionId,
        messageId: msg.messageId,
        tsMs: msg.tsMs,
        topK: buildTopK(encoded.emotionVec, schemasSnapshot, result.retrievalResult),
        confidenceLevel: result.memoryContext?.confidenceLevel ?? 'LOW',
        noMatch: result.retrievalResult.noMatch,
        winnerId: result.retrievalResult.winnerId ?? null,
      }));
    }

    memoryContexts.push({ messageId: msg.messageId, ctx: result.memoryContext });
    state = result.nextState;
  }

  const episodeCountBefore = state.episodic.events.length;
  const endResult = endSession(state, scenario.endSessionAtMs);
  state = endResult.nextState;

  if (logEnabled) {
    logs.push(makeMemoryConsolidateLog({
      userId: scenario.userId,
      sessionId: scenario.sessionId,
      tsMs: scenario.endSessionAtMs,
      createdCount: endResult.consolidationResult.createdSchemaIds.length,
      mergedCount: endResult.consolidationResult.mergedPairs.length,
      prunedCount: endResult.consolidationResult.prunedSchemaIds.length,
      episodesEvicted: episodeCountBefore - endResult.consolidationResult.episodeAssignments.length,
      totalSchemas: state.schemas.schemas.length,
      totalEpisodes: endResult.consolidationResult.episodeAssignments.length,
      noveltyFlag: endResult.consolidationResult.noveltyFlag,
    }));
  }

  const storedState: StoredMemoryV1State = {
    version: 1,
    userId: scenario.userId,
    savedAtMs: scenario.endSessionAtMs,
    schemas: state.schemas.schemas,
    episodic: [],
    rifGuard: state.rifGuard,
  };
  storage.save(storedState);

  const reloaded = storage.load(scenario.userId);
  if (reloaded) {
    if (reloaded.schemas.length !== storedState.schemas.length) {
      throw new Error('Continuity check failed: schema count mismatch');
    }
    for (const s of reloaded.schemas) {
      if (s.centroid.length !== 21) {
        throw new Error(`Continuity check failed: centroid length ${s.centroid.length} !== 21`);
      }
    }
  }

  return {
    finalState: state,
    savedPath: storage.getPath(scenario.userId),
    logs,
    memoryContexts,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function hydrateState(stored: StoredMemoryV1State): MemoryV1State {
  return {
    userId: stored.userId,
    episodic: createBuffer(),
    schemas: {
      userId: stored.userId,
      schemas: stored.schemas,
      maxSchemas: 20,
    },
    rifGuard: stored.rifGuard,
  };
}

function buildTopK(
  queryVec: number[],
  schemas: SchemaRecord[],
  retrieval: RetrievalResult,
): Array<{ schemaId: string; sim: number; p: number }> {
  if (retrieval.noMatch || retrieval.topSchemaIds.length === 0) return [];

  const schemaMap = new Map(schemas.map((s) => [s.schemaId, s]));
  const n = retrieval.topSchemaIds.length;
  const nonWinnerProb = n > 1 ? (1 - retrieval.confidence) / (n - 1) : 0;

  return retrieval.topSchemaIds.slice(0, 3).map((id) => {
    const schema = schemaMap.get(id);
    return {
      schemaId: id,
      sim: schema ? cosineSimilarity(queryVec, schema.centroid) : 0,
      p: id === retrieval.winnerId ? retrieval.confidence : nonWinnerProb,
    };
  });
}

