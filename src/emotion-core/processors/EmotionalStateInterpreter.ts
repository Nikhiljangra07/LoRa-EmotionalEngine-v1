// src/emotion-core/processors/EmotionalStateInterpreter.ts

import { MASTER_CONSTANTS } from '../config/master.constants';
import { AnalyzerOutputs } from './EIVComponentAssembler';
import {
  INITIAL_MOMENTUM_STATE,
  MomentumState,
} from '../runtime/MomentumState';
import { updateMomentum } from '../runtime/updateMomentum';

export type ArousalLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type Valence = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';

export interface EmotionalState {
  arousal: ArousalLevel;
  valence: Valence;
  intensity: number; // EIV (0–1)
}

export class EmotionalStateInterpreter {
  // Runtime-only momentum (resets on process exit)
  static momentum: MomentumState = INITIAL_MOMENTUM_STATE;

  static interpret(
    analyzerOutputs: AnalyzerOutputs,
    eiv: number
  ): EmotionalState {
    const arousal = this.classifyArousal(eiv);
    const valence = this.classifyValence(analyzerOutputs);

    // Update momentum using detected emotional signals
    EmotionalStateInterpreter.momentum = updateMomentum(
      EmotionalStateInterpreter.momentum,
      {
        valence: analyzerOutputs.valence.score,
        arousal: analyzerOutputs.arousal.score,
        confidence: Math.min(
          analyzerOutputs.valence.confidence,
          analyzerOutputs.arousal.confidence
        ),
      }
    );

    if (process.env.LORA_DEBUG) {
      console.log(
        '[LoRa::Momentum]',
        EmotionalStateInterpreter.momentum
      );
    }

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
      MASTER_CONSTANTS.emotionalState.interpretation.arousalFromEiv
        .highMinInclusive
    ) {
      return 'HIGH';
    }
    if (
      eiv >=
      MASTER_CONSTANTS.emotionalState.interpretation.arousalFromEiv
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
    analyzerOutputs: AnalyzerOutputs
  ): Valence {
    // Crash-early invariant: Layer-1 must provide ValenceAnalyzer output.
    if (!analyzerOutputs.valence) {
      throw new Error(
        "ValenceAnalyzer output missing — invalid Layer-1 packet"
      );
    }
    const valenceSignal = analyzerOutputs.valence;
    const magnitude = Math.abs(valenceSignal.score);
    const minMagnitude =
      MASTER_CONSTANTS.valenceAnalyzer.thresholds.minMagnitude;

    if (magnitude < minMagnitude) {
      return 'NEUTRAL';
    }

    return valenceSignal.score >=
      MASTER_CONSTANTS.valenceAnalyzer.bounds.zero
      ? 'POSITIVE'
      : 'NEGATIVE';
  }
}
