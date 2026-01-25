// src/emotion-core/types/etv.types.ts

export interface ETVState {
  value: number; // 0–1, internal only
}



export interface ETVState {
  value: number;             // 0–1
  sessionEIVs: number[];
  messageCount: number;
  lastUpdated: number;
}

export interface ETVUpdateResult {
  oldETV: number;
  newETV: number;
  sessionMean: number;
  volatility: number;
  applied: {
    historyWeight: number;
    sessionWeight: number;
    violationPenalty: boolean;
  };
  tier: 'minimal' | 'moderate' | 'substantial' | 'maximal';
}
