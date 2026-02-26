import { generateStressSessions } from '../stressScenarios';
import { runStress } from '../stressRunner';
import { computeVerdict } from '../stressAnalyzer';
import type { StressRunResult } from '../stressTypes';

const SEED = 42;
const USER_ID = 'test-stress-user';

let result: StressRunResult;

beforeAll(() => {
  const sessions = generateStressSessions(SEED);
  result = runStress(USER_ID, sessions);
});

// ---------------------------------------------------------------------------
// 1. Determinism
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('same seed produces identical result', () => {
    const sessions2 = generateStressSessions(SEED);
    const result2 = runStress(USER_ID, sessions2);

    expect(result2.totalMessages).toBe(result.totalMessages);
    expect(result2.totalSessions).toBe(result.totalSessions);
    expect(result2.maxSchemasObserved).toBe(result.maxSchemasObserved);
    expect(result2.totalInjections).toBe(result.totalInjections);
    expect(result2.totalOscillations).toBe(result.totalOscillations);
    expect(result2.schemaGrowthOverTime).toEqual(result.schemaGrowthOverTime);
  });

  it('different seed produces different scenario inputs in regime D', () => {
    const sessions1 = generateStressSessions(SEED);
    const sessions2 = generateStressSessions(99);
    // Regime D sessions (index 15-19) use the seed for message generation
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
    expect(result.maxSchemasObserved).toBeLessThanOrEqual(20);
  });

  it('per-session schema counts never exceed 20', () => {
    for (const s of result.sessionResults) {
      expect(s.schemasCount).toBeLessThanOrEqual(20);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. No NaN
// ---------------------------------------------------------------------------

describe('no NaN in metrics', () => {
  it('top-level metrics are finite', () => {
    expect(Number.isFinite(result.totalMessages)).toBe(true);
    expect(Number.isFinite(result.totalSessions)).toBe(true);
    expect(Number.isFinite(result.maxSchemasObserved)).toBe(true);
    expect(Number.isFinite(result.totalInjections)).toBe(true);
    expect(Number.isFinite(result.totalOscillations)).toBe(true);
  });

  it('all session results have finite values', () => {
    for (const s of result.sessionResults) {
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
    for (const v of result.schemaGrowthOverTime) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Schema growth bounded
// ---------------------------------------------------------------------------

describe('schema growth', () => {
  it('growth array has one entry per session', () => {
    expect(result.schemaGrowthOverTime.length).toBe(result.totalSessions);
  });

  it('all values are non-negative integers', () => {
    for (const v of result.schemaGrowthOverTime) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('bounded by MAX_SCHEMAS=20', () => {
    for (const v of result.schemaGrowthOverTime) {
      expect(v).toBeLessThanOrEqual(20);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Injection count within bounds
// ---------------------------------------------------------------------------

describe('injection bounds', () => {
  it('total injections >= 0 and <= totalMessages', () => {
    expect(result.totalInjections).toBeGreaterThanOrEqual(0);
    expect(result.totalInjections).toBeLessThanOrEqual(result.totalMessages);
  });

  it('per-session injected <= messageCount', () => {
    for (const s of result.sessionResults) {
      expect(s.injectedCount).toBeLessThanOrEqual(s.messageCount);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Oscillation metric computed
// ---------------------------------------------------------------------------

describe('oscillation tracking', () => {
  it('totalOscillations is non-negative', () => {
    expect(result.totalOscillations).toBeGreaterThanOrEqual(0);
  });

  it('per-session oscillation >= 0', () => {
    for (const s of result.sessionResults) {
      expect(s.oscillationCount).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Verdict classification
// ---------------------------------------------------------------------------

describe('verdict classification', () => {
  it('computes a valid verdict for the stress run', () => {
    const v = computeVerdict(result);
    expect(['STABLE', 'MILD_DRIFT', 'HIGH_DRIFT']).toContain(v);
  });

  it('HIGH_DRIFT when injection rate > 0.85', () => {
    const fake: StressRunResult = {
      totalMessages: 100,
      totalSessions: 1,
      maxSchemasObserved: 5,
      totalInjections: 90,
      totalOscillations: 0,
      schemaGrowthOverTime: [5],
      sessionResults: [],
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
    };
    expect(computeVerdict(fake)).toBe('HIGH_DRIFT');
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
      })),
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
      })),
    };
    expect(computeVerdict(fake)).toBe('STABLE');
  });
});

// ---------------------------------------------------------------------------
// 8. Total message count
// ---------------------------------------------------------------------------

describe('session structure', () => {
  it('20 sessions × 50 messages = 1000 total', () => {
    expect(result.totalSessions).toBe(20);
    expect(result.totalMessages).toBe(1000);
  });

  it('20 session results', () => {
    expect(result.sessionResults.length).toBe(20);
  });

  it('each session has 50 messages', () => {
    for (const s of result.sessionResults) {
      expect(s.messageCount).toBe(50);
    }
  });
});
