import type { StressSession, StressSessionResult, StressRunResult } from './stressTypes';
import type { MemoryV1State, ProcessMessageInput } from '../memoryV1EngineTypes';
import {
  createMemoryV1,
  processMessage,
  endSession,
} from '../memoryV1Engine';

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export function runStress(
  userId: string,
  sessions: StressSession[],
): StressRunResult {
  let state: MemoryV1State = createMemoryV1(userId);
  let maxSchemasObserved = 0;
  let totalInjections = 0;
  let totalOscillations = 0;
  const schemaGrowthOverTime: number[] = [];
  const sessionResults: StressSessionResult[] = [];
  let tsMs = 1_000_000;

  for (const session of sessions) {
    let injectedCount = 0;
    let oscCount = 0;
    let lastWinnerId: string | undefined | null = null;
    let flipCount = 0;

    for (let m = 0; m < session.messages.length; m++) {
      const msg = session.messages[m];
      const input: ProcessMessageInput = {
        encoderInput: msg.encoderInput,
        eventId: `s${session.sessionIndex}-m${m}`,
        timestampMs: tsMs,
      };
      tsMs += 1000;

      const out = processMessage(state, input);
      state = out.nextState;

      if (out.memoryContext !== null) {
        injectedCount++;
      }

      const currentWinner = out.retrievalResult.winnerId ?? null;
      if (m > 0 && currentWinner !== lastWinnerId) {
        flipCount++;
      }
      lastWinnerId = currentWinner;

      const schemaCount = state.schemas.schemas.length;
      if (schemaCount > maxSchemasObserved) {
        maxSchemasObserved = schemaCount;
      }
    }

    if (flipCount > 5) {
      oscCount = flipCount;
    }

    const endOut = endSession(state, tsMs);
    state = endOut.nextState;
    tsMs += 60_000;

    const cr = endOut.consolidationResult;
    const schemasCount = state.schemas.schemas.length;
    schemaGrowthOverTime.push(schemasCount);
    if (schemasCount > maxSchemasObserved) {
      maxSchemasObserved = schemasCount;
    }

    const result: StressSessionResult = {
      sessionIndex: session.sessionIndex,
      messageCount: session.messages.length,
      schemasCount,
      injectedCount,
      oscillationCount: oscCount,
      createdSchemas: cr.createdSchemaIds.length,
      mergedSchemas: cr.mergedPairs.length,
      prunedSchemas: cr.prunedSchemaIds.length,
    };

    sessionResults.push(result);
    totalInjections += injectedCount;
    totalOscillations += oscCount;
  }

  const totalMessages = sessions.reduce((sum, s) => sum + s.messages.length, 0);

  return {
    totalMessages,
    totalSessions: sessions.length,
    maxSchemasObserved,
    totalInjections,
    totalOscillations,
    schemaGrowthOverTime,
    sessionResults,
  };
}
