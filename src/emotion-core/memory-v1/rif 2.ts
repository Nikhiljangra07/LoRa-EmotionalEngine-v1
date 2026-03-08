import { clamp, safeNumber } from './normalize';
import type { SchemaRecord } from './schemaStore';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_BIAS = 0.20;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RIFState = {
  alpha: number;
  beta: number;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createRIFState(alpha: number, beta: number): RIFState {
  return { alpha, beta };
}

export function applyRIF(
  schemas: SchemaRecord[],
  winnerId: string,
  alpha: number,
  beta: number,
): SchemaRecord[] {
  return schemas.map((s) => {
    const oldBias = safeNumber(s.retrievalBias, 0);
    let newBias: number;

    if (s.schemaId === winnerId) {
      newBias = oldBias + alpha * (1 - oldBias);
    } else {
      newBias = oldBias - beta * oldBias;
    }

    return {
      ...s,
      retrievalBias: clamp(safeNumber(newBias, 0), -MAX_BIAS, MAX_BIAS),
    };
  });
}

export function applyBiasDecay(
  schemas: SchemaRecord[],
  decayRate: number,
): SchemaRecord[] {
  return schemas.map((s) => {
    const decayed = safeNumber(s.retrievalBias, 0) * (1 - decayRate);
    return {
      ...s,
      retrievalBias: clamp(safeNumber(decayed, 0), -MAX_BIAS, MAX_BIAS),
    };
  });
}
