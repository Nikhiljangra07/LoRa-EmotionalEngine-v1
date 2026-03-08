import type { SchemaRecord } from './schemaStore';
import type { EncodedEvent } from './types';
import type { RIFGuardState } from './rifGuard';

export type StoredMemoryV1State = {
  version: 1;
  userId: string;
  savedAtMs: number;
  schemas: SchemaRecord[];
  episodic: EncodedEvent[];
  rifGuard: RIFGuardState;
};

export type MemoryV1Storage = {
  load(userId: string): StoredMemoryV1State | null;
  save(state: StoredMemoryV1State): void;
  getPath(userId: string): string;
};
