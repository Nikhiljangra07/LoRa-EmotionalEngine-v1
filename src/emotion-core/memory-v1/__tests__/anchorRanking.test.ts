import type { FactAnchor } from '../factAnchorTypes';
import type { AnchorScore } from '../anchorRelevanceArbiter';
import {
  anchorScore,
  rankAnchors,
  filterBySchema,
  isSlotAllowed,
  ALLOWED_FACT_SCHEMAS,
  MIN_CONFIDENCE,
  MAX_ANCHORS_PER_SLOT,
} from '../anchorRanking';

const NOW = 1700000000000;
const VEC = [0.5, 0.5, 0.5];

function makeAnchor(overrides: Partial<FactAnchor> & { anchorId: string }): FactAnchor {
  return {
    userId: 'u1',
    type: 'deployment_plan',
    summary: { template: 'deployment_plan', slot: 'launch_date' },
    value: '2026-03-20',
    salience: 0.9,
    extractionConfidence: 0.9,
    status: 'confirmed',
    emotionVecAtCreation: [...VEC],
    sessionId: 's1',
    createdAt: NOW - 86400000,
    reinforceCount: 1,
    appearsInSessions: 1,
    lastSeenSessionId: 's1',
    ...overrides,
  };
}

function toScored(anchor: FactAnchor): AnchorScore {
  return { anchor, emotionalProximity: 0.5, recencyScore: 0.5, reinforcementScore: 0.2, temporalUrgency: 0, totalScore: 0.5 };
}

describe('anchorRanking', () => {
  describe('isSlotAllowed / filterBySchema', () => {
    it('allows deployment_plan.launch_date', () => {
      expect(isSlotAllowed('deployment_plan', 'launch_date')).toBe(true);
    });

    it('rejects slot not in schema for type', () => {
      expect(isSlotAllowed('deployment_plan', 'unknown_slot')).toBe(false);
      expect(isSlotAllowed('goal', 'launch_date')).toBe(false);
    });

    it('invalid schema anchor is discarded by filterBySchema', () => {
      const allowed = filterBySchema([
        makeAnchor({ anchorId: 'a1', type: 'deployment_plan', summary: { template: 'deployment_plan', slot: 'launch_date' } }),
        makeAnchor({ anchorId: 'a2', type: 'deployment_plan', summary: { template: 'deployment_plan', slot: 'unknown_slot' } } as any),
      ]);
      expect(allowed.length).toBe(1);
      expect(allowed[0].anchorId).toBe('a1');
    });
  });

  describe('anchorScore', () => {
    it('update anchor (priority 3) scores higher than explicit (priority 2)', () => {
      const explicit = makeAnchor({ anchorId: 'e1', confidence: 0.9, sourceType: 'explicit', priority: 2 });
      const update = makeAnchor({ anchorId: 'u1', confidence: 1.0, sourceType: 'update', priority: 3 });
      const scoreExplicit = anchorScore(explicit, NOW);
      const scoreUpdate = anchorScore(update, NOW);
      expect(scoreUpdate).toBeGreaterThan(scoreExplicit);
    });

    it('explicit anchor beats inferred (lower confidence and priority)', () => {
      const explicit = makeAnchor({ anchorId: 'e1', confidence: 0.9, sourceType: 'explicit', priority: 2 });
      const inferred = makeAnchor({ anchorId: 'i1', confidence: 0.4, sourceType: 'inferred', priority: 1 });
      expect(anchorScore(explicit, NOW)).toBeGreaterThan(anchorScore(inferred, NOW));
    });

    it('older explicit beats newer inferred when explicit has higher base score', () => {
      const olderExplicit = makeAnchor({
        anchorId: 'e1',
        confidence: 0.9,
        sourceType: 'explicit',
        priority: 2,
        createdAt: NOW - 48 * 3600000,
      });
      const newerInferred = makeAnchor({
        anchorId: 'i1',
        confidence: 0.4,
        sourceType: 'inferred',
        priority: 1,
        createdAt: NOW - 3600000,
      });
      expect(anchorScore(olderExplicit, NOW)).toBeGreaterThan(anchorScore(newerInferred, NOW));
    });
  });

  describe('rankAnchors', () => {
    it('update anchor overrides explicit anchor for same slot', () => {
      const explicit = makeAnchor({
        anchorId: 'e1',
        value: '2026-03-20',
        confidence: 0.9,
        sourceType: 'explicit',
        priority: 2,
        createdAt: NOW - 86400000,
      });
      const update = makeAnchor({
        anchorId: 'u1',
        value: '2026-03-08',
        confidence: 1.0,
        sourceType: 'update',
        priority: 3,
        createdAt: NOW - 3600000,
      });
      const ranked = rankAnchors([toScored(explicit), toScored(update)], NOW);
      expect(ranked.length).toBe(1);
      expect(ranked[0].anchor.value).toBe('2026-03-08');
      expect(ranked[0].anchor.sourceType).toBe('update');
    });

    it('explicit anchor beats inferred when both same slot', () => {
      const explicit = makeAnchor({
        anchorId: 'e1',
        value: '2026-03-20',
        confidence: 0.9,
        sourceType: 'explicit',
        priority: 2,
      });
      const inferred = makeAnchor({
        anchorId: 'i1',
        value: '2026-03-25',
        confidence: 0.4,
        sourceType: 'inferred',
        priority: 1,
      });
      const ranked = rankAnchors([toScored(inferred), toScored(explicit)], NOW);
      expect(ranked.length).toBe(1);
      expect(ranked[0].anchor.value).toBe('2026-03-20');
    });

    it('conflicting anchors flagged when two high-confidence same slot', () => {
      const a1 = makeAnchor({
        anchorId: 'a1',
        value: '2026-03-20',
        confidence: 0.9,
        sourceType: 'explicit',
        priority: 2,
        createdAt: NOW - 86400000,
      });
      const a2 = makeAnchor({
        anchorId: 'a2',
        value: '2026-04-15',
        confidence: 0.85,
        sourceType: 'explicit',
        priority: 2,
        createdAt: NOW - 3600000,
      });
      const ranked = rankAnchors([toScored(a1), toScored(a2)], NOW);
      expect(ranked.length).toBe(1);
      expect(ranked[0].conflict).toBe(true);
      expect(ranked[0].supersedes).toBeDefined();
    });
  });

  describe('constants', () => {
    it('MIN_CONFIDENCE is 0.3', () => expect(MIN_CONFIDENCE).toBe(0.3));
    it('MAX_ANCHORS_PER_SLOT is 10', () => expect(MAX_ANCHORS_PER_SLOT).toBe(10));
    it('ALLOWED_FACT_SCHEMAS has deployment_plan.launch_date', () => {
      expect(ALLOWED_FACT_SCHEMAS.deployment_plan).toContain('launch_date');
    });
  });
});
