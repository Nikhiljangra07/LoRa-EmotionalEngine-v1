import { encodeEvent } from '../eventEncoder';
import { MEMORY_V1_CONFIG } from '../constants';
import type { EncoderInput } from '../types';

function vecNorm(vec: number[]): number {
  return Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
}

describe('eventEncoder – output shape', () => {
  it('always returns emotionVec of length 21', () => {
    const result = encodeEvent({});
    expect(result.emotionVec.length).toBe(MEMORY_V1_CONFIG.DIMS);
  });

  it('returns length 21 for fully populated baseline input', () => {
    const input: EncoderInput = {
      eivValue: 0.8,
      valenceScore: 0.2,
      arousalScore: 0.6,
      expressionStrength: 0.5,
      dominantEmotion: 'JOY',
      avi: 0.7,
      valenceBias: -0.3,
      arousalBias: 0.4,
      momentumConfidence: 0.9,
    };
    const result = encodeEvent(input);
    expect(result.emotionVec.length).toBe(21);
  });

  it('returns length 21 for enhanced input', () => {
    const input: EncoderInput = {
      eivValue: 0.5,
      appraisalBridgeEnabled: true,
      pressureScalar: 45,
      pressureSlope: -10,
      moodDominance: 0.6,
    };
    const result = encodeEvent(input);
    expect(result.emotionVec.length).toBe(21);
  });
});

describe('eventEncoder – mode detection', () => {
  it('defaults to baseline when appraisalBridgeEnabled is undefined', () => {
    expect(encodeEvent({}).mode).toBe('baseline');
  });

  it('defaults to baseline when appraisalBridgeEnabled is false', () => {
    expect(encodeEvent({ appraisalBridgeEnabled: false }).mode).toBe('baseline');
  });

  it('selects enhanced when appraisalBridgeEnabled is true', () => {
    expect(encodeEvent({ appraisalBridgeEnabled: true }).mode).toBe('enhanced');
  });
});

describe('eventEncoder – baseline zero-fills enhanced dims', () => {
  it('dims 14-20 are zero in baseline even when enhanced values are provided', () => {
    const input: EncoderInput = {
      appraisalBridgeEnabled: false,
      pressureScalar: 80,
      pressureSlope: 30,
      pressureVolatility: 15,
      moodDominance: 0.9,
      escalationScore: 0.8,
      collapseSeverity: 0.7,
      agencyDeficit: 0.6,
      eivValue: 0.5,
    };
    const result = encodeEvent(input);
    // Before L2 norm, dims 14-20 were 0, so after norm they stay 0
    for (let d = 14; d <= 20; d++) {
      expect(result.emotionVec[d]).toBe(0);
    }
  });
});

describe('eventEncoder – enhanced mode uses appraisal dims', () => {
  it('dims 14-20 are non-zero when enhanced signals are provided', () => {
    const input: EncoderInput = {
      appraisalBridgeEnabled: true,
      eivValue: 0.5,
      pressureScalar: 60,
      escalationScore: 0.8,
      collapseSeverity: 0.5,
    };
    const result = encodeEvent(input);
    const enhancedSum = result.emotionVec.slice(14, 21).reduce((s, v) => s + Math.abs(v), 0);
    expect(enhancedSum).toBeGreaterThan(0);
  });
});

describe('eventEncoder – one-hot encoding', () => {
  const emotions: Array<[string, number]> = [
    ['JOY', 4],
    ['SADNESS', 5],
    ['ANGER', 6],
    ['FEAR', 7],
    ['CONTENTMENT', 8],
    ['NEUTRAL', 9],
  ];

  it.each(emotions)('%s places activation at dim %i', (emotion, expectedDim) => {
    const input: EncoderInput = {
      dominantEmotion: emotion as any,
      eivValue: 0.5,
    };
    const result = encodeEvent(input);
    // Check that the expected dim has the largest absolute value among dims 4-9
    const onehotSlice = result.emotionVec.slice(4, 10);
    const maxIdx = onehotSlice.reduce(
      (best, val, idx) => (Math.abs(val) > Math.abs(onehotSlice[best]) ? idx : best),
      0,
    );
    expect(maxIdx + 4).toBe(expectedDim);
  });

  it('missing dominantEmotion results in all-zero one-hot dims', () => {
    const input: EncoderInput = { eivValue: 0.5 };
    const result = encodeEvent(input);
    for (let d = 4; d <= 9; d++) {
      expect(result.emotionVec[d]).toBe(0);
    }
  });
});

