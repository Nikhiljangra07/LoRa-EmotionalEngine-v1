// src/emotion-core/etv/sim/fixtures.ts

import type { SessionSummaryV1 } from '../types';

const USER = 'sim-user';
const SESSION_DURATION_MS = 30 * 60 * 1000; // 30 min session
const SESSION_GAP_MS = 5 * 60 * 1000; // 5 min between sessions (normal gap)
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function makeSessions(
  count: number,
  defaults: Partial<SessionSummaryV1>,
  startMs: number = 1_000_000_000_000,
  gapMs: number = SESSION_GAP_MS,
): SessionSummaryV1[] {
  const sessions: SessionSummaryV1[] = [];
  let cursor = startMs;
  for (let i = 0; i < count; i++) {
    const startedAt = cursor;
    const endedAt = startedAt + SESSION_DURATION_MS;
    sessions.push({
      sessionId: `${defaults.sessionId ?? 'sess'}-${i}`,
      userId: USER,
      startedAt,
      endedAt,
      messageCount: 10,
      eivMean: 0.40,
      eivMax: 0.60,
      aviMean: 0.10,
      aviMax: 0.20,
      hasViolation: false,
      ...defaults,
    });
    cursor = endedAt + gapMs;
  }
  return sessions;
}

/**
 * A) Calm, stable sessions. Low EIV, low AVI, no violations.
 */
export function calmStable(n: number): SessionSummaryV1[] {
  return makeSessions(n, {
    sessionId: 'calm',
    eivMean: 0.20,
    eivMax: 0.30,
    aviMean: 0.05,
    aviMax: 0.10,
    hasViolation: false,
    messageCount: 10,
  });
}

/**
 * B) Intense but stable. High EIV, low AVI — should trigger eivRisk penalty.
 */
export function intenseStable(n: number): SessionSummaryV1[] {
  return makeSessions(n, {
    sessionId: 'intense',
    eivMean: 0.85,
    eivMax: 0.92,
    aviMean: 0.05,
    aviMax: 0.10,
    hasViolation: false,
    messageCount: 10,
  });
}

/**
 * C) Moderate intensity, high volatility.
 */
export function volatileModerate(n: number): SessionSummaryV1[] {
  return makeSessions(n, {
    sessionId: 'volatile',
    eivMean: 0.40,
    eivMax: 0.65,
    aviMean: 0.45,
    aviMax: 0.70,
    hasViolation: false,
    messageCount: 10,
  });
}

/**
 * D) Violation sessions — violation every k-th session (default k=3).
 */
export function violationSessions(n: number, k: number = 3): SessionSummaryV1[] {
  const base = makeSessions(n, {
    sessionId: 'viol',
    eivMean: 0.40,
    eivMax: 0.55,
    aviMean: 0.20,
    aviMax: 0.35,
    messageCount: 10,
  });
  return base.map((s, i) => ({
    ...s,
    hasViolation: (i + 1) % k === 0,
  }));
}

/**
 * E) Idle return — 6 sessions, then 30-day gap, then 2 sessions.
 */
export function idleReturnScenario(): SessionSummaryV1[] {
  const START = 1_000_000_000_000;
  const preIdle = makeSessions(6, {
    sessionId: 'idle-pre',
    eivMean: 0.30,
    eivMax: 0.45,
    aviMean: 0.08,
    aviMax: 0.15,
    messageCount: 10,
  }, START);

  const lastPreEnd = preIdle[preIdle.length - 1].endedAt;
  const postIdleStart = lastPreEnd + 30 * ONE_DAY_MS;

  const postIdle = makeSessions(2, {
    sessionId: 'idle-post',
    eivMean: 0.30,
    eivMax: 0.45,
    aviMean: 0.08,
    aviMax: 0.15,
    messageCount: 10,
  }, postIdleStart);

  return [...preIdle, ...postIdle];
}

/**
 * Short-session variant of calmStable — 2-3 messages, should use reduced mass.
 */
export function calmStableShort(n: number): SessionSummaryV1[] {
  return makeSessions(n, {
    sessionId: 'calm-short',
    eivMean: 0.20,
    eivMax: 0.30,
    aviMean: 0.05,
    aviMax: 0.10,
    hasViolation: false,
    messageCount: 2,
  });
}

/**
 * Mixed message-count scenario: alternates short (2 msg) and normal (10 msg).
 */
export function mixedLength(n: number): SessionSummaryV1[] {
  const base = makeSessions(n, {
    sessionId: 'mixed',
    eivMean: 0.30,
    eivMax: 0.45,
    aviMean: 0.10,
    aviMax: 0.20,
    hasViolation: false,
  });
  return base.map((s, i) => ({
    ...s,
    messageCount: i % 2 === 0 ? 2 : 10,
  }));
}
