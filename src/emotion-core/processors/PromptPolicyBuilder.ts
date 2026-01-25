// src/emotion-core/processors/PromptPolicyBuilder.ts

import { EmotionalState } from './EmotionalStateInterpreter';

export interface PromptPolicy {
  energy: 'LOW' | 'MATCH' | 'HIGH';
  warmth: 'LOW' | 'MEDIUM' | 'HIGH';
  formality: 'PROFESSIONAL' | 'FRIENDLY' | 'CASUAL';
  depth: 'SURFACE' | 'MODERATE' | 'DEEP';
}

export class PromptPolicyBuilder {
  static build(
    state: EmotionalState,
    etv: number
  ): PromptPolicy {
    return {
      energy: this.mapEnergy(state.arousal),
      warmth: this.mapWarmth(state.valence),
      formality: this.mapFormality(etv),
      depth: this.mapDepth(state.arousal)
    };
  }

  // -----------------------------
  // Energy control
  // -----------------------------
  private static mapEnergy(arousal: EmotionalState['arousal']) {
    if (arousal === 'HIGH') return 'MATCH';
    if (arousal === 'MEDIUM') return 'MATCH';
    return 'LOW';
  }

  // -----------------------------
  // Warmth control
  // -----------------------------
  private static mapWarmth(valence: EmotionalState['valence']) {
    if (valence === 'POSITIVE') return 'HIGH';
    if (valence === 'NEGATIVE') return 'HIGH';
    return 'MEDIUM';
  }

  // -----------------------------
  // Formality from ETV
  // -----------------------------
  private static mapFormality(etv: number) {
    if (etv < 0.35) return 'PROFESSIONAL';
    if (etv < 0.65) return 'FRIENDLY';
    return 'CASUAL';
  }

  // -----------------------------
  // Emotional depth
  // -----------------------------
  private static mapDepth(arousal: EmotionalState['arousal']) {
    if (arousal === 'HIGH') return 'DEEP';
    if (arousal === 'MEDIUM') return 'MODERATE';
    return 'SURFACE';
  }
}

