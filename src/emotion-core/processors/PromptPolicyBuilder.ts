// ═══════════════════════════════════════════════════════════════════
// ORPHAN / NOT WIRED — DO NOT USE IN RUNTIME
// This module is not consumed by any runtime code path (EngineOrchestrator,
// adapter, prompt builder). It exists as a design reference for future
// policy-driven prompt construction. Do not import into production modules.
// ═══════════════════════════════════════════════════════════════════

// src/emotion-core/processors/PromptPolicyBuilder.ts

import { EmotionalState } from './EmotionalStateInterpreter';
import { MASTER_CONSTANTS } from '../config/master.constants';

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
    if (
      etv <
      MASTER_CONSTANTS.promptPolicy.etvThresholds
        .professionalMaxExclusive
    ) {
      return 'PROFESSIONAL';
    }
    if (
      etv <
      MASTER_CONSTANTS.promptPolicy.etvThresholds
        .friendlyMaxExclusive
    ) {
      return 'FRIENDLY';
    }
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

