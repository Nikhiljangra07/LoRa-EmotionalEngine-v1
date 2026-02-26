import { bucketConfidence } from '../debugBuckets';
import { buildMemoryV1DebugSnapshot, type DebugSnapshotInput } from '../debugSnapshot';

describe('bucketConfidence', () => {
  it('returns null for undefined', () => {
    expect(bucketConfidence(undefined)).toBe(null);
  });

  it('returns null for null', () => {
    expect(bucketConfidence(null)).toBe(null);
  });

  it('returns null for NaN', () => {
    expect(bucketConfidence(NaN)).toBe(null);
  });

  it('returns LOW below 0.40', () => {
    expect(bucketConfidence(0)).toBe('LOW');
    expect(bucketConfidence(0.39)).toBe('LOW');
    expect(bucketConfidence(0.399)).toBe('LOW');
  });

  it('returns MED at exactly 0.40', () => {
    expect(bucketConfidence(0.40)).toBe('MED');
  });

  it('returns MED between 0.40 and 0.70', () => {
    expect(bucketConfidence(0.55)).toBe('MED');
  });

  it('returns MED at exactly 0.70', () => {
    expect(bucketConfidence(0.70)).toBe('MED');
  });

  it('returns HIGH above 0.70', () => {
    expect(bucketConfidence(0.71)).toBe('HIGH');
    expect(bucketConfidence(1.0)).toBe('HIGH');
  });
});

function baseInput(overrides?: Partial<DebugSnapshotInput>): DebugSnapshotInput {
  return {
    userId: 'u1',
    sessionId: 'sess-1',
    messageId: 'msg-1',
    encoderMode: 'baseline',
    wroteEpisode: true,
    noMatch: false,
    topSchemaIds: ['s1', 's2'],
    winnerSchemaId: 's1',
    memoryContext: {
      sessionPattern: 'calm-stable',
      confidenceLevel: 'MED',
    },
    etvPolicy: { band: 'BAND_2' },
    ...overrides,
  };
}

describe('buildMemoryV1DebugSnapshot', () => {
  it('produces a snapshot with correct tag', () => {
    const snap = buildMemoryV1DebugSnapshot(baseInput());
    expect(snap.tag).toBe('memory:v1:debug');
  });

  it('snapshot JSON contains no numeric-looking strings (except IDs)', () => {
    const snap = buildMemoryV1DebugSnapshot(baseInput());
    const json = JSON.stringify(snap);
    const idSafeJson = json
      .replace(/"userId":"[^"]*"/g, '')
      .replace(/"sessionId":"[^"]*"/g, '')
      .replace(/"messageId":"[^"]*"/g, '')
      .replace(/"winnerSchemaId":"[^"]*"/g, '')
      .replace(/"topSchemaIds":\[("[^"]*",?)*\]/g, '');
    expect(idSafeJson).not.toMatch(/\d+\.\d+/);
  });

  it('caps topSchemaIds to 3', () => {
    const snap = buildMemoryV1DebugSnapshot(
      baseInput({ topSchemaIds: ['a', 'b', 'c', 'd', 'e'] }),
    );
    expect(snap.topSchemaIds.length).toBeLessThanOrEqual(3);
  });

  it('winnerSchemaId is null when noMatch', () => {
    const snap = buildMemoryV1DebugSnapshot(
      baseInput({ noMatch: true, winnerSchemaId: 's1' }),
    );
    expect(snap.winnerSchemaId).toBeNull();
  });

  it('preserves winnerSchemaId in topSchemaIds even when not in original list', () => {
    const snap = buildMemoryV1DebugSnapshot(
      baseInput({
        topSchemaIds: ['a', 'b', 'c'],
        winnerSchemaId: 'z',
        noMatch: false,
      }),
    );
    expect(snap.winnerSchemaId).toBe('z');
    expect(snap.topSchemaIds).toContain('z');
    expect(snap.topSchemaIds.length).toBeLessThanOrEqual(3);
  });

  it('maps BAND_0..BAND_4 to B0..B4', () => {
    for (let i = 0; i <= 4; i++) {
      const snap = buildMemoryV1DebugSnapshot(
        baseInput({ etvPolicy: { band: `BAND_${i}` } }),
      );
      expect(snap.bandHint).toBe(`B${i}`);
    }
  });

  it('bandHint null when etvPolicy missing', () => {
    const snap = buildMemoryV1DebugSnapshot(
      baseInput({ etvPolicy: null }),
    );
    expect(snap.bandHint).toBeNull();
  });

  it('confidenceLevel from memoryContext categorical label', () => {
    for (const lvl of ['LOW', 'MED', 'HIGH'] as const) {
      const snap = buildMemoryV1DebugSnapshot(
        baseInput({ memoryContext: { sessionPattern: 'volatile', confidenceLevel: lvl } }),
      );
      expect(snap.confidenceLevel).toBe(lvl);
    }
  });

  it('confidenceLevel null when memoryContext missing', () => {
    const snap = buildMemoryV1DebugSnapshot(
      baseInput({ memoryContext: null }),
    );
    expect(snap.confidenceLevel).toBeNull();
  });

  it('sessionPattern null when memoryContext missing', () => {
    const snap = buildMemoryV1DebugSnapshot(
      baseInput({ memoryContext: null }),
    );
    expect(snap.sessionPattern).toBeNull();
  });

  it('mode reflects encoder input', () => {
    expect(buildMemoryV1DebugSnapshot(baseInput({ encoderMode: 'baseline' })).mode).toBe('baseline');
    expect(buildMemoryV1DebugSnapshot(baseInput({ encoderMode: 'enhanced' })).mode).toBe('enhanced');
  });
});
