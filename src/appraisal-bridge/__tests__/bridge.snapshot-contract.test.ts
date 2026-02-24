import { mapLayerASnapshot } from '../mapLayerASnapshot';
import type { LayerASnapshot } from '../types';

describe('LayerASnapshot contract', () => {
  const args = {
    messageIndex: 7,
    timestampMs: 1_700_000_000,
    deltaMessageSeconds: 45,
    analyzerScalars: {
      valenceScore: -0.3,
      valenceConfidence: 0.8,
      arousalScore: 0.6,
      arousalConfidence: 0.75,
      expressionStrength: 0.5,
      esConfidence: 0.65,
    },
    eiv: { value: 0.42, tier: 'moderate' },
    emotionalState: {
      dominant: 'NEUTRAL' as const,
      arousal: 'MEDIUM' as const,
      valence: 'NEGATIVE' as const,
      confidence: 0.8,
    },
    patternSignals: {
      capsRatio: 0.12,
      punctuationHits: 3,
      emojiHits: 1,
      repetitionScore: 0.2,
      questionMarks: 2,
    },
  };

  let snapshot: LayerASnapshot;

  beforeAll(() => {
    snapshot = mapLayerASnapshot(args);
  });

  test('all required keys are present', () => {
    const requiredKeys: (keyof LayerASnapshot)[] = [
      'messageIndex',
      'timestampMs',
      'deltaMessageSeconds',
      'valenceScore',
      'valenceConfidence',
      'arousalScore',
      'arousalConfidence',
      'expressionStrength',
      'esConfidence',
      'eivValue',
      'eivTier',
      'emotionalState',
    ];
    for (const key of requiredKeys) {
      expect(snapshot).toHaveProperty(key);
    }
  });

  test('snapshot is frozen', () => {
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  test('patternSignals sub-object is frozen when present', () => {
    expect(snapshot.patternSignals).toBeDefined();
    expect(Object.isFrozen(snapshot.patternSignals)).toBe(true);
  });

  test('scalar fields match inputs exactly', () => {
    expect(snapshot.messageIndex).toBe(7);
    expect(snapshot.timestampMs).toBe(1_700_000_000);
    expect(snapshot.deltaMessageSeconds).toBe(45);
    expect(snapshot.valenceScore).toBe(-0.3);
    expect(snapshot.valenceConfidence).toBe(0.8);
    expect(snapshot.arousalScore).toBe(0.6);
    expect(snapshot.arousalConfidence).toBe(0.75);
    expect(snapshot.expressionStrength).toBe(0.5);
    expect(snapshot.esConfidence).toBe(0.65);
    expect(snapshot.eivValue).toBe(0.42);
    expect(snapshot.eivTier).toBe('moderate');
  });

  test('emotionalState is present with correct fields', () => {
    expect(snapshot.emotionalState.dominant).toBe('NEUTRAL');
    expect(snapshot.emotionalState.arousal).toBe('MEDIUM');
    expect(snapshot.emotionalState.valence).toBe('NEGATIVE');
    expect(snapshot.emotionalState.confidence).toBe(0.8);
  });

  test('patternSignals match inputs', () => {
    expect(snapshot.patternSignals).toEqual({
      capsRatio: 0.12,
      punctuationHits: 3,
      emojiHits: 1,
      repetitionScore: 0.2,
      questionMarks: 2,
    });
  });

  test('snapshot without patternSignals omits the field', () => {
    const bare = mapLayerASnapshot({
      ...args,
      patternSignals: undefined,
    });
    expect(bare.patternSignals).toBeUndefined();
    expect(Object.isFrozen(bare)).toBe(true);
  });
});
