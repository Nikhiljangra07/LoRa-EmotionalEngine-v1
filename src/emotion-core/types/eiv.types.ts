// src/emotion-core/types/eiv.types.ts

export interface EIVComponents {
  linguistic: number;        // 0–1 (V1: repetition-based)
  punctuation: number;       // 0–1
  capitalization: number;    // 0–1
  emoji: number;             // 0–1
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
    linguistic: number;
    punctuation: number;
    capitalization: number;
    emoji: number;
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
