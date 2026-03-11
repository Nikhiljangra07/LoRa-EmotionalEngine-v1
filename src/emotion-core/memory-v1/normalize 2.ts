import type { DimSpec } from './types';

export function clamp(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return lo;
  return x < lo ? lo : x > hi ? hi : x;
}

export function safeNumber(x: number | undefined | null, fallback: number): number {
  if (x === undefined || x === null || !Number.isFinite(x)) return fallback;
  return x;
}

export function valenceTo01(x: number): number {
  return clamp((x + 1) / 2, 0, 1);
}

export function tanh01(x: number, divisor: number, clampRange?: [number, number] | null): number {
  let v = safeNumber(x, 0);
  if (clampRange) {
    v = clamp(v, clampRange[0], clampRange[1]);
  }
  return clamp(Math.tanh(v / divisor), 0, 1);
}

export function tanhSignedTo01(x: number, divisor: number, clampRange?: [number, number] | null): number {
  let v = safeNumber(x, 0);
  if (clampRange) {
    v = clamp(v, clampRange[0], clampRange[1]);
  }
  return clamp((Math.tanh(v / divisor) + 1) / 2, 0, 1);
}

export function l2Normalize(vec: number[], eps: number): number[] {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) {
    const v = safeNumber(vec[i], 0);
    sumSq += v * v;
  }
  const norm = Math.sqrt(sumSq);
  if (norm < eps) {
    return new Array(vec.length).fill(0);
  }
  const out = new Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    out[i] = safeNumber(vec[i], 0) / norm;
  }
  return out;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  const len = a.length;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    const va = safeNumber(a[i], 0);
    const vb = safeNumber(b[i], 0);
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom < 1e-12) return 0;
  return clamp(safeNumber(dot / denom, 0), -1, 1);
}

export function applyDimSpec(inputScalar: number | undefined | null, spec: DimSpec): number {
  const raw = safeNumber(inputScalar as number, NaN);

  if (!Number.isFinite(raw)) {
    return spec.fallback;
  }

  let clamped = raw;
  if (spec.clamp) {
    clamped = clamp(raw, spec.clamp[0], spec.clamp[1]);
  }

  switch (spec.transform) {
    case 'identity':
      return clamp(clamped, 0, 1);
    case 'valenceTo01':
      return valenceTo01(clamped);
    case 'tanh01':
      return tanh01(clamped, spec.tanhDivisor!, spec.clamp);
    case 'tanhSignedTo01':
      return tanhSignedTo01(clamped, spec.tanhDivisor!, spec.clamp);
    default:
      return spec.fallback;
  }
}
