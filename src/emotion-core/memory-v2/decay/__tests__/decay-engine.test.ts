import type { SessionFingerprint, SessionSummary } from '../../types';
import {
  isVisible,
  assignImportance,
  touchAccess,
} from '../decay-engine';

// ──────────────────────────────────────────────────────
// Test helpers
// ──────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function makeFP(overrides: Partial<{
  importanceScore: number;
  accessCount: number;
  lastAccessedDaysAgo: number;
}>): SessionFingerprint {
  const now = Date.now();
  const daysAgo = overrides.lastAccessedDaysAgo ?? 0;

  return {
    sessionId: 'session_001',
    userId: 'user_001',
    timestamp: '2026-03-01T10:00:00Z',
    eivCurve: [0.3, 0.5, 0.7],
    peakIntensity: 0.7,
    peakTurn: 2,
    resolution: true,
    emotionalFingerprint: {
      primary: 'fear',
      undertones: ['tension', 'dread'],
      intensity: 0.7,
      contextCategory: 'career',
      relationalTone: 'collaborative',
    },
    decisionPattern: {
      topicRevisits: 1,
      decisionReached: true,
      avoidanceSignals: ['financial_risk'],
      primaryTension: 'security_vs_growth',
    },
    styleSnapshot: { avgWordsPerMessage: 15, questionRatio: 0.2, directness: 0.7 },
    importanceScore: overrides.importanceScore ?? 5,
    lastAccessed: new Date(now - daysAgo * MS_PER_DAY).toISOString(),
    accessCount: overrides.accessCount ?? 0,
  };
}

function makeSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    primaryTopic: overrides.primaryTopic ?? 'User asked a casual question about weekend plans.',
    keyFacts: overrides.keyFacts ?? ['User mentioned wanting to try a new restaurant'],
    emotionalArc: overrides.emotionalArc ?? {
      start: 'relaxed and conversational',
      middle: 'mildly curious',
      end: 'satisfied',
    },
    causeExpressionLink: overrides.causeExpressionLink ?? {
      cause: 'boredom on a quiet afternoon',
      expression: 'light chatting',
    },
    currentDirection: overrides.currentDirection ?? null,
    unresolved: overrides.unresolved ?? [],
  };
}

// ──────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────

describe('isVisible (fog logic)', () => {
  const now = Date.now();

  it('visible: accessed recently (within 30 days)', () => {
    const fp = makeFP({ lastAccessedDaysAgo: 5, importanceScore: 3, accessCount: 1 });
    expect(isVisible(fp, now)).toBe(true);
  });

  it('visible: high importance (> 7) even if old', () => {
    const fp = makeFP({ lastAccessedDaysAgo: 60, importanceScore: 9, accessCount: 1 });
    expect(isVisible(fp, now)).toBe(true);
  });

  it('visible: high access count (> 5) even if old and low importance', () => {
    const fp = makeFP({ lastAccessedDaysAgo: 60, importanceScore: 3, accessCount: 8 });
    expect(isVisible(fp, now)).toBe(true);
  });

  it('fogged: old + low importance + low access count', () => {
    const fp = makeFP({ lastAccessedDaysAgo: 45, importanceScore: 3, accessCount: 2 });
    expect(isVisible(fp, now)).toBe(false);
  });

  it('fogged: 31 days old + low importance + low access count', () => {
    // 31 days is NOT < 30, so it's fogged
    const fp = makeFP({ lastAccessedDaysAgo: 31, importanceScore: 5, accessCount: 3 });
    expect(isVisible(fp, now)).toBe(false);
  });

  it('visible: exactly importance 8 (> 7)', () => {
    const fp = makeFP({ lastAccessedDaysAgo: 100, importanceScore: 8, accessCount: 0 });
    expect(isVisible(fp, now)).toBe(true);
  });

  it('fogged: importance exactly 7 (not > 7)', () => {
    const fp = makeFP({ lastAccessedDaysAgo: 45, importanceScore: 7, accessCount: 3 });
    expect(isVisible(fp, now)).toBe(false);
  });

  it('fogged: access count exactly 5 (not > 5)', () => {
    const fp = makeFP({ lastAccessedDaysAgo: 45, importanceScore: 3, accessCount: 5 });
    expect(isVisible(fp, now)).toBe(false);
  });

  it('visible: access count 6 (> 5)', () => {
    const fp = makeFP({ lastAccessedDaysAgo: 45, importanceScore: 3, accessCount: 6 });
    expect(isVisible(fp, now)).toBe(true);
  });
});

