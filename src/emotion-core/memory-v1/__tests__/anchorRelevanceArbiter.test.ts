import { scoreAnchors } from '../anchorRelevanceArbiter';
import type { FactAnchor } from '../factAnchorTypes';
import { MAX_ANCHORS_IN_PROMPT } from '../factAnchorTypes';

const NOW = 1_000_000_000;
const VEC = [0.5, 0.5, 0.5];

function futureDate(daysFromNow: number): string {
  return new Date(NOW + daysFromNow * 86_400_000).toISOString();
}

function makeAnchor(overrides: Partial<FactAnchor> = {}): FactAnchor {
  return {
    anchorId: 'a-default',
    userId: 'u1',
    type: 'goal',
    summary: { template: 'goal_active', slot: 'learning' },
    salience: 0.75,
    extractionConfidence: 0.75,
    status: 'confirmed',
    emotionVecAtCreation: [0.5, 0.5, 0.5],
    sessionId: 'sess-1',
    createdAt: NOW - 1000,
    reinforceCount: 2,
    appearsInSessions: 2,
    lastSeenSessionId: 'sess-1',
    ...overrides,
  };
}

describe('scoreAnchors', () => {
  it('ignores quarantined anchors', () => {
    const a = makeAnchor({ status: 'quarantined', reinforceCount: 3 });
    const result = scoreAnchors([a], VEC, NOW, 'B4');
    expect(result).toHaveLength(0);
  });

  it('eligible via upcoming date_event within 7 days', () => {
    const a = makeAnchor({
      anchorId: 'date-1',
      type: 'date_event',
      summary: { template: 'upcoming_event', slot: 'job_interview' },
      date: futureDate(3),
      reinforceCount: 1,
    });
    const result = scoreAnchors([a], VEC, NOW, 'B4');
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].anchor.anchorId).toBe('date-1');
  });

  it('eligible via reinforceCount >= 2', () => {
    const a = makeAnchor({ reinforceCount: 2 });
    const result = scoreAnchors([a], VEC, NOW, 'B4');
    expect(result.length).toBe(1);
  });

  it('ineligible when reinforceCount < 2 and not upcoming date', () => {
    const a = makeAnchor({ reinforceCount: 1 });
    const result = scoreAnchors([a], VEC, NOW, 'B4');
    expect(result).toHaveLength(0);
  });

  it('floor suppression: discards scores below 0.25', () => {
    const a = makeAnchor({
      emotionVecAtCreation: [-1, -1, -1],
      createdAt: 0,
      reinforceCount: 2,
    });
    const result = scoreAnchors([a], [1, 1, 1], NOW, 'B4');
    expect(result).toHaveLength(0);
  });

  it('B0 returns empty', () => {
    const a = makeAnchor({ reinforceCount: 5 });
    expect(scoreAnchors([a], VEC, NOW, 'B0')).toHaveLength(0);
  });

  it('B1 returns empty', () => {
    const a = makeAnchor({ reinforceCount: 5 });
    expect(scoreAnchors([a], VEC, NOW, 'B1')).toHaveLength(0);
  });

  it('B2 returns max 1 and only date_event type', () => {
    const goal = makeAnchor({
      anchorId: 'goal-1',
      type: 'goal',
      reinforceCount: 3,
    });
    const dateAnchor = makeAnchor({
      anchorId: 'date-1',
      type: 'date_event',
      summary: { template: 'upcoming_event', slot: 'exam' },
      date: futureDate(2),
      reinforceCount: 1,
    });
    const result = scoreAnchors([goal, dateAnchor], VEC, NOW, 'B2');
    expect(result.length).toBeLessThanOrEqual(1);
    if (result.length === 1) {
      expect(result[0].anchor.type).toBe('date_event');
    }
  });

  it('B3 returns max 2', () => {
    const anchors = Array.from({ length: 5 }, (_, i) =>
      makeAnchor({ anchorId: `a-${i}`, reinforceCount: 3 }),
    );
    const result = scoreAnchors(anchors, VEC, NOW, 'B3');
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('B4 returns max 3', () => {
    const anchors = Array.from({ length: 5 }, (_, i) =>
      makeAnchor({ anchorId: `a-${i}`, reinforceCount: 3 }),
    );
    const result = scoreAnchors(anchors, VEC, NOW, 'B4');
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('hard ceiling never exceeded (MAX_ANCHORS_IN_PROMPT)', () => {
    const anchors = Array.from({ length: 10 }, (_, i) =>
      makeAnchor({ anchorId: `a-${i}`, reinforceCount: 5 }),
    );
    const result = scoreAnchors(anchors, VEC, NOW, 'B4');
    expect(result.length).toBeLessThanOrEqual(MAX_ANCHORS_IN_PROMPT);
  });

  it('deterministic ordering with equal scores', () => {
    const a1 = makeAnchor({ anchorId: 'first', reinforceCount: 2, createdAt: NOW - 1000 });
    const a2 = makeAnchor({ anchorId: 'second', reinforceCount: 2, createdAt: NOW - 1000 });
    const r1 = scoreAnchors([a1, a2], VEC, NOW, 'B4');
    const r2 = scoreAnchors([a1, a2], VEC, NOW, 'B4');
    expect(r1.map((s) => s.anchor.anchorId)).toEqual(r2.map((s) => s.anchor.anchorId));
    expect(r1[0].anchor.anchorId).toBe('first');
  });

  it('scores contain correct sub-scores', () => {
    const a = makeAnchor({
      emotionVecAtCreation: VEC,
      createdAt: NOW - 1000,
      reinforceCount: 2,
    });
    const result = scoreAnchors([a], VEC, NOW, 'B4');
    expect(result).toHaveLength(1);
    const s = result[0];
    expect(s.emotionalProximity).toBeCloseTo(1, 5);
    expect(s.recencyScore).toBeCloseTo(1 / (1 + 1000 / 100_000_000), 5);
    expect(s.reinforcementScore).toBeCloseTo(0.4, 5);
    expect(s.temporalUrgency).toBe(0);
    expect(s.totalScore).toBeGreaterThan(0);
  });

  it('temporalUrgency = 1 for upcoming date_event', () => {
    const a = makeAnchor({
      type: 'date_event',
      summary: { template: 'upcoming_event', slot: 'meeting' },
      date: futureDate(1),
      reinforceCount: 1,
    });
    const result = scoreAnchors([a], VEC, NOW, 'B4');
    expect(result).toHaveLength(1);
    expect(result[0].temporalUrgency).toBe(1);
  });

  it('date_event beyond 7 days needs reinforceCount >= 2', () => {
    const a = makeAnchor({
      type: 'date_event',
      summary: { template: 'upcoming_event', slot: 'meeting' },
      date: futureDate(10),
      reinforceCount: 1,
    });
    const result = scoreAnchors([a], VEC, NOW, 'B4');
    expect(result).toHaveLength(0);
  });

  it('structured fact (value set) is eligible even with reinforceCount 0', () => {
    const a = makeAnchor({
      anchorId: 'deploy-1',
      type: 'deployment_plan',
      summary: { template: 'deployment_plan', slot: 'launch_date' },
      value: '2026-03-23',
      reinforceCount: 0,
      appearsInSessions: 1,
    });
    const result = scoreAnchors([a], VEC, NOW, 'B4');
    expect(result.length).toBe(1);
    expect(result[0].anchor.type).toBe('deployment_plan');
  });

  it('structured fact bypasses SCORE_FLOOR', () => {
    const a = makeAnchor({
      anchorId: 'deploy-floor',
      type: 'deployment_plan',
      summary: { template: 'deployment_plan', slot: 'launch_date' },
      value: '2026-03-23',
      emotionVecAtCreation: [-1, -1, -1],
      createdAt: 0,
      reinforceCount: 0,
    });
    const result = scoreAnchors([a], [1, 1, 1], NOW, 'B4');
    expect(result.length).toBe(1);
  });

  it('B2 allows structured facts alongside date_event', () => {
    const deploy = makeAnchor({
      anchorId: 'deploy-b2',
      type: 'deployment_plan',
      summary: { template: 'deployment_plan', slot: 'launch_date' },
      value: '2026-03-23',
      reinforceCount: 0,
    });
    const goal = makeAnchor({
      anchorId: 'goal-b2',
      type: 'goal',
      reinforceCount: 3,
    });
    const result = scoreAnchors([deploy, goal], VEC, NOW, 'B2');
    expect(result.length).toBe(1);
    expect(result[0].anchor.type).toBe('deployment_plan');
  });

  it('non-structured anchor with reinforceCount < 2 still ineligible', () => {
    const a = makeAnchor({ reinforceCount: 1 });
    const result = scoreAnchors([a], VEC, NOW, 'B4');
    expect(result).toHaveLength(0);
  });
});
