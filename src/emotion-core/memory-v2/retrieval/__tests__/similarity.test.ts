import type { EmotionalFingerprint } from '../../types';
import {
  computeSimilarity,
  emotionMatch,
  undertoneOverlap,
  intensityDistance,
  contextSimilarity,
  W_EMOTION,
  W_UNDERTONE,
  W_INTENSITY,
  W_CONTEXT,
} from '../similarity';

// ──────────────────────────────────────────────────────
// Similarity scoring tests
// ──────────────────────────────────────────────────────

function makeFP(overrides: Partial<EmotionalFingerprint> = {}): EmotionalFingerprint {
  return {
    primary: overrides.primary ?? 'fear',
    undertones: overrides.undertones ?? ['tension', 'dread'],
    intensity: overrides.intensity ?? 0.7,
    contextCategory: overrides.contextCategory ?? 'career',
    relationalTone: overrides.relationalTone ?? 'collaborative',
  };
}

describe('Similarity sub-functions', () => {
  describe('emotionMatch', () => {
    it('returns 1.0 for same primary emotion', () => {
      expect(emotionMatch(makeFP({ primary: 'fear' }), makeFP({ primary: 'fear' }))).toBe(1.0);
    });

    it('returns 0.0 for different primary emotion', () => {
      expect(emotionMatch(makeFP({ primary: 'fear' }), makeFP({ primary: 'joy' }))).toBe(0.0);
    });
  });

  describe('undertoneOverlap', () => {
    it('returns 1.0 for identical undertones', () => {
      const fp = makeFP({ undertones: ['tension', 'dread'] });
      expect(undertoneOverlap(fp, fp)).toBe(1.0);
    });

    it('returns 0.0 for completely different undertones', () => {
      const a = makeFP({ undertones: ['tension', 'dread'] });
      const b = makeFP({ undertones: ['warmth', 'relief'] });
      expect(undertoneOverlap(a, b)).toBe(0.0);
    });

    it('returns partial overlap score (Jaccard)', () => {
      const a = makeFP({ undertones: ['tension', 'dread'] });
      const b = makeFP({ undertones: ['tension', 'guilt'] });
      // intersection=1 (tension), union=3 (tension, dread, guilt)
      expect(undertoneOverlap(a, b)).toBeCloseTo(1 / 3, 5);
    });

    it('handles single-element undertone arrays', () => {
      const a = makeFP({ undertones: ['tension'] });
      const b = makeFP({ undertones: ['tension'] });
      expect(undertoneOverlap(a, b)).toBe(1.0);
    });
  });

  describe('intensityDistance', () => {
    it('returns 1.0 for identical intensities', () => {
      expect(intensityDistance(makeFP({ intensity: 0.7 }), makeFP({ intensity: 0.7 }))).toBe(1.0);
    });

    it('returns 0.0 for maximally different intensities', () => {
      expect(intensityDistance(makeFP({ intensity: 0.0 }), makeFP({ intensity: 1.0 }))).toBe(0.0);
    });

    it('returns intermediate value for partial difference', () => {
      expect(intensityDistance(makeFP({ intensity: 0.7 }), makeFP({ intensity: 0.5 }))).toBeCloseTo(0.8, 5);
    });
  });

  describe('contextSimilarity', () => {
    it('returns 1.0 for same context', () => {
      expect(contextSimilarity(
        makeFP({ contextCategory: 'career' }),
        makeFP({ contextCategory: 'career' }),
      )).toBe(1.0);
    });

    it('returns 0.0 for different context', () => {
      expect(contextSimilarity(
        makeFP({ contextCategory: 'career' }),
        makeFP({ contextCategory: 'relationship' }),
      )).toBe(0.0);
    });
  });
});

describe('computeSimilarity', () => {
  it('returns maximum (0.90) for identical fingerprints', () => {
    const fp = makeFP();
    // Without recency boost, max is 0.90
    expect(computeSimilarity(fp, fp)).toBeCloseTo(
      W_EMOTION + W_UNDERTONE + W_INTENSITY + W_CONTEXT,
      5,
    );
  });

  it('weights sum to 0.90 (without recency)', () => {
    expect(W_EMOTION + W_UNDERTONE + W_INTENSITY + W_CONTEXT).toBeCloseTo(0.90, 5);
  });

  it('same emotion = high score even with different context', () => {
    const careerAnxiety = makeFP({
      primary: 'fear',
      undertones: ['tension', 'dread'],
      intensity: 0.7,
      contextCategory: 'career',
    });
    const relationshipAnxiety = makeFP({
      primary: 'fear',
      undertones: ['tension', 'dread'],
      intensity: 0.65,
      contextCategory: 'relationship',
    });

    const score = computeSimilarity(careerAnxiety, relationshipAnxiety);

    // Same emotion (0.35) + same undertones (0.25) + close intensity (~0.19) + diff context (0)
    // Should be ~0.79 — a strong match despite different domains
    expect(score).toBeGreaterThan(0.70);
  });

  it('different emotion = low score even with same context', () => {
    const careerFear = makeFP({
      primary: 'fear',
      undertones: ['tension', 'dread'],
      contextCategory: 'career',
    });
    const careerJoy = makeFP({
      primary: 'joy',
      undertones: ['warmth', 'relief'],
      contextCategory: 'career',
    });

    const score = computeSimilarity(careerFear, careerJoy);

    // Different emotion (0) + different undertones (0) + close intensity (~0.20) + same context (0.10)
    // Should be ~0.30 — weak match
    expect(score).toBeLessThan(0.40);
  });

  it('career anxiety matches relationship anxiety (the key insight)', () => {
    const careerAnxiety = makeFP({
      primary: 'fear',
      undertones: ['tension', 'dread'],
      intensity: 0.8,
      contextCategory: 'career',
    });
    const relationshipAnxiety = makeFP({
      primary: 'fear',
      undertones: ['tension', 'dread'],
      intensity: 0.75,
      contextCategory: 'relationship',
    });

    const score = computeSimilarity(careerAnxiety, relationshipAnxiety);

    // This IS the core insight: same emotional shape matches across domains
    expect(score).toBeGreaterThan(0.70);
  });

  it('returns 0 for maximally different fingerprints', () => {
    const a = makeFP({
      primary: 'joy',
      undertones: ['warmth'],
      intensity: 0.0,
      contextCategory: 'creative',
    });
    const b = makeFP({
      primary: 'anger',
      undertones: ['tension'],
      intensity: 1.0,
      contextCategory: 'career',
    });

    const score = computeSimilarity(a, b);
    // 0 emotion + 0 undertone + 0 intensity + 0 context = 0
    expect(score).toBe(0);
  });

  it('is symmetric', () => {
    const a = makeFP({ primary: 'fear', undertones: ['tension'] });
    const b = makeFP({ primary: 'sadness', undertones: ['guilt', 'tension'] });

    expect(computeSimilarity(a, b)).toBeCloseTo(computeSimilarity(b, a), 10);
  });
});