describe('assignImportance', () => {
  describe('life anchors (8-10)', () => {
    it('breakup summary → 8+', () => {
      const summary = makeSummary({
        primaryTopic: 'User processing a breakup after three-year relationship ended.',
        keyFacts: ['Girlfriend ended the relationship', 'Three years together'],
        emotionalArc: {
          start: 'shocked and grieving',
          middle: 'painful self-recognition',
          end: 'raw and vulnerable',
        },
      });
      expect(assignImportance(summary)).toBeGreaterThanOrEqual(8);
    });

    it('job loss summary → 8+', () => {
      const summary = makeSummary({
        primaryTopic: 'User was fired from their position today.',
        keyFacts: ['User was laid off without warning', 'No severance package'],
      });
      expect(assignImportance(summary)).toBeGreaterThanOrEqual(8);
    });

    it('self-harm disclosure → 8+', () => {
      const summary = makeSummary({
        primaryTopic: 'User disclosed thoughts of self-harm.',
        keyFacts: ['User mentioned wanting to hurt myself'],
        emotionalArc: {
          start: 'numb',
          middle: 'disclosed suicidal ideation',
          end: 'slightly more open',
        },
      });
      expect(assignImportance(summary)).toBeGreaterThanOrEqual(8);
    });

    it('multiple life anchor keywords → 9-10', () => {
      const summary = makeSummary({
        primaryTopic: 'User dealing with divorce and job loss simultaneously.',
        keyFacts: ['Divorce finalized', 'Laid off same week', 'Grief over lost life'],
      });
      expect(assignImportance(summary)).toBeGreaterThanOrEqual(9);
    });
  });

  describe('recurring patterns (5-7)', () => {
    it('avoidance pattern → 5-7', () => {
      const summary = makeSummary({
        primaryTopic: 'User discussing recurring avoidance of difficult conversations.',
        keyFacts: ['User keeps avoiding conflict with partner'],
        emotionalArc: {
          start: 'frustrated',
          middle: 'anxious about confrontation',
          end: 'still deflecting',
        },
      });
      const score = assignImportance(summary);
      expect(score).toBeGreaterThanOrEqual(5);
      expect(score).toBeLessThanOrEqual(7);
    });

    it('career decision → 5-7', () => {
      const summary = makeSummary({
        primaryTopic: 'User at a crossroads about career change.',
        keyFacts: ['Torn between staying and leaving', 'Decision looming'],
      });
      const score = assignImportance(summary);
      expect(score).toBeGreaterThanOrEqual(5);
      expect(score).toBeLessThanOrEqual(7);
    });
  });

  describe('passing states (1-4)', () => {
    it('casual question → 1-3', () => {
      const summary = makeSummary({
        primaryTopic: 'User asked about weekend plans.',
        keyFacts: ['Mentioned a restaurant'],
      });
      const score = assignImportance(summary);
      expect(score).toBeGreaterThanOrEqual(1);
      expect(score).toBeLessThanOrEqual(3);
    });

    it('minor frustration → 1-4', () => {
      const summary = makeSummary({
        primaryTopic: 'User vented about a bad commute.',
        keyFacts: ['Traffic was terrible', 'Late to a meeting'],
        emotionalArc: {
          start: 'annoyed',
          middle: 'venting',
          end: 'calmed down',
        },
      });
      const score = assignImportance(summary);
      expect(score).toBeGreaterThanOrEqual(1);
      expect(score).toBeLessThanOrEqual(4);
    });
  });

  it('never returns below 1 or above 10', () => {
    const minimal = makeSummary({ primaryTopic: 'Hi.', keyFacts: [] });
    expect(assignImportance(minimal)).toBeGreaterThanOrEqual(1);

    const extreme = makeSummary({
      primaryTopic: 'Breakup, divorce, job loss, self-harm, death, abuse, trauma.',
      keyFacts: ['Fired', 'Suicidal', 'Diagnosed with cancer'],
    });
    expect(assignImportance(extreme)).toBeLessThanOrEqual(10);
  });
});

describe('touchAccess', () => {
  it('increments accessCount', () => {
    const fp = makeFP({ accessCount: 3 });
    const touched = touchAccess(fp);
    expect(touched.accessCount).toBe(4);
  });

  it('updates lastAccessed to approximately now', () => {
    const fp = makeFP({ lastAccessedDaysAgo: 30 });
    const before = Date.now();
    const touched = touchAccess(fp);
    const after = Date.now();

    const touchedMs = new Date(touched.lastAccessed).getTime();
    expect(touchedMs).toBeGreaterThanOrEqual(before);
    expect(touchedMs).toBeLessThanOrEqual(after);
  });

  it('does not mutate the original fingerprint', () => {
    const fp = makeFP({ accessCount: 2 });
    const original = fp.accessCount;
    touchAccess(fp);
    expect(fp.accessCount).toBe(original);
  });

  it('lifts the fog (fogged → visible after touch)', () => {
    const now = Date.now();
    // Create a fogged fingerprint: old, low importance, low access
    const fp = makeFP({ lastAccessedDaysAgo: 60, importanceScore: 3, accessCount: 2 });
    expect(isVisible(fp, now)).toBe(false); // fogged

    const touched = touchAccess(fp);
    expect(isVisible(touched, now)).toBe(true); // fog lifted
  });
});
