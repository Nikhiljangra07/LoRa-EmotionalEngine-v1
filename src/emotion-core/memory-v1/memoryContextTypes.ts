import type { MemoryV1Policy } from './policyTypes';

export type TrajectoryLabel =
  | 'calm-stable'
  | 'escalating-negative'
  | 'volatile'
  | 'recovering'
  | 'unknown';

export type TendencyLabel =
  | 'responds-to-clarification'
  | 'responds-to-validation'
  | 'resists-directiveness'
  | 'needs-structure'
  | 'unknown';

export type GovernedTrajectoryLabel = TrajectoryLabel | 'omitted';
export type GovernedTendencyLabel = TendencyLabel | 'omitted';

export type MemoryContext = {
  topSchemas: Array<{
    schemaId: string;
    emotionTrajectory: GovernedTrajectoryLabel;
    behavioralTendency: GovernedTendencyLabel;
    relevance: 'HIGH' | 'MED' | 'LOW';
  }>;
  sessionPattern: GovernedTrajectoryLabel;
  confidenceLevel: 'HIGH' | 'MED' | 'LOW';
};

export type BuildMemoryContextInput = {
  results: Array<{
    schemaId: string;
    prob: number;
    sim: number;
  }>;
  schemasById: Record<string, {
    schemaId: string;
    trajectoryLabel?: string;
    tendencyLabel?: string;
  }>;
  thetaRetrieve: number;
  cMin: number;
  policy?: MemoryV1Policy;
};
