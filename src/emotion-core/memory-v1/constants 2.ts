import type { DimSpec, BlockWeights } from './types';

const DIM_SPECS: readonly DimSpec[] = Object.freeze([
  { dim: 0,  name: 'eivValue',            rawRange: [0, 1],    clamp: [0, 1],    transform: 'identity',         fallback: 0.0 },
  { dim: 1,  name: 'valenceScore',         rawRange: [-1, 1],   clamp: [-1, 1],   transform: 'valenceTo01',      fallback: 0.5 },
  { dim: 2,  name: 'arousalScore',         rawRange: [0, 1],    clamp: [0, 1],    transform: 'identity',         fallback: 0.0 },
  { dim: 3,  name: 'expressionStrength',   rawRange: [0, 1],    clamp: [0, 1],    transform: 'identity',         fallback: 0.0 },
  { dim: 4,  name: 'onehot_JOY',           rawRange: null,      clamp: null,      transform: 'identity',         fallback: 0.0 },
  { dim: 5,  name: 'onehot_SADNESS',       rawRange: null,      clamp: null,      transform: 'identity',         fallback: 0.0 },
  { dim: 6,  name: 'onehot_ANGER',         rawRange: null,      clamp: null,      transform: 'identity',         fallback: 0.0 },
  { dim: 7,  name: 'onehot_FEAR',          rawRange: null,      clamp: null,      transform: 'identity',         fallback: 0.0 },
  { dim: 8,  name: 'onehot_CONTENTMENT',   rawRange: null,      clamp: null,      transform: 'identity',         fallback: 0.0 },
  { dim: 9,  name: 'onehot_NEUTRAL',       rawRange: null,      clamp: null,      transform: 'identity',         fallback: 0.0 },
  { dim: 10, name: 'avi',                  rawRange: [0, 1],    clamp: [0, 1],    transform: 'identity',         fallback: 0.0 },
  { dim: 11, name: 'valenceBias',          rawRange: [-1, 1],   clamp: [-1, 1],   transform: 'valenceTo01',      fallback: 0.5 },
  { dim: 12, name: 'arousalBias',          rawRange: [0, 1],    clamp: [0, 1],    transform: 'identity',         fallback: 0.0 },
  { dim: 13, name: 'momentumConfidence',   rawRange: [0, 1],    clamp: [0, 1],    transform: 'identity',         fallback: 0.0 },
  { dim: 14, name: 'pressureScalar',       rawRange: [0, 120],  clamp: [0, 120],  transform: 'tanh01',           tanhDivisor: 30, fallback: 0.0 },
  { dim: 15, name: 'pressureSlope',        rawRange: [-60, 60], clamp: [-60, 60], transform: 'tanhSignedTo01',   tanhDivisor: 15, fallback: 0.5 },
  { dim: 16, name: 'pressureVolatility',   rawRange: [0, 30],   clamp: [0, 30],   transform: 'tanh01',           tanhDivisor: 8,  fallback: 0.0 },
  { dim: 17, name: 'moodDominance',        rawRange: [0, 1],    clamp: [0, 1],    transform: 'identity',         fallback: 0.0 },
  { dim: 18, name: 'escalationScore',      rawRange: [0, 1],    clamp: [0, 1],    transform: 'identity',         fallback: 0.0 },
  { dim: 19, name: 'collapseSeverity',     rawRange: [0, 1],    clamp: [0, 1],    transform: 'identity',         fallback: 0.0 },
  { dim: 20, name: 'agencyDeficit',        rawRange: [0, 1],    clamp: [0, 1],    transform: 'identity',         fallback: 0.0 },
]) as readonly DimSpec[];

const BLOCK_WEIGHTS: Readonly<BlockWeights> = Object.freeze({
  scalars:   1.0,
  onehot:    0.4,
  momentum:  0.7,
  appraisal: 0.8,
});

const BLOCK_DIM_RANGES: Readonly<Record<string, readonly [number, number]>> = Object.freeze({
  scalars:   [0, 3],
  onehot:    [4, 9],
  momentum:  [10, 13],
  appraisal: [14, 20],
});

export const MEMORY_V1_CONFIG = Object.freeze({
  DIMS: 21 as const,
  BASELINE_DIMS: 14 as const,
  ENHANCED_DIMS: 7 as const,
  L2_EPS: 1e-8,
  TOP_K_DIMS: 3 as const,

  DIM_SPECS,
  BLOCK_WEIGHTS,
  BLOCK_DIM_RANGES,

  SALIENCE_FLOOR: 0.15,
  W_EIV_BASELINE: 0.60,
  W_AVI_BASELINE: 0.40,
  W_EIV_ENHANCED: 0.45,
  W_AVI_ENHANCED: 0.30,
  W_ESC_ENHANCED: 0.25,

  MAX_WRITES_PER_SESSION: 10,
});
