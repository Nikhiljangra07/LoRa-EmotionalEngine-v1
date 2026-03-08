import type { EncoderInput, EncoderMode, EncodedEvent, DominantEmotion } from './types';
import { MEMORY_V1_CONFIG } from './constants';
import { applyDimSpec, l2Normalize, safeNumber } from './normalize';

const EMOTION_INDEX: Record<DominantEmotion, number> = {
  JOY: 4,
  SADNESS: 5,
  ANGER: 6,
  FEAR: 7,
  CONTENTMENT: 8,
  NEUTRAL: 9,
};

const SCALAR_DIM_KEYS: Record<number, keyof EncoderInput> = {
  0: 'eivValue',
  1: 'valenceScore',
  2: 'arousalScore',
  3: 'expressionStrength',
  10: 'avi',
  11: 'valenceBias',
  12: 'arousalBias',
  13: 'momentumConfidence',
};

const ENHANCED_DIM_KEYS: Record<number, keyof EncoderInput> = {
  14: 'pressureScalar',
  15: 'pressureSlope',
  16: 'pressureVolatility',
  17: 'moodDominance',
  18: 'escalationScore',
  19: 'collapseSeverity',
  20: 'agencyDeficit',
};

export function encodeEvent(input: EncoderInput): EncodedEvent {
  const { DIM_SPECS, DIMS, BLOCK_WEIGHTS, BLOCK_DIM_RANGES, L2_EPS, TOP_K_DIMS } = MEMORY_V1_CONFIG;

  const mode: EncoderMode = input.appraisalBridgeEnabled === true ? 'enhanced' : 'baseline';

  const raw = new Array<number>(DIMS);

  for (let d = 0; d <= 3; d++) {
    const key = SCALAR_DIM_KEYS[d];
    raw[d] = applyDimSpec(input[key] as number | undefined, DIM_SPECS[d]);
  }

  for (let d = 4; d <= 9; d++) {
    raw[d] = 0;
  }
  if (input.dominantEmotion !== undefined && input.dominantEmotion !== null) {
    const idx = EMOTION_INDEX[input.dominantEmotion];
    if (idx !== undefined) {
      raw[idx] = 1;
    }
  }

  for (let d = 10; d <= 13; d++) {
    const key = SCALAR_DIM_KEYS[d];
    raw[d] = applyDimSpec(input[key] as number | undefined, DIM_SPECS[d]);
  }

  for (let d = 14; d <= 20; d++) {
    if (mode === 'baseline') {
      raw[d] = 0;
    } else {
      const key = ENHANCED_DIM_KEYS[d];
      raw[d] = applyDimSpec(input[key] as number | undefined, DIM_SPECS[d]);
    }
  }

  const blockEntries = Object.entries(BLOCK_DIM_RANGES) as Array<[string, readonly [number, number]]>;
  for (const [blockName, [lo, hi]] of blockEntries) {
    const w = BLOCK_WEIGHTS[blockName as keyof typeof BLOCK_WEIGHTS];
    for (let d = lo; d <= hi; d++) {
      raw[d] = safeNumber(raw[d], 0) * w;
    }
  }

  const normalized = l2Normalize(raw, L2_EPS);

  const indexed = normalized.map((val, dim) => ({
    dim,
    name: DIM_SPECS[dim].name,
    absVal: Math.abs(val),
    value: val,
  }));
  indexed.sort((a, b) => b.absVal - a.absVal);
  const topDims = indexed.slice(0, TOP_K_DIMS).map(({ dim, name, value }) => ({ dim, name, value }));

  return {
    mode,
    emotionVec: normalized,
    dimSummary: { topDims },
  };
}
