// src/emotion-core/processors/EmotionalStateInterpreter.ts

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
    if (eiv >= 0.75) return 'HIGH';
    if (eiv >= 0.35) return 'MEDIUM';
    return 'LOW';
  }

  // -----------------------------
  // Valence = emoji + punctuation logic
  // -----------------------------
  private static classifyValence(
    components: EIVComponents
  ): Valence {
    const { emoji, punctuation } = components;

    // Positive signal dominates
    if (emoji >= 0.4) {
      return 'POSITIVE';
    }

    // High arousal punctuation without emoji = frustration / negative
    if (emoji < 0.15 && punctuation >= 0.5) {
      return 'NEGATIVE';
    }

    return 'NEUTRAL';
  }
}
