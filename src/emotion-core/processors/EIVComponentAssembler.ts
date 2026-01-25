// src/emotion-core/processors/EIVComponentAssembler.ts

import { EIVComponents } from '../types/eiv.types';

/**
 * AnalyzerOutputs
 * ----------------
 * Normalized analyzer scores (0–1)
 */
export interface AnalyzerOutputs {
  linguisticScore?: number;
  emojiScore?: number;
  capitalizationScore?: number;
  punctuationScore?: number;
}

/* ============================================================================
 * Utilities
 * ========================================================================== */

function clamp(value: number, min = 0, max = 1): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function safe(value?: number): number {
  return Number.isFinite(value) ? value! : 0;
}

/* ============================================================================
 * Assembler
 * ========================================================================== */

export class EIVComponentAssembler {
  static assemble(outputs: AnalyzerOutputs): EIVComponents {
    return {
      linguistic: clamp(safe(outputs.linguisticScore)),
      emoji: clamp(safe(outputs.emojiScore)),
      capitalization: clamp(safe(outputs.capitalizationScore)),
      punctuation: clamp(safe(outputs.punctuationScore)),
    };
  }
}
