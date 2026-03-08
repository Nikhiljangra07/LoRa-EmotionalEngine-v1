export enum EscalationLevel {
  CALM = 0,
  RISING = 1,
  ESCALATED = 2,
  CRITICAL = 3,
}

export interface EscalationInput {
  slope: number;
  volatility: number;
  isShock: boolean;
  pressure?: number;
  gain?: number;
  deltaMessageSeconds?: number;
}

export interface EscalationOutput {
  level: EscalationLevel;
  score: number;
  r: number;
  reasons: string[];
  flags: {
    warmedUp: boolean;
    isFlapping: boolean;
    enteredCritical: boolean;
  };
}

export interface EscalationState {
  level: EscalationLevel;
  nSamples: number;
  slopeBuf: number[];
  volBuf: number[];
  levelBuf: EscalationLevel[];
  score: number;
  r: number;
  warnHits: boolean[];
  escHits: boolean[];
  calmHits: boolean[];
  escExitHits: boolean[];
  critExitHits: boolean[];
}
