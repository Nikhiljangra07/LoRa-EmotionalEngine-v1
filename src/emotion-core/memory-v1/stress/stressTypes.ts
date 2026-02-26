import type { EncoderInput, DominantEmotion } from '../types';

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
};

export type StressRunResult = {
  totalMessages: number;
  totalSessions: number;
  maxSchemasObserved: number;
  totalInjections: number;
  totalOscillations: number;
  schemaGrowthOverTime: number[];
  sessionResults: StressSessionResult[];
};

export type StressVerdict =
  | 'STABLE'
  | 'MILD_DRIFT'
  | 'HIGH_DRIFT';
