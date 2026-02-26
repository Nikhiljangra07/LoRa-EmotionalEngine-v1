import type {
  BuildMemoryContextInput,
  MemoryContext,
  TrajectoryLabel,
  TendencyLabel,
  GovernedTrajectoryLabel,
  GovernedTendencyLabel,
} from './memoryContextTypes';
import type { MemoryV1Policy } from './policyTypes';

const VALID_TRAJECTORIES: ReadonlySet<string> = new Set<TrajectoryLabel>([
  'calm-stable',
  'escalating-negative',
  'volatile',
  'recovering',
  'unknown',
]);

const VALID_TENDENCIES: ReadonlySet<string> = new Set<TendencyLabel>([
  'responds-to-clarification',
  'responds-to-validation',
  'resists-directiveness',
  'needs-structure',
  'unknown',
]);

const TOP_K = 3;

export function buildMemoryContext(
  input: BuildMemoryContextInput,
): MemoryContext | null {
  const { results, schemasById, thetaRetrieve, cMin, policy } = input;

  if (policy && !policy.allowPromptInjection) return null;

  if (results.length === 0) return null;

  let bestSim = -Infinity;
  let bestProb = -Infinity;
  for (const r of results) {
    if (r.sim > bestSim) bestSim = r.sim;
    if (r.prob > bestProb) bestProb = r.prob;
  }

  if (!Number.isFinite(bestSim) || bestSim < thetaRetrieve) return null;
  if (!Number.isFinite(bestProb) || bestProb < cMin) return null;

  const confidenceLevel: MemoryContext['confidenceLevel'] =
    bestProb >= 0.60 ? 'HIGH' : bestProb >= 0.40 ? 'MED' : 'LOW';

  const sorted = [...results].sort((a, b) => {
    if (a.prob !== b.prob) return b.prob - a.prob;
    return a.schemaId.localeCompare(b.schemaId);
  });

  const maxSchemas = policy ? policy.maxSchemasInPrompt : TOP_K;
  const top = sorted.slice(0, Math.min(TOP_K, maxSchemas));

  const topSchemas = top.map((r) => {
    const meta = schemasById[r.schemaId];
    const trajectory: GovernedTrajectoryLabel =
      policy && !policy.allowTrajectoryLabel
        ? 'omitted'
        : sanitizeTrajectory(meta?.trajectoryLabel);
    const tendency: GovernedTendencyLabel =
      policy && !policy.allowTendencyLabel
        ? 'omitted'
        : sanitizeTendency(meta?.tendencyLabel);
    return {
      schemaId: r.schemaId,
      emotionTrajectory: trajectory,
      behavioralTendency: tendency,
      relevance: mapRelevance(r.prob),
    };
  });

  const sessionPattern: GovernedTrajectoryLabel =
    policy && !policy.allowSessionPattern
      ? 'omitted'
      : ('unknown' as TrajectoryLabel);

  return {
    topSchemas,
    sessionPattern,
    confidenceLevel,
  };
}

function sanitizeTrajectory(label: string | undefined): TrajectoryLabel {
  if (label !== undefined && VALID_TRAJECTORIES.has(label)) {
    return label as TrajectoryLabel;
  }
  return 'unknown';
}

function sanitizeTendency(label: string | undefined): TendencyLabel {
  if (label !== undefined && VALID_TENDENCIES.has(label)) {
    return label as TendencyLabel;
  }
  return 'unknown';
}

function mapRelevance(prob: number): 'HIGH' | 'MED' | 'LOW' {
  if (prob >= 0.50) return 'HIGH';
  if (prob >= 0.25) return 'MED';
  return 'LOW';
}
