// src/emotion-core/processors/EmotionalStateInterpreter.ts

import { MASTER_CONSTANTS } from '../config/master.constants';
import { EIVComponents } from '../types/eiv.types';

export type ArousalLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type Valence = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';

export interface EmotionalState {
  arousal: ArousalLevel;
  valence: Valence;
  intensity: number; // EIV (0–1)
}

export class EmotionalStateInterpreter {
  static interpret(
    components: EIVComponents,
    eiv: number
  ): EmotionalState {
    const arousal = this.classifyArousal(eiv);
    const valence = this.classifyValence(components);

    return {
      arousal,
      valence,
      intensity: eiv
    };
  }

  // -----------------------------
  // Arousal = PURELY from EIV
  // -----------------------------
  private static classifyArousal(eiv: number): ArousalLevel {
    if (
      eiv >=
      MASTER_CONSTANTS.stateClassification.arousalFromEiv
        .highMinInclusive
    ) {
      return 'HIGH';
    }
    if (
      eiv >=
      MASTER_CONSTANTS.stateClassification.arousalFromEiv
        .mediumMinInclusive
    ) {
      return 'MEDIUM';
    }
    return 'LOW';
  }

  // -----------------------------
  // Valence = score sign + magnitude threshold
  // -----------------------------
  private static classifyValence(
    components: EIVComponents
  ): Valence {
    const magnitude = Math.abs(components.valence.score);
    const minMagnitude =
      MASTER_CONSTANTS.valenceAnalyzer.thresholds.minMagnitude;

    if (magnitude < minMagnitude) {
      return 'NEUTRAL';
    }

    return components.valence.score >= 0
      ? 'POSITIVE'
      : 'NEGATIVE';
  }
}
