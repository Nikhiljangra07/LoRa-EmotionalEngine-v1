// src/emotion-core/processors/EIVComponentAssembler.ts

import { EIVComponents } from '../types/eiv.types';

/**
 * AnalyzerOutputs
 * ----------------
 * Normalized analyzer scores (0–1)
 */
export interface AnalyzerOutputs {
  expressionStrength: { score: number; confidence: number };
  valence: { score: number; confidence: number };
  arousal: { score: number; confidence: number };
}

export class EIVComponentAssembler {
  static assemble(outputs: AnalyzerOutputs): EIVComponents {
    return {
      expressionStrength: {
        score: outputs.expressionStrength.score,
        confidence: outputs.expressionStrength.confidence,
      },
      valence: {
        score: outputs.valence.score,
        confidence: outputs.valence.confidence,
      },
      arousal: {
        score: outputs.arousal.score,
        confidence: outputs.arousal.confidence,
      },
    };
  }
}
