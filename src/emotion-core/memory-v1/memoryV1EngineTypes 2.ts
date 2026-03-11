import type { EpisodicBufferState } from './episodicBuffer';
import type { SchemaStoreState } from './schemaStore';
import type { RIFGuardState } from './rifGuard';
import type { EncoderInput, SalienceResult } from './types';
import type { MemoryContext } from './memoryContextTypes';
import type { RetrievalResult } from './retrievalEngine';
import type { ConsolidationResult } from './consolidationTypes';

export type MemoryV1State = {
  userId: string;
  episodic: EpisodicBufferState;
  schemas: SchemaStoreState;
  rifGuard: RIFGuardState;
};

export type ProcessMessageInput = {
  encoderInput: EncoderInput;
  eventId: string;
  timestampMs: number;
  rifAlpha?: number;
  rifBeta?: number;
  policy?: import('./policyTypes').MemoryV1Policy;
};

export type ProcessMessageOutput = {
  nextState: MemoryV1State;
  memoryContext: MemoryContext | null;
  retrievalResult: RetrievalResult;
  salience: SalienceResult;
};

export type EndSessionOutput = {
  nextState: MemoryV1State;
  consolidationResult: ConsolidationResult;
};
