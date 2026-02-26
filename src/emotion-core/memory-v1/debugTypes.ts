export type MemoryV1DebugSnapshot = {
  tag: 'memory:v1:debug';
  userId: string;
  sessionId?: string;
  messageId?: string;

  mode: 'baseline' | 'enhanced';
  wroteEpisode: boolean;
  noMatch: boolean;
  winnerSchemaId: string | null;
  topSchemaIds: string[];
  sessionPattern: string | null;
  confidenceLevel: 'LOW' | 'MED' | 'HIGH' | null;
  bandHint: 'B0' | 'B1' | 'B2' | 'B3' | 'B4' | null;
};
