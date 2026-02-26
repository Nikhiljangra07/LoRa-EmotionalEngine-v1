import {
  shouldPromoteAnchor,
  shouldExpireQuarantinedAnchor,
  transitionAnchorStatus,
} from '../anchorLifecycle';
import type { FactAnchor } from '../factAnchorTypes';

function makeAnchor(overrides: Partial<FactAnchor> = {}): FactAnchor {
  return {
    anchorId: 'a1',
    userId: 'u1',
    type: 'goal',
    summary: { template: 'goal_active', slot: 'learning' },
    salience: 0.75,
    extractionConfidence: 0.75,
    status: 'quarantined',
    emotionVecAtCreation: [0.1, 0.2],
    sessionId: 'sess-1',
    createdAt: 1000,
    reinforceCount: 1,
    appearsInSessions: 1,
    lastSeenSessionId: 'sess-1',
    ...overrides,
  };
}

describe('shouldPromoteAnchor', () => {
  it('promotes when reinforceCount >= 2', () => {
    const a = makeAnchor({ reinforceCount: 2 });
    expect(shouldPromoteAnchor(a)).toBe(true);
  });

  it('promotes when reinforceCount >= 3', () => {
    const a = makeAnchor({ reinforceCount: 3 });
    expect(shouldPromoteAnchor(a)).toBe(true);
  });

  it('promotes via high confidence + appearsInSessions >= 2', () => {
    const a = makeAnchor({
      reinforceCount: 1,
      extractionConfidence: 0.80,
      appearsInSessions: 2,
    });
    expect(shouldPromoteAnchor(a)).toBe(true);
  });

  it('does not promote when below all thresholds', () => {
    const a = makeAnchor({
      reinforceCount: 1,
      extractionConfidence: 0.70,
      appearsInSessions: 1,
    });
    expect(shouldPromoteAnchor(a)).toBe(false);
  });

  it('does not promote with high confidence but only 1 session', () => {
    const a = makeAnchor({
      reinforceCount: 1,
      extractionConfidence: 0.85,
      appearsInSessions: 1,
    });
    expect(shouldPromoteAnchor(a)).toBe(false);
  });

  it('does not promote with appearsInSessions >= 2 but low confidence', () => {
    const a = makeAnchor({
      reinforceCount: 1,
      extractionConfidence: 0.79,
      appearsInSessions: 2,
    });
    expect(shouldPromoteAnchor(a)).toBe(false);
  });
});

describe('shouldExpireQuarantinedAnchor', () => {
  it('expires weak quarantined anchor from different session', () => {
    const a = makeAnchor({
      status: 'quarantined',
      reinforceCount: 1,
      appearsInSessions: 1,
      lastSeenSessionId: 'sess-1',
    });
    expect(shouldExpireQuarantinedAnchor(a, 'sess-2')).toBe(true);
  });

  it('does not expire confirmed anchor', () => {
    const a = makeAnchor({
      status: 'confirmed',
      reinforceCount: 1,
      appearsInSessions: 1,
      lastSeenSessionId: 'sess-1',
    });
    expect(shouldExpireQuarantinedAnchor(a, 'sess-2')).toBe(false);
  });

  it('does not expire quarantined anchor with appearsInSessions >= 3', () => {
    const a = makeAnchor({
      status: 'quarantined',
      reinforceCount: 1,
      appearsInSessions: 3,
      lastSeenSessionId: 'sess-1',
    });
    expect(shouldExpireQuarantinedAnchor(a, 'sess-2')).toBe(false);
  });

  it('does not expire reinforced quarantined anchor (reinforceCount > 1)', () => {
    const a = makeAnchor({
      status: 'quarantined',
      reinforceCount: 2,
      appearsInSessions: 1,
      lastSeenSessionId: 'sess-1',
    });
    expect(shouldExpireQuarantinedAnchor(a, 'sess-2')).toBe(false);
  });

  it('does not expire if lastSeenSessionId matches current', () => {
    const a = makeAnchor({
      status: 'quarantined',
      reinforceCount: 1,
      appearsInSessions: 1,
      lastSeenSessionId: 'sess-2',
    });
    expect(shouldExpireQuarantinedAnchor(a, 'sess-2')).toBe(false);
  });
});

describe('transitionAnchorStatus', () => {
  it('transitions quarantined to confirmed when promotable', () => {
    const a = makeAnchor({ status: 'quarantined', reinforceCount: 2 });
    const result = transitionAnchorStatus(a);
    expect(result.status).toBe('confirmed');
  });

  it('returns new object (immutability)', () => {
    const a = makeAnchor({ status: 'quarantined', reinforceCount: 2 });
    const result = transitionAnchorStatus(a);
    expect(result).not.toBe(a);
    expect(a.status).toBe('quarantined');
  });

  it('returns same object when not promotable', () => {
    const a = makeAnchor({ status: 'quarantined', reinforceCount: 1 });
    const result = transitionAnchorStatus(a);
    expect(result).toBe(a);
    expect(result.status).toBe('quarantined');
  });

  it('returns same object when already confirmed', () => {
    const a = makeAnchor({ status: 'confirmed', reinforceCount: 1 });
    const result = transitionAnchorStatus(a);
    expect(result).toBe(a);
  });
});
