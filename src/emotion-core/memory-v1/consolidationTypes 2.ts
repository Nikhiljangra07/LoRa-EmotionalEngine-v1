import type { SchemaRecord } from './schemaStore';

export type ConsolidationEpisode = {
  id: string;
  emotionVec: number[];
  salience: number;
};

export type CSchema = SchemaRecord & {
  sessionCount: number;
};

export type ConsolidationInput = {
  nowMs: number;
  episodes: ConsolidationEpisode[];
  schemas: CSchema[];
  mode: 'baseline' | 'enhanced';
};

export type ConsolidationResult = {
  updatedSchemas: CSchema[];
  createdSchemaIds: string[];
  mergedPairs: Array<{ fromId: string; intoId: string }>;
  prunedSchemaIds: string[];
  episodeAssignments: Array<{ eventId: string; schemaId: string }>;
  noveltyFlag: boolean;
};
