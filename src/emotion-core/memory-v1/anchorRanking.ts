/**
 * Anchor selection, schema guard, and ranking. Rule-based only; no ML.
 * Replaces "latest createdAt wins" with priority + confidence + recency scoring.
 */

import type { FactAnchor } from './factAnchorTypes';
import type { AnchorScore } from './anchorRelevanceArbiter';

export const MIN_CONFIDENCE = 0.3;
export const MAX_ANCHORS_PER_SLOT = 10;
export const MAX_ANCHORS_PER_MESSAGE = 2;

/** Allowed (type, slot) pairs; anchors with slot not in schema are discarded. */
export const ALLOWED_FACT_SCHEMAS: Record<string, string[]> = {
  deployment_plan: ['launch_date'],
  financial_commitment: ['money_amount'],
  project_stage: ['stage'],
  goal: ['objective', 'exercise', 'diet', 'career_change', 'learning', 'hobby'],
  date_event: [
    'job_interview', 'exam', 'meeting', 'birthday', 'appointment', 'wedding',
    'travel', 'deadline', 'therapy_session', 'graduation',
  ],
  person: ['friend', 'therapist', 'family_member', 'manager', 'partner', 'colleague', 'doctor', 'mentor'],
  preference: ['general_positive', 'general_negative'],
  identity: ['user_name'],
};

export function isSlotAllowed(type: string, slot: string): boolean {
  const slots = ALLOWED_FACT_SCHEMAS[type];
  if (!slots) return false;
  return slots.includes(slot);
}

/** Filter anchors to only allowed (type, slot) per schema. */
export function filterBySchema(anchors: FactAnchor[]): FactAnchor[] {
  return anchors.filter((a) => isSlotAllowed(a.type, a.summary.slot));
}

/** Confidence for ranking; use optional confidence or fall back to extractionConfidence. */
function getConfidence(a: FactAnchor): number {
  if (a.confidence !== undefined && a.confidence >= 0 && a.confidence <= 1) return a.confidence;
  return typeof a.extractionConfidence === 'number' ? a.extractionConfidence : 0.5;
}

/** Priority for ranking; default 2 (explicit). */
function getPriority(a: FactAnchor): number {
  if (typeof a.priority === 'number' && a.priority >= 1 && a.priority <= 3) return a.priority;
  return 2;
}

/** Recency weight: newer = higher, max 5. ageHours = (nowMs - createdAt) / 3600000. */
function recencyWeight(createdAt: number, nowMs: number): number {
  const ageHours = (nowMs - createdAt) / (1000 * 60 * 60);
  return Math.max(0, Math.min(5, 5 - ageHours / 12));
}

/**
 * Score for ranking: priority*10 + confidence*5 + recencyWeight.
 * Higher = stronger anchor (update > explicit > inferred; high confidence wins).
 */
export function anchorScore(a: FactAnchor, nowMs: number): number {
  const priority = getPriority(a);
  const confidence = getConfidence(a);
  const recency = recencyWeight(a.createdAt, nowMs);
  return priority * 10 + confidence * 5 + recency;
}

export interface RankedAnchor {
  anchor: FactAnchor;
  score: number;
  conflict: boolean;
  supersedes?: string;
}

/**
 * Group by (type, slot), score each anchor, pick highest per group.
 * When two+ anchors have confidence > 0.8, flag conflict and set supersedes on winner.
 */
export function rankAnchors(scored: AnchorScore[], nowMs: number): RankedAnchor[] {
  const byKey = new Map<string, AnchorScore[]>();
  for (const s of scored) {
    const key = `${s.anchor.type}|${s.anchor.summary.slot}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(s);
  }

  const results: RankedAnchor[] = [];
  for (const [, group] of byKey) {
    const withScores = group.map((s) => ({
      ...s,
      computedScore: anchorScore(s.anchor, nowMs),
    }));
    withScores.sort((a, b) => b.computedScore - a.computedScore);
    const winner = withScores[0];
    const highConfidence = group.filter((s) => getConfidence(s.anchor) > 0.8);
    const conflict = highConfidence.length >= 2;
    const supersedes = conflict && highConfidence[1] ? highConfidence[1].anchor.anchorId : undefined;

    results.push({
      anchor: winner.anchor,
      score: winner.computedScore,
      conflict,
      supersedes,
    });

    if (process.env.NODE_ENV !== 'test') {
      console.log('[LoRa::AnchorRanking]', {
        slot: winner.anchor.summary.slot,
        candidates: group.length,
        winner: winner.anchor.value ?? winner.anchor.anchorId,
        score: Math.round(winner.computedScore * 10) / 10,
        conflict,
      });
    }
  }
  return results;
}
