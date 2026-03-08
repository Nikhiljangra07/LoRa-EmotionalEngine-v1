import type { SalienceInput, SalienceResult } from './types';
import { MEMORY_V1_CONFIG } from './constants';
import { clamp, safeNumber } from './normalize';

export function computeSalience(input: SalienceInput): SalienceResult {
  const {
    SALIENCE_FLOOR,
    W_EIV_BASELINE, W_AVI_BASELINE,
    W_EIV_ENHANCED, W_AVI_ENHANCED, W_ESC_ENHANCED,
  } = MEMORY_V1_CONFIG;

  const eiv = clamp(safeNumber(input.eivValue, 0), 0, 1);
  const avi = clamp(safeNumber(input.avi, 0), 0, 1);
  const esc = clamp(safeNumber(input.escalationScore ?? undefined, 0), 0, 1);

  let salience: number;
  if (input.appraisalBridgeEnabled) {
    salience = clamp(
      W_EIV_ENHANCED * eiv + W_AVI_ENHANCED * avi + W_ESC_ENHANCED * esc,
      0,
      1,
    );
  } else {
    salience = clamp(
      W_EIV_BASELINE * eiv + W_AVI_BASELINE * avi,
      0,
      1,
    );
  }

  let overrideReason: SalienceResult['overrideReason'] = 'NONE';
  let shouldWrite: boolean;

  if (input.collapseEvent) {
    overrideReason = 'COLLAPSE';
    shouldWrite = true;
  } else if (input.hasViolation) {
    overrideReason = 'VIOLATION';
    shouldWrite = true;
  } else {
    shouldWrite = salience >= SALIENCE_FLOOR;
  }

  return { salience, shouldWrite, overrideReason };
}
