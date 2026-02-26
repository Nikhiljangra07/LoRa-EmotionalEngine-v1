export function bucketConfidence(x?: number | null): 'LOW' | 'MED' | 'HIGH' | null {
  if (x === undefined || x === null || !Number.isFinite(x)) return null;
  if (x < 0.40) return 'LOW';
  if (x <= 0.70) return 'MED';
  return 'HIGH';
}
