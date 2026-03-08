export type DriftSeverity = 'HIGH' | 'MED';

export type DriftFlagCode =
  | 'INJECTION_AT_LOW_BAND'
  | 'OMITTED_FIELDS_VIOLATION'
  | 'SCHEMA_COUNT_OVER_CAP'
  | 'FORBIDDEN_TOKEN'
  | 'EXCESSIVE_INJECTION_RATE'
  | 'OSCILLATION_SPIKE'
  | 'CONFIDENCE_IMPLAUSIBLE';

export type MemoryV1ShadowEvent = {
  tag: 'memory:v1:shadow';
  tsMs: number;
  userId: string;
  band: 'B0' | 'B1' | 'B2' | 'B3' | 'B4';
  policySig: string;
  injected: boolean;
  memoryContext?: {
    sessionPattern?: string;
    confidenceLevel?: string;
    topSchemas?: Array<{
      schemaId: string;
      emotionTrajectory?: string;
      behavioralTendency?: string;
      relevance?: string;
    }>;
  };
};

export type MemoryV1DebugSnapshotEvent = {
  tag: 'memory:v1:debug';
  tsMs: number;
  userId: string;
  band?: 'B0' | 'B1' | 'B2' | 'B3' | 'B4';
  topSchemaIds: string[];
  confidenceBucket: 'LOW' | 'MED' | 'HIGH';
  winnerId?: string | null;
};

export type MemoryV1ShadowReport = {
  totals: {
    events: number;
    users: number;
    injectedCount: number;
    injectedRate: number;
  };
  countsByBand: Record<string, number>;
  countsByPolicySig: Array<{ sig: string; count: number }>;
  confidenceCounts: Record<string, number>;
  topTrajectories: Array<{ label: string; count: number }>;
  topTendencies: Array<{ label: string; count: number }>;
  flags: Array<{ severity: DriftSeverity; code: DriftFlagCode; detail: string }>;
};
