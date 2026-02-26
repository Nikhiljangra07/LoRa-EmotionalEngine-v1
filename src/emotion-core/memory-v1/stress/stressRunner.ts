import type {
  StressSession,
  StressSessionResult,
  StressRunResult,
  BandSchedule,
  BandHint,
} from './stressTypes';
import type { MemoryV1State, ProcessMessageInput } from '../memoryV1EngineTypes';
import type { MemoryV1Policy } from '../policyTypes';
import {
  createMemoryV1,
  processMessage,
  endSession,
} from '../memoryV1Engine';
import { getMemoryV1Policy } from '../policyMap';
import { computeMemoryV1PolicySignature } from '../policySignature';

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export function runStress(
  userId: string,
  sessions: StressSession[],
  bandSchedule?: BandSchedule,
): StressRunResult {
  const scheduleMap = new Map<number, BandHint>();
  if (bandSchedule) {
    for (const entry of bandSchedule) {
      scheduleMap.set(entry.sessionIndex, entry.band);
    }
  }

  let state: MemoryV1State = createMemoryV1(userId);
  let maxSchemasObserved = 0;
  let totalInjections = 0;
  let totalOscillations = 0;
  let messagesPolicyAllowsInjection = 0;
  const schemaGrowthOverTime: number[] = [];
  const sessionResults: StressSessionResult[] = [];
  let tsMs = 1_000_000;

  for (const session of sessions) {
    const band: BandHint = scheduleMap.get(session.sessionIndex) ?? 'B4';
    const policy: MemoryV1Policy = getMemoryV1Policy(band);
    const policySig = computeMemoryV1PolicySignature(policy);

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
        policy,
      };
      tsMs += 1000;

      const out = processMessage(state, input);
      state = out.nextState;

      if (policy.allowPromptInjection) {
        messagesPolicyAllowsInjection++;
      }

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
      band,
      policySignature: policySig,
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
    messagesPolicyAllowsInjection,
  };
}
