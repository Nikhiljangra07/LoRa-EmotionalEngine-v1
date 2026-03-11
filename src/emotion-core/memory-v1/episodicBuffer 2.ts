import { clamp, safeNumber } from './normalize';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EpisodicEvent = {
  id: string;
  emotionVec: number[];
  salience: number;
  timestampMs: number;
  lockTurnsRemaining: number;
};

export type EpisodicBufferState = {
  events: EpisodicEvent[];
  maxSize: number;
};

// ---------------------------------------------------------------------------
// Local constants (not in MEMORY_V1_CONFIG — episodic-buffer-specific)
// ---------------------------------------------------------------------------

const MAX_EPISODES = 30;
const SURVIVAL_LOCK_TURNS = 5;
const RECENCY_HALF_LIFE_HOURS = 72;
const SALIENCE_LOCK_THRESHOLD = 0.8;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createBuffer(maxSize: number = MAX_EPISODES): EpisodicBufferState {
  return { events: [], maxSize };
}

export function pushEvent(
  state: EpisodicBufferState,
  event: Omit<EpisodicEvent, 'lockTurnsRemaining'>,
  nowMs: number,
): { nextState: EpisodicBufferState; evictedEventId?: string } {
  const safeSalience = clamp(safeNumber(event.salience, 0), 0, 1);

  const lockTurns = safeSalience > SALIENCE_LOCK_THRESHOLD
    ? SURVIVAL_LOCK_TURNS
    : 0;

  const decremented = state.events.map((e) => ({
    ...e,
    lockTurnsRemaining: Math.max(0, e.lockTurnsRemaining - 1),
  }));

  const newEvent: EpisodicEvent = {
    id: event.id,
    emotionVec: event.emotionVec.slice(),
    salience: safeSalience,
    timestampMs: event.timestampMs,
    lockTurnsRemaining: lockTurns,
  };

  const combined = [...decremented, newEvent];

  if (combined.length <= state.maxSize) {
    return { nextState: { events: combined, maxSize: state.maxSize } };
  }

  const unlocked = combined.filter((e) => e.lockTurnsRemaining <= 0);
  const candidates = unlocked.length > 0 ? unlocked : combined;

  const scores = candidates.map((e) => ({
    id: e.id,
    score: computeEvictionScore(e, combined, nowMs),
    timestampMs: e.timestampMs,
  }));

  scores.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.timestampMs - b.timestampMs;
  });

  const evictId = scores[0].id;
  const remaining = combined.filter((e) => e.id !== evictId);

  return {
    nextState: { events: remaining, maxSize: state.maxSize },
    evictedEventId: evictId,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function computeEvictionScore(
  event: EpisodicEvent,
  allEvents: EpisodicEvent[],
  nowMs: number,
): number {
  const sal = clamp(safeNumber(event.salience, 0), 0, 1);
  const recency = computeRecencyFactor(event, nowMs);
  const distinct = computeDistinctiveness(event, allEvents);
  return safeNumber(sal * recency * distinct, 0);
}

function computeRecencyFactor(event: EpisodicEvent, nowMs: number): number {
  const deltaMs = safeNumber(nowMs - event.timestampMs, 0);
  const deltaHours = Math.max(0, deltaMs) / (1000 * 60 * 60);
  const factor = Math.exp(-deltaHours / RECENCY_HALF_LIFE_HOURS);
  return clamp(safeNumber(factor, 0), 0, 1);
}

function computeDistinctiveness(
  event: EpisodicEvent,
  allEvents: EpisodicEvent[],
): number {
  if (allEvents.length <= 1) return 1;

  let minDist = Infinity;
  for (const other of allEvents) {
    if (other.id === event.id) continue;
    const dist = euclideanDistance(event.emotionVec, other.emotionVec);
    if (dist < minDist) minDist = dist;
  }

  if (!Number.isFinite(minDist)) return 0;
  return clamp(minDist, 0, 1);
}

function euclideanDistance(vecA: number[], vecB: number[]): number {
  const len = Math.min(vecA.length, vecB.length);
  let sumSq = 0;
  for (let i = 0; i < len; i++) {
    const a = safeNumber(vecA[i], 0);
    const b = safeNumber(vecB[i], 0);
    const d = a - b;
    sumSq += d * d;
  }
  return safeNumber(Math.sqrt(sumSq), 0);
}
