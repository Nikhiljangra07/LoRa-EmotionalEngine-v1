import type { EkmanDominant } from '../emotion-core/types/analysis.types';

const VALID_FAMILIES: ReadonlySet<string> = new Set([
  'JOY', 'ANGER', 'FEAR', 'SADNESS', 'SURPRISE', 'DISGUST',
]);

const EKMAN_CONFIDENCE_THRESHOLD = 0.35;

export function mapEkmanToDominant(
  dominantFamily: string,
  confidence: number,
): { ekmanDominant: EkmanDominant; ekmanConfidence: number } | undefined {
  if (confidence < EKMAN_CONFIDENCE_THRESHOLD) return undefined;
  if (!VALID_FAMILIES.has(dominantFamily)) return undefined;
  return {
    ekmanDominant: dominantFamily as EkmanDominant,
    ekmanConfidence: confidence,
  };
}

export { EKMAN_CONFIDENCE_THRESHOLD };
