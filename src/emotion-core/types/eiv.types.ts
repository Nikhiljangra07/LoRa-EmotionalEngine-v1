// src/emotion-core/types/eiv.types.ts

export interface EIVComponentSignal {
  score: number;
  confidence: number;
}

export interface EIVComponents {
  expressionStrength: EIVComponentSignal;
  valence: EIVComponentSignal;
  arousal: EIVComponentSignal;
}

export type EIVTier =
  | 'minimal'
  | 'low'
  | 'moderate'
  | 'high'
  | 'extreme';

export interface EIVBreakdown {
  rawComponents: EIVComponents;

  weightedComponents: {
    expressionStrength: number;
    valence: number;
    arousal: number;
  };

  dominantSignals: string[];
  tier: EIVTier;

  rawValue: number;
  finalValue: number;
}

export interface EIVResult {
  value: number;
  components: EIVComponents;
  breakdown: EIVBreakdown;
  timestamp: number;
}
