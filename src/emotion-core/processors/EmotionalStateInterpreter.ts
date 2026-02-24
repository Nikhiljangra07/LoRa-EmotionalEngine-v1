// src/emotion-core/processors/EmotionalStateInterpreter.ts

import { MASTER_CONSTANTS } from '../config/master.constants';
import { AnalyzerOutputs } from './EIVComponentAssembler';
import {
  INITIAL_MOMENTUM_STATE,
  MomentumState,
} from '../runtime/MomentumState';
import { updateMomentum } from '../runtime/updateMomentum';
import { debugEnabled } from '../debug/debugGate';

export type ArousalLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type Valence = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';

export interface EmotionalState {
  arousal: ArousalLevel;
  valence: Valence;
  intensity: number; // EIV (0–1)
}

type MomentumSignal = {
  valence: number;
  arousal: number;
  confidence: number;
};

export class EmotionalStateInterpreter {
  momentum: MomentumState = { ...INITIAL_MOMENTUM_STATE };
  private momentumHistory: MomentumSignal[] = [];

  reset(): void {
    this.momentum = { ...INITIAL_MOMENTUM_STATE };
    this.momentumHistory = [];
  }

  interpret(
    analyzerOutputs: AnalyzerOutputs,
    eiv: number
  ): EmotionalState {
    const arousal = EmotionalStateInterpreter.classifyArousal(eiv);
    const valence = EmotionalStateInterpreter.classifyValence(analyzerOutputs);

    const detectedSignal: MomentumSignal = {
      valence: analyzerOutputs.valence.score,
      arousal: analyzerOutputs.arousal.score,
      confidence: Math.min(
        analyzerOutputs.valence.confidence,
        analyzerOutputs.arousal.confidence
      ),
    };

    this.momentumHistory.push(detectedSignal);
    if (
      this.momentumHistory.length >
      MASTER_CONSTANTS.momentum.history.maxEntries
    ) {
      this.momentumHistory.shift();
    }

    this.momentum = updateMomentum(
      this.momentum,
      detectedSignal,
      this.momentumHistory
    );

    if (debugEnabled) {
      console.log(
        '[LoRa::Momentum]',
        this.momentum
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
