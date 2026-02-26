import type { EncoderInput, DominantEmotion } from '../types';

export type BandHint = 'B0' | 'B1' | 'B2' | 'B3' | 'B4';

export type BandSchedule = Array<{
  sessionIndex: number;
  band: BandHint;
}>;

export type StressRunOptions = {
  seed: number;
  bandSchedule?: BandSchedule;
};

export type StressMessage = {
  encoderInput: EncoderInput;
  dominant: DominantEmotion;
};

export type StressSession = {
  sessionIndex: number;
  regime: string;
  messages: StressMessage[];
};

export type StressSessionResult = {
  sessionIndex: number;
  messageCount: number;
  schemasCount: number;
  injectedCount: number;
  oscillationCount: number;
  createdSchemas: number;
  mergedSchemas: number;
  prunedSchemas: number;
  band: BandHint;
  policySignature: string;
};

export type StressRunResult = {
  totalMessages: number;
  totalSessions: number;
  maxSchemasObserved: number;
  totalInjections: number;
  totalOscillations: number;
  schemaGrowthOverTime: number[];
  sessionResults: StressSessionResult[];
  messagesPolicyAllowsInjection: number;
};

export type StressVerdict =
  | 'STABLE'
  | 'MILD_DRIFT'
  | 'HIGH_DRIFT';
