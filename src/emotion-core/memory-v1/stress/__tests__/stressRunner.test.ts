import { generateStressSessions, defaultBandSchedule } from '../stressScenarios';
import { runStress } from '../stressRunner';
import { computeVerdict } from '../stressAnalyzer';
import type { StressRunResult } from '../stressTypes';

const SEED = 42;
const USER_ID = 'test-stress-user';

// ---------------------------------------------------------------------------
// Ungoverned baseline (cached across ungoverned tests)
// ---------------------------------------------------------------------------

let ungovernedResult: StressRunResult;

beforeAll(() => {
  const sessions = generateStressSessions(SEED);
  ungovernedResult = runStress(USER_ID, sessions);
});

// ---------------------------------------------------------------------------
// 1. Determinism
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('same seed produces identical result (ungoverned)', () => {
    const sessions2 = generateStressSessions(SEED);
    const result2 = runStress(USER_ID, sessions2);

    expect(result2.totalMessages).toBe(ungovernedResult.totalMessages);
    expect(result2.totalSessions).toBe(ungovernedResult.totalSessions);
    expect(result2.maxSchemasObserved).toBe(ungovernedResult.maxSchemasObserved);
    expect(result2.totalInjections).toBe(ungovernedResult.totalInjections);
    expect(result2.totalOscillations).toBe(ungovernedResult.totalOscillations);
    expect(result2.schemaGrowthOverTime).toEqual(ungovernedResult.schemaGrowthOverTime);
  });

  it('different seed produces different scenario inputs in regime D', () => {
    const sessions1 = generateStressSessions(SEED);
    const sessions2 = generateStressSessions(99);
    const d1msgs = sessions1[15].messages.map((m) => m.encoderInput.eivValue);
    const d2msgs = sessions2[15].messages.map((m) => m.encoderInput.eivValue);
    const identical = d1msgs.every((v, i) => v === d2msgs[i]);
    expect(identical).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Schema cap
// ---------------------------------------------------------------------------

describe('schema bounds', () => {
  it('max schemas never exceeds 20', () => {
    expect(ungovernedResult.maxSchemasObserved).toBeLessThanOrEqual(20);
  });

  it('per-session schema counts never exceed 20', () => {
    for (const s of ungovernedResult.sessionResults) {
      expect(s.schemasCount).toBeLessThanOrEqual(20);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. No NaN
// ---------------------------------------------------------------------------

describe('no NaN in metrics', () => {
  it('top-level metrics are finite', () => {
    expect(Number.isFinite(ungovernedResult.totalMessages)).toBe(true);
    expect(Number.isFinite(ungovernedResult.totalSessions)).toBe(true);
    expect(Number.isFinite(ungovernedResult.maxSchemasObserved)).toBe(true);
    expect(Number.isFinite(ungovernedResult.totalInjections)).toBe(true);
    expect(Number.isFinite(ungovernedResult.totalOscillations)).toBe(true);
    expect(Number.isFinite(ungovernedResult.messagesPolicyAllowsInjection)).toBe(true);
  });

  it('all session results have finite values', () => {
    for (const s of ungovernedResult.sessionResults) {
      expect(Number.isFinite(s.messageCount)).toBe(true);
      expect(Number.isFinite(s.schemasCount)).toBe(true);
      expect(Number.isFinite(s.injectedCount)).toBe(true);
      expect(Number.isFinite(s.oscillationCount)).toBe(true);
      expect(Number.isFinite(s.createdSchemas)).toBe(true);
      expect(Number.isFinite(s.mergedSchemas)).toBe(true);
      expect(Number.isFinite(s.prunedSchemas)).toBe(true);
    }
  });

  it('schema growth array has no NaN', () => {
    for (const v of ungovernedResult.schemaGrowthOverTime) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Schema growth bounded
// ---------------------------------------------------------------------------

describe('schema growth', () => {
  it('growth array has one entry per session', () => {
    expect(ungovernedResult.schemaGrowthOverTime.length).toBe(ungovernedResult.totalSessions);
  });

  it('all values are non-negative integers', () => {
    for (const v of ungovernedResult.schemaGrowthOverTime) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('bounded by MAX_SCHEMAS=20', () => {
    for (const v of ungovernedResult.schemaGrowthOverTime) {
      expect(v).toBeLessThanOrEqual(20);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Injection count within bounds
// ---------------------------------------------------------------------------

describe('injection bounds', () => {
  it('total injections >= 0 and <= totalMessages', () => {
    expect(ungovernedResult.totalInjections).toBeGreaterThanOrEqual(0);
    expect(ungovernedResult.totalInjections).toBeLessThanOrEqual(ungovernedResult.totalMessages);
  });

  it('per-session injected <= messageCount', () => {
    for (const s of ungovernedResult.sessionResults) {
      expect(s.injectedCount).toBeLessThanOrEqual(s.messageCount);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Oscillation metric computed
// ---------------------------------------------------------------------------

describe('oscillation tracking', () => {
  it('totalOscillations is non-negative', () => {
    expect(ungovernedResult.totalOscillations).toBeGreaterThanOrEqual(0);
  });

  it('per-session oscillation >= 0', () => {
    for (const s of ungovernedResult.sessionResults) {
      expect(s.oscillationCount).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Verdict classification
// ---------------------------------------------------------------------------

describe('verdict classification', () => {
  it('computes a valid verdict for the stress run', () => {
    const v = computeVerdict(ungovernedResult);
    expect(['STABLE', 'MILD_DRIFT', 'HIGH_DRIFT']).toContain(v);
  });

  it('HIGH_DRIFT when raw injection rate > 0.85', () => {
    const fake: StressRunResult = {
      totalMessages: 100,
      totalSessions: 1,
      maxSchemasObserved: 5,
      totalInjections: 90,
      totalOscillations: 0,
      schemaGrowthOverTime: [5],
      sessionResults: [],
      messagesPolicyAllowsInjection: 100,
    };
    expect(computeVerdict(fake)).toBe('HIGH_DRIFT');
  });

  it('HIGH_DRIFT when maxSchemas > 20', () => {
    const fake: StressRunResult = {
      totalMessages: 100,
      totalSessions: 1,
      maxSchemasObserved: 21,
      totalInjections: 10,
      totalOscillations: 0,
      schemaGrowthOverTime: [21],
      sessionResults: [],
      messagesPolicyAllowsInjection: 100,
    };
    expect(computeVerdict(fake)).toBe('HIGH_DRIFT');
  });

  it('MILD_DRIFT when governed injection rate > 85%', () => {
    const fake: StressRunResult = {
      totalMessages: 1000,
      totalSessions: 20,
      maxSchemasObserved: 8,
      totalInjections: 450,
      totalOscillations: 0,
      schemaGrowthOverTime: [],
      sessionResults: Array.from({ length: 20 }, (_, i) => ({
        sessionIndex: i,
        messageCount: 50,
        schemasCount: 8,
        injectedCount: 22,
        oscillationCount: 0,
        createdSchemas: 1,
        mergedSchemas: 0,
        prunedSchemas: 0,
        band: 'B4' as const,
        policySignature: '',
      })),
      messagesPolicyAllowsInjection: 500,
    };
    expect(computeVerdict(fake)).toBe('MILD_DRIFT');
  });

  it('MILD_DRIFT when >= 10 oscillation sessions', () => {
    const fake: StressRunResult = {
      totalMessages: 1000,
      totalSessions: 20,
      maxSchemasObserved: 10,
      totalInjections: 100,
      totalOscillations: 50,
      schemaGrowthOverTime: [],
      sessionResults: Array.from({ length: 20 }, (_, i) => ({
        sessionIndex: i,
        messageCount: 50,
        schemasCount: 10,
        injectedCount: 5,
        oscillationCount: i < 10 ? 6 : 0,
        createdSchemas: 1,
        mergedSchemas: 0,
        prunedSchemas: 0,
        band: 'B4' as const,
        policySignature: '',
      })),
      messagesPolicyAllowsInjection: 1000,
    };
    expect(computeVerdict(fake)).toBe('MILD_DRIFT');
  });

  it('STABLE when all metrics within bounds', () => {
    const fake: StressRunResult = {
      totalMessages: 1000,
      totalSessions: 20,
      maxSchemasObserved: 8,
      totalInjections: 100,
      totalOscillations: 0,
      schemaGrowthOverTime: [],
      sessionResults: Array.from({ length: 20 }, (_, i) => ({
        sessionIndex: i,
        messageCount: 50,
        schemasCount: 8,
        injectedCount: 5,
        oscillationCount: 0,
        createdSchemas: 1,
        mergedSchemas: 0,
        prunedSchemas: 0,
        band: 'B4' as const,
        policySignature: '',
      })),
      messagesPolicyAllowsInjection: 1000,
    };
    expect(computeVerdict(fake)).toBe('STABLE');
  });
});

// ---------------------------------------------------------------------------
// 8. Total message count
// ---------------------------------------------------------------------------

describe('session structure', () => {
  it('20 sessions × 50 messages = 1000 total', () => {
    expect(ungovernedResult.totalSessions).toBe(20);
    expect(ungovernedResult.totalMessages).toBe(1000);
  });

  it('20 session results', () => {
    expect(ungovernedResult.sessionResults.length).toBe(20);
  });

  it('each session has 50 messages', () => {
    for (const s of ungovernedResult.sessionResults) {
      expect(s.messageCount).toBe(50);
    }
  });
});

// ===========================================================================
// GOVERNED TESTS
// ===========================================================================

describe('governed stress run', () => {
  let governedResult: StressRunResult;

  beforeAll(() => {
    const sessions = generateStressSessions(SEED);
    const schedule = defaultBandSchedule();
    governedResult = runStress(USER_ID, sessions, schedule);
  });

  // 1. B1 blocks injection in first 3 sessions
  it('B1 sessions (0-2) have zero injections', () => {
    for (let i = 0; i <= 2; i++) {
      expect(governedResult.sessionResults[i].band).toBe('B1');
      expect(governedResult.sessionResults[i].injectedCount).toBe(0);
    }
  });

  // 2. rawInjectionRate strictly lower than ungoverned baseline
  it('rawInjectionRate < ungoverned baseline (must be strictly lower)', () => {
    const governedRate = governedResult.totalInjections / governedResult.totalMessages;
    const ungovernedRate = ungovernedResult.totalInjections / ungovernedResult.totalMessages;
    expect(governedRate).toBeLessThan(ungovernedRate);
  });

  // 3. Deterministic across same seed and schedule
  it('same seed + schedule produces identical governed result', () => {
    const sessions2 = generateStressSessions(SEED);
    const schedule2 = defaultBandSchedule();
    const result2 = runStress(USER_ID, sessions2, schedule2);

    expect(result2.totalInjections).toBe(governedResult.totalInjections);
    expect(result2.totalOscillations).toBe(governedResult.totalOscillations);
    expect(result2.maxSchemasObserved).toBe(governedResult.maxSchemasObserved);
    expect(result2.schemaGrowthOverTime).toEqual(governedResult.schemaGrowthOverTime);
    expect(result2.messagesPolicyAllowsInjection).toBe(governedResult.messagesPolicyAllowsInjection);
  });

  // 4. Band and policySignature populated on every session
  it('every session has band and policySignature', () => {
    for (const s of governedResult.sessionResults) {
      expect(s.band).toBeDefined();
      expect(typeof s.band).toBe('string');
      expect(s.policySignature).toBeDefined();
      expect(s.policySignature.length).toBeGreaterThan(0);
    }
  });

  // 5. messagesPolicyAllowsInjection < totalMessages (because B1 blocks)
  it('messagesPolicyAllowsInjection < totalMessages', () => {
    expect(governedResult.messagesPolicyAllowsInjection).toBeLessThan(governedResult.totalMessages);
  });

  // 6. Schema bounds still hold
  it('max schemas never exceeds 20 (governed)', () => {
    expect(governedResult.maxSchemasObserved).toBeLessThanOrEqual(20);
  });

  // 7. No NaN in governed results
  it('all governed metrics are finite', () => {
    expect(Number.isFinite(governedResult.totalInjections)).toBe(true);
    expect(Number.isFinite(governedResult.messagesPolicyAllowsInjection)).toBe(true);
    for (const s of governedResult.sessionResults) {
      expect(Number.isFinite(s.injectedCount)).toBe(true);
    }
  });

  // 8. Verdict is not HIGH_DRIFT under governance
  it('governed verdict is STABLE or MILD_DRIFT', () => {
    const v = computeVerdict(governedResult);
    expect(['STABLE', 'MILD_DRIFT']).toContain(v);
  });
});
