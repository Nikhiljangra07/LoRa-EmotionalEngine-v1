import type { FactAnchor } from './factAnchorTypes';
import { MAX_ANCHORS_IN_PROMPT } from './factAnchorTypes';
import { cosineSimilarity } from './normalize';

export interface AnchorScore {
  anchor: FactAnchor;
  emotionalProximity: number;
  recencyScore: number;
  reinforcementScore: number;
  temporalUrgency: number;
  totalScore: number;
}

type BandHint = 'B0' | 'B1' | 'B2' | 'B3' | 'B4';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const RECENCY_DIVISOR = 100_000_000;
const SCORE_FLOOR = 0.25;

const W_EMOTION = 0.40;
const W_RECENCY = 0.30;
const W_REINFORCE = 0.20;
const W_TEMPORAL = 0.10;

function isUpcomingWithin7Days(anchor: FactAnchor, now: number): boolean {
  if (anchor.type !== 'date_event' || !anchor.date) return false;
  const dateMs = new Date(anchor.date).getTime();
  if (!Number.isFinite(dateMs)) return false;
  const diff = dateMs - now;
  return diff >= 0 && diff <= SEVEN_DAYS_MS;
}

function isEligible(anchor: FactAnchor, _now: number): boolean {
  if (anchor.type === 'date_event' && anchor.date && isUpcomingWithin7Days(anchor, _now)) {
    return true;
  }
  if (anchor.value !== undefined) return true;
  if (anchor.reinforceCount >= 2) return true;
  return false;
}

function bandLimit(band: BandHint): number {
  switch (band) {
    case 'B0':
    case 'B1':
      return 0;
    case 'B2':
      return 1;
    case 'B3':
      return 2;
    case 'B4':
      return 3;
  }
}

export function scoreAnchors(
  anchors: FactAnchor[],
  currentEmotionVec: number[],
  now: number,
  etvBand: BandHint,
): AnchorScore[] {
  const limit = bandLimit(etvBand);
  if (limit === 0) return [];

  const scored: Array<AnchorScore & { _idx: number }> = [];

  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    if (a.status !== 'confirmed') continue;
    if (!isEligible(a, now)) continue;

    const emotionalProximity = cosineSimilarity(currentEmotionVec, a.emotionVecAtCreation);
    const recencyScore = 1 / (1 + (now - a.createdAt) / RECENCY_DIVISOR);
    const reinforcementScore = Math.min(a.reinforceCount / 5, 1);
    const temporalUrgency = isUpcomingWithin7Days(a, now) ? 1 : 0;

    const totalScore =
      W_EMOTION * emotionalProximity +
      W_RECENCY * recencyScore +
      W_REINFORCE * reinforcementScore +
      W_TEMPORAL * temporalUrgency;

    if (totalScore < SCORE_FLOOR && a.value === undefined) continue;

    if (etvBand === 'B2' && a.type !== 'date_event' && a.value === undefined) continue;

    scored.push({
      anchor: a,
      emotionalProximity,
      recencyScore,
      reinforcementScore,
      temporalUrgency,
      totalScore,
      _idx: i,
    });
  }

  scored.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    return a.anchor.anchorId.localeCompare(b.anchor.anchorId);
  });

  const cap = Math.min(limit, MAX_ANCHORS_IN_PROMPT);
  const result: AnchorScore[] = scored.slice(0, cap).map(({ _idx, ...rest }) => rest);
  return result;
}