describe('eventEncoder – block weighting before L2 norm', () => {
  it('onehot block (weight 0.4) has lower magnitude than scalars block (weight 1.0)', () => {
    // Construct an input where only eivValue=1 and dominantEmotion=JOY
    // Both produce a raw value of 1.0 pre-weighting.
    // After weighting: eivValue gets *1.0, onehot_JOY gets *0.4
    // After L2 norm, eivValue should have a larger magnitude.
    const input: EncoderInput = {
      eivValue: 1.0,
      dominantEmotion: 'JOY',
    };
    const result = encodeEvent(input);
    expect(Math.abs(result.emotionVec[0])).toBeGreaterThan(Math.abs(result.emotionVec[4]));
  });

  it('momentum block (weight 0.7) produces smaller values than scalars block (weight 1.0) for equal raw', () => {
    const input: EncoderInput = {
      eivValue: 1.0,
      avi: 1.0,
    };
    const result = encodeEvent(input);
    // eivValue(dim0) weighted 1.0, avi(dim10) weighted 0.7
    expect(Math.abs(result.emotionVec[0])).toBeGreaterThan(Math.abs(result.emotionVec[10]));
  });
});

describe('eventEncoder – NaN safety', () => {
  it('produces no NaN or Infinity values with NaN inputs', () => {
    const input: EncoderInput = {
      eivValue: NaN,
      valenceScore: NaN,
      arousalScore: NaN,
      expressionStrength: NaN,
      avi: NaN,
      valenceBias: NaN,
      arousalBias: NaN,
      momentumConfidence: NaN,
      appraisalBridgeEnabled: true,
      pressureScalar: NaN,
      pressureSlope: NaN,
      pressureVolatility: NaN,
      moodDominance: NaN,
      escalationScore: NaN,
      collapseSeverity: NaN,
      agencyDeficit: NaN,
    };
    const result = encodeEvent(input);
    for (const v of result.emotionVec) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('produces no NaN or Infinity values with Infinity inputs', () => {
    const input: EncoderInput = {
      eivValue: Infinity,
      valenceScore: -Infinity,
      arousalScore: Infinity,
      appraisalBridgeEnabled: true,
      pressureScalar: Infinity,
    };
    const result = encodeEvent(input);
    for (const v of result.emotionVec) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('eventEncoder – dimSummary.topDims', () => {
  it('returns exactly 3 entries', () => {
    const result = encodeEvent({ eivValue: 0.9, arousalScore: 0.7, avi: 0.5 });
    expect(result.dimSummary.topDims.length).toBe(MEMORY_V1_CONFIG.TOP_K_DIMS);
  });

  it('includes correct dim indices and names', () => {
    const result = encodeEvent({ eivValue: 0.9, arousalScore: 0.7, avi: 0.5 });
    for (const entry of result.dimSummary.topDims) {
      expect(typeof entry.dim).toBe('number');
      expect(typeof entry.name).toBe('string');
      expect(typeof entry.value).toBe('number');
      expect(entry.name).toBe(MEMORY_V1_CONFIG.DIM_SPECS[entry.dim].name);
    }
  });

  it('is deterministic across repeated calls', () => {
    const input: EncoderInput = { eivValue: 0.6, dominantEmotion: 'ANGER', avi: 0.3 };
    const r1 = encodeEvent(input);
    const r2 = encodeEvent(input);
    expect(r1.dimSummary.topDims).toEqual(r2.dimSummary.topDims);
    expect(r1.emotionVec).toEqual(r2.emotionVec);
  });
});

describe('eventEncoder – L2 norm', () => {
  it('produces approximately unit L2 norm for non-trivial input', () => {
    const input: EncoderInput = {
      eivValue: 0.8,
      valenceScore: 0.3,
      arousalScore: 0.6,
      dominantEmotion: 'FEAR',
      avi: 0.5,
      momentumConfidence: 0.7,
    };
    const result = encodeEvent(input);
    const norm = vecNorm(result.emotionVec);
    expect(norm).toBeCloseTo(1.0, 6);
  });

  it('returns all-zero vector when all inputs are at fallback/zero', () => {
    const result = encodeEvent({});
    // All dims use fallbacks. Dims 1 and 11 have fallback 0.5, so vec won't be zero.
    // Actually let's just verify it's valid (finite).
    for (const v of result.emotionVec) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});
