import {
  makeMemoryEncodeLog,
  makeMemoryRetrieveLog,
  makeMemoryConsolidateLog,
} from '../decisionLogs';

// ---------------------------------------------------------------------------
// 1–2. Rounding behavior
// ---------------------------------------------------------------------------

describe('decisionLogs – rounding', () => {
  it('rounds salience to 3 decimals in encode log', () => {
    const log = makeMemoryEncodeLog({
      userId: 'u1',
      tsMs: 1000,
      eventId: 'e1',
      salience: 1 / 3,
      mode: 'baseline',
      matchedSchemaId: 's1',
      topDims: [{ dim: 0, name: 'eiv', value: Math.PI }],
    });
    expect(log.payload.salience).toBe(0.333);
    expect((log.payload.topDims as Array<{ value: number }>)[0].value).toBe(3.142);
  });

  it('rounds sim and p in retrieve log', () => {
    const log = makeMemoryRetrieveLog({
      userId: 'u1',
      tsMs: 1000,
      topK: [{ schemaId: 's1', sim: 0.12345, p: 0.67891 }],
      confidenceLevel: 'HIGH',
      noMatch: false,
      winnerId: 's1',
    });
    const topK = log.payload.topK as Array<{ sim: number; p: number }>;
    expect(topK[0].sim).toBe(0.123);
    expect(topK[0].p).toBe(0.679);
  });

  it('rounds numeric fields in consolidate log', () => {
    const log = makeMemoryConsolidateLog({
      userId: 'u1',
      tsMs: 1000,
      createdCount: 3,
      mergedCount: 1,
      prunedCount: 0,
      episodesEvicted: 2,
      totalSchemas: 5,
      totalEpisodes: 10,
      noveltyFlag: true,
    });
    expect(log.payload.createdCount).toBe(3);
    expect(log.payload.mergedCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3–5. Required fields present
// ---------------------------------------------------------------------------

describe('decisionLogs – required fields', () => {
  it('encode log has all required fields', () => {
    const log = makeMemoryEncodeLog({
      userId: 'u1',
      tsMs: 5000,
      eventId: 'e1',
      salience: 0.5,
      mode: 'baseline',
      matchedSchemaId: 's1',
      topDims: [],
    });
    expect(log.tag).toBe('memory:encode');
    expect(log.payload.userId).toBe('u1');
    expect(log.payload.tsMs).toBe(5000);
    expect(log.payload.eventId).toBe('e1');
    expect(log.payload.salience).toBe(0.5);
    expect(log.payload.mode).toBe('baseline');
    expect(log.payload.matchedSchemaId).toBe('s1');
    expect(log.payload.topDims).toEqual([]);
  });

  it('retrieve log has all required fields', () => {
    const log = makeMemoryRetrieveLog({
      userId: 'u1',
      tsMs: 5000,
      topK: [],
      confidenceLevel: 'LOW',
      noMatch: true,
      winnerId: null,
    });
    expect(log.tag).toBe('memory:retrieve');
    expect(log.payload.userId).toBe('u1');
    expect(log.payload.tsMs).toBe(5000);
    expect(log.payload.topK).toEqual([]);
    expect(log.payload.confidenceLevel).toBe('LOW');
    expect(log.payload.noMatch).toBe(true);
    expect(log.payload.winnerId).toBeNull();
  });

  it('consolidate log has all required fields', () => {
    const log = makeMemoryConsolidateLog({
      userId: 'u1',
      tsMs: 5000,
      createdCount: 2,
      mergedCount: 1,
      prunedCount: 0,
      episodesEvicted: 3,
      totalSchemas: 8,
      totalEpisodes: 15,
      noveltyFlag: true,
    });
    expect(log.tag).toBe('memory:consolidate');
    expect(log.payload.userId).toBe('u1');
    expect(log.payload.createdCount).toBe(2);
    expect(log.payload.mergedCount).toBe(1);
    expect(log.payload.prunedCount).toBe(0);
    expect(log.payload.episodesEvicted).toBe(3);
    expect(log.payload.totalSchemas).toBe(8);
    expect(log.payload.totalEpisodes).toBe(15);
    expect(log.payload.noveltyFlag).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. No floats beyond 3 decimals in JSON
// ---------------------------------------------------------------------------

describe('decisionLogs – JSON precision', () => {
  it('no numeric values exceed 3 decimal places in serialized encode log', () => {
    const log = makeMemoryEncodeLog({
      userId: 'u1',
      tsMs: 1000,
      eventId: 'e1',
      salience: Math.PI,
      mode: 'enhanced',
      matchedSchemaId: null,
      topDims: [
        { dim: 0, name: 'eiv', value: 1 / 7 },
        { dim: 1, name: 'val', value: Math.E },
      ],
    });
    const json = JSON.stringify(log);
    const floats = json.match(/\d+\.\d{4,}/g);
    expect(floats).toBeNull();
  });

  it('no numeric values exceed 3 decimal places in serialized retrieve log', () => {
    const log = makeMemoryRetrieveLog({
      userId: 'u1',
      tsMs: 1000,
      topK: [
        { schemaId: 's1', sim: 1 / 3, p: 1 / 7 },
        { schemaId: 's2', sim: 2 / 3, p: 6 / 7 },
      ],
      confidenceLevel: 'MED',
      noMatch: false,
      winnerId: 's2',
    });
    const json = JSON.stringify(log);
    const floats = json.match(/\d+\.\d{4,}/g);
    expect(floats).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7. noMatch formatting
// ---------------------------------------------------------------------------

describe('decisionLogs – noMatch formatting', () => {
  it('noMatch=true with winnerId=null serializes correctly', () => {
    const log = makeMemoryRetrieveLog({
      userId: 'u1',
      tsMs: 1000,
      topK: [],
      confidenceLevel: 'LOW',
      noMatch: true,
      winnerId: null,
    });
    expect(log.payload.noMatch).toBe(true);
    expect(log.payload.winnerId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 8. matchedSchemaId null → "new"
// ---------------------------------------------------------------------------

describe('decisionLogs – matchedSchemaId default', () => {
  it('null matchedSchemaId becomes "new"', () => {
    const log = makeMemoryEncodeLog({
      userId: 'u1',
      tsMs: 1000,
      eventId: 'e1',
      salience: 0.5,
      mode: 'baseline',
      matchedSchemaId: null,
      topDims: [],
    });
    expect(log.payload.matchedSchemaId).toBe('new');
  });
});

// ---------------------------------------------------------------------------
// 9. Determinism
// ---------------------------------------------------------------------------

describe('decisionLogs – determinism', () => {
  it('identical inputs produce identical outputs', () => {
    const params = {
      userId: 'u1',
      sessionId: 'sess1',
      tsMs: 5000,
      eventId: 'e1',
      salience: 0.456789,
      mode: 'baseline',
      matchedSchemaId: 's1' as string | null,
      topDims: [{ dim: 0, name: 'eiv', value: 0.123456 }],
    };
    const a = makeMemoryEncodeLog(params);
    const b = makeMemoryEncodeLog(params);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ---------------------------------------------------------------------------
// 10. Optional fields default to null
// ---------------------------------------------------------------------------

describe('decisionLogs – optional field defaults', () => {
  it('sessionId defaults to null when omitted', () => {
    const log = makeMemoryEncodeLog({
      userId: 'u1',
      tsMs: 1000,
      eventId: 'e1',
      salience: 0.5,
      mode: 'baseline',
      matchedSchemaId: 's1',
      topDims: [],
    });
    expect(log.payload.sessionId).toBeNull();
  });

  it('messageId defaults to null when omitted', () => {
    const log = makeMemoryRetrieveLog({
      userId: 'u1',
      tsMs: 1000,
      topK: [],
      confidenceLevel: 'LOW',
      noMatch: true,
      winnerId: null,
    });
    expect(log.payload.messageId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 11. NaN/Infinity rounding safety
// ---------------------------------------------------------------------------

describe('decisionLogs – NaN/Infinity in numbers', () => {
  it('NaN salience rounds to 0', () => {
    const log = makeMemoryEncodeLog({
      userId: 'u1',
      tsMs: 1000,
      eventId: 'e1',
      salience: NaN,
      mode: 'baseline',
      matchedSchemaId: null,
      topDims: [{ dim: 0, name: 'eiv', value: Infinity }],
    });
    expect(log.payload.salience).toBe(0);
    expect((log.payload.topDims as Array<{ value: number }>)[0].value).toBe(0);
  });
});
