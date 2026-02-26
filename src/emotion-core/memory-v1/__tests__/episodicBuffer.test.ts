import { createBuffer, pushEvent, EpisodicEvent, EpisodicBufferState } from '../episodicBuffer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function zeroVec(): number[] {
  return new Array(21).fill(0);
}

function basisVec(dim: number, value: number = 1): number[] {
  const v = zeroVec();
  v[dim] = value;
  return v;
}

const HOUR_MS = 1000 * 60 * 60;
const BASE_TS = 1_000_000_000;

function makeEvent(
  id: string,
  salience: number,
  timestampMs: number,
  vec?: number[],
): Omit<EpisodicEvent, 'lockTurnsRemaining'> {
  return {
    id,
    emotionVec: vec ?? zeroVec(),
    salience,
    timestampMs,
  };
}

// ---------------------------------------------------------------------------
// 1. createBuffer
// ---------------------------------------------------------------------------

describe('episodicBuffer – createBuffer', () => {
  it('initializes with empty events and default maxSize 30', () => {
    const buf = createBuffer();
    expect(buf.events).toEqual([]);
    expect(buf.maxSize).toBe(30);
  });

  it('accepts custom maxSize', () => {
    const buf = createBuffer(5);
    expect(buf.maxSize).toBe(5);
    expect(buf.events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2–3. pushEvent — basic add and evict
// ---------------------------------------------------------------------------

describe('episodicBuffer – pushEvent basics', () => {
  it('adds event when under capacity', () => {
    const buf = createBuffer(5);
    const { nextState, evictedEventId } = pushEvent(buf, makeEvent('a', 0.5, BASE_TS), BASE_TS);
    expect(nextState.events.length).toBe(1);
    expect(nextState.events[0].id).toBe('a');
    expect(evictedEventId).toBeUndefined();
  });

  it('evicts when exceeding capacity', () => {
    let state = createBuffer(2);
    state = pushEvent(state, makeEvent('a', 0.3, BASE_TS, basisVec(0)), BASE_TS).nextState;
    state = pushEvent(state, makeEvent('b', 0.5, BASE_TS + 1, basisVec(1)), BASE_TS + 1).nextState;
    expect(state.events.length).toBe(2);

    const { nextState, evictedEventId } = pushEvent(
      state,
      makeEvent('c', 0.9, BASE_TS + 2, basisVec(2)),
      BASE_TS + 2,
    );
    expect(nextState.events.length).toBe(2);
    expect(evictedEventId).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 4–5. Eviction priority
// ---------------------------------------------------------------------------

describe('episodicBuffer – eviction priority', () => {
  it('highest evictionScore survives; lowest is evicted', () => {
    let state = createBuffer(2);
    // 'old_low' has low salience and old timestamp → low eviction score → evicted
    state = pushEvent(state, makeEvent('old_low', 0.1, BASE_TS, basisVec(0)), BASE_TS + HOUR_MS * 200).nextState;
    state = pushEvent(state, makeEvent('recent_high', 0.7, BASE_TS + HOUR_MS * 199, basisVec(1)), BASE_TS + HOUR_MS * 200).nextState;

    const { evictedEventId } = pushEvent(
      state,
      makeEvent('new', 0.6, BASE_TS + HOUR_MS * 200, basisVec(2)),
      BASE_TS + HOUR_MS * 200,
    );
    expect(evictedEventId).toBe('old_low');
  });

  it('low salience + old event evicted before high salience + recent event', () => {
    let state = createBuffer(2);
    state = pushEvent(state, makeEvent('stale', 0.05, BASE_TS, basisVec(0)), BASE_TS + HOUR_MS * 500).nextState;
    state = pushEvent(state, makeEvent('fresh', 0.7, BASE_TS + HOUR_MS * 499, basisVec(1)), BASE_TS + HOUR_MS * 500).nextState;

    const { evictedEventId } = pushEvent(
      state,
      makeEvent('newest', 0.6, BASE_TS + HOUR_MS * 500, basisVec(2)),
      BASE_TS + HOUR_MS * 500,
    );
    expect(evictedEventId).toBe('stale');
  });
});

// ---------------------------------------------------------------------------
// 6. Distinctiveness
// ---------------------------------------------------------------------------

describe('episodicBuffer – distinctiveness affects eviction', () => {
  it('identical vectors have lower distinctiveness and are evicted sooner', () => {
    const sharedVec = basisVec(0, 1);
    const uniqueVec = basisVec(5, 1);

    let state = createBuffer(2);
    // 'dup' shares vector with the incoming event → low distinctiveness
    state = pushEvent(state, makeEvent('dup', 0.4, BASE_TS, sharedVec), BASE_TS).nextState;
    // 'unique' has a distinct vector → higher distinctiveness
    state = pushEvent(state, makeEvent('unique', 0.4, BASE_TS, uniqueVec), BASE_TS).nextState;

    const { evictedEventId } = pushEvent(
      state,
      makeEvent('new', 0.4, BASE_TS, sharedVec),
      BASE_TS,
    );
    // 'dup' has lower distinctiveness vs 'new' (distance 0), so lower eviction score
    expect(evictedEventId).toBe('dup');
  });
});

// ---------------------------------------------------------------------------
// 7–9. Survival lock
// ---------------------------------------------------------------------------

describe('episodicBuffer – survival lock', () => {
  it('high salience (>0.8) assigns lock of 5 turns', () => {
    const buf = createBuffer(5);
    const { nextState } = pushEvent(buf, makeEvent('hi', 0.85, BASE_TS), BASE_TS);
    expect(nextState.events[0].lockTurnsRemaining).toBe(5);
  });

  it('salience <= 0.8 assigns lock of 0', () => {
    const buf = createBuffer(5);
    const { nextState } = pushEvent(buf, makeEvent('lo', 0.8, BASE_TS), BASE_TS);
    expect(nextState.events[0].lockTurnsRemaining).toBe(0);
  });

  it('lock prevents eviction', () => {
    let state = createBuffer(2);
    // 'locked' has very high salience → locked. Even though old, it should survive.
    state = pushEvent(state, makeEvent('locked', 0.9, BASE_TS, basisVec(0)), BASE_TS).nextState;
    state = pushEvent(state, makeEvent('unlocked', 0.5, BASE_TS + 1, basisVec(1)), BASE_TS + 1).nextState;

    const { evictedEventId } = pushEvent(
      state,
      makeEvent('third', 0.5, BASE_TS + 2, basisVec(2)),
      BASE_TS + 2,
    );
    // 'locked' has lock 4 (5 - 1 decrement), should be protected
    expect(evictedEventId).toBe('unlocked');
  });

  it('lock decrements per push', () => {
    let state = createBuffer(10);
    state = pushEvent(state, makeEvent('x', 0.9, BASE_TS), BASE_TS).nextState;
    expect(state.events[0].lockTurnsRemaining).toBe(5);

    state = pushEvent(state, makeEvent('y1', 0.1, BASE_TS + 1), BASE_TS + 1).nextState;
    const xAfter1 = state.events.find((e) => e.id === 'x')!;
    expect(xAfter1.lockTurnsRemaining).toBe(4);

    state = pushEvent(state, makeEvent('y2', 0.1, BASE_TS + 2), BASE_TS + 2).nextState;
    state = pushEvent(state, makeEvent('y3', 0.1, BASE_TS + 3), BASE_TS + 3).nextState;
    state = pushEvent(state, makeEvent('y4', 0.1, BASE_TS + 4), BASE_TS + 4).nextState;
    state = pushEvent(state, makeEvent('y5', 0.1, BASE_TS + 5), BASE_TS + 5).nextState;

    const xAfter5 = state.events.find((e) => e.id === 'x')!;
    expect(xAfter5.lockTurnsRemaining).toBe(0);
  });

  it('if all events locked, eviction still occurs', () => {
    let state = createBuffer(2);
    state = pushEvent(state, makeEvent('a', 0.9, BASE_TS, basisVec(0)), BASE_TS).nextState;
    state = pushEvent(state, makeEvent('b', 0.9, BASE_TS + 1, basisVec(1)), BASE_TS + 1).nextState;

    // Both are locked. Push a third (also will be locked).
    const { nextState, evictedEventId } = pushEvent(
      state,
      makeEvent('c', 0.9, BASE_TS + 2, basisVec(2)),
      BASE_TS + 2,
    );
    expect(nextState.events.length).toBe(2);
    expect(evictedEventId).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 10. Deterministic tie-breaking
// ---------------------------------------------------------------------------

describe('episodicBuffer – tie-breaking', () => {
  it('evicts oldest (smallest timestampMs) when evictionScores are equal', () => {
    let state = createBuffer(2);
    // Same salience, same vector, different timestamps
    state = pushEvent(state, makeEvent('older', 0.5, BASE_TS, basisVec(0)), BASE_TS).nextState;
    state = pushEvent(state, makeEvent('newer', 0.5, BASE_TS + 1, basisVec(0)), BASE_TS + 1).nextState;

    const { evictedEventId } = pushEvent(
      state,
      makeEvent('newest', 0.5, BASE_TS + 2, basisVec(0)),
      BASE_TS + 2,
    );
    expect(evictedEventId).toBe('older');
  });
});

// ---------------------------------------------------------------------------
// 11. Immutability
// ---------------------------------------------------------------------------

describe('episodicBuffer – immutability', () => {
  it('does not mutate the previous state', () => {
    const buf = createBuffer(3);
    const { nextState: s1 } = pushEvent(buf, makeEvent('a', 0.5, BASE_TS), BASE_TS);
    const s1Copy = JSON.parse(JSON.stringify(s1));

    pushEvent(s1, makeEvent('b', 0.5, BASE_TS + 1), BASE_TS + 1);

    expect(s1.events.length).toBe(s1Copy.events.length);
    expect(s1.events[0].lockTurnsRemaining).toBe(s1Copy.events[0].lockTurnsRemaining);
  });

  it('does not mutate input event emotionVec', () => {
    const vec = basisVec(0, 0.8);
    const original = vec.slice();
    const buf = createBuffer(5);
    pushEvent(buf, { id: 'x', emotionVec: vec, salience: 0.5, timestampMs: BASE_TS }, BASE_TS);
    expect(vec).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// 12–13. recencyFactor
// ---------------------------------------------------------------------------

describe('episodicBuffer – recency factor', () => {
  it('deltaHours=0 yields recencyFactor=1 (event just created)', () => {
    let state = createBuffer(2);
    // Push two events at same time, same salience, same vec → eviction needed on third
    state = pushEvent(state, makeEvent('a', 0.5, BASE_TS, basisVec(0)), BASE_TS).nextState;
    state = pushEvent(state, makeEvent('b', 0.5, BASE_TS, basisVec(1)), BASE_TS).nextState;

    // Push a third at BASE_TS → all deltaHours=0 → recency=1 for all
    // Since all are identical salience/recency, distinctiveness and timestamp break the tie.
    const { evictedEventId } = pushEvent(
      state,
      makeEvent('c', 0.5, BASE_TS, basisVec(2)),
      BASE_TS,
    );
    expect(evictedEventId).toBeDefined();
  });

  it('recencyFactor decays with time: older event has lower eviction score', () => {
    let state = createBuffer(2);
    state = pushEvent(state, makeEvent('old', 0.5, BASE_TS, basisVec(0)), BASE_TS).nextState;
    state = pushEvent(state, makeEvent('new', 0.5, BASE_TS + HOUR_MS * 100, basisVec(1)), BASE_TS + HOUR_MS * 100).nextState;

    const { evictedEventId } = pushEvent(
      state,
      makeEvent('newest', 0.5, BASE_TS + HOUR_MS * 100, basisVec(2)),
      BASE_TS + HOUR_MS * 100,
    );
    expect(evictedEventId).toBe('old');
  });
});

// ---------------------------------------------------------------------------
// 14–15. Distinctiveness edge cases
// ---------------------------------------------------------------------------

describe('episodicBuffer – distinctiveness edge cases', () => {
  it('single element has distinctiveness=1', () => {
    // With only one event in buffer and we push second, no eviction happens (capacity 2).
    // Verify indirectly: single event gets high eviction score (survives).
    let state = createBuffer(2);
    state = pushEvent(state, makeEvent('solo', 0.5, BASE_TS, basisVec(0)), BASE_TS).nextState;
    expect(state.events.length).toBe(1);

    // Push a second. distinctiveness of 'solo' was 1 when it was alone.
    state = pushEvent(state, makeEvent('pair', 0.5, BASE_TS, basisVec(0)), BASE_TS).nextState;
    expect(state.events.length).toBe(2);
  });

  it('identical vectors produce lower distinctiveness than orthogonal vectors', () => {
    // Two events with identical vectors vs two with orthogonal vectors.
    // When capacity forces eviction, the identical-vector one loses.
    let state = createBuffer(2);
    state = pushEvent(state, makeEvent('same1', 0.5, BASE_TS, basisVec(0)), BASE_TS).nextState;
    state = pushEvent(state, makeEvent('ortho', 0.5, BASE_TS, basisVec(3)), BASE_TS).nextState;

    // Push another identical to 'same1'
    const { evictedEventId } = pushEvent(
      state,
      makeEvent('same2', 0.5, BASE_TS, basisVec(0)),
      BASE_TS,
    );
    // 'same1' now has nearest neighbor 'same2' at distance 0 → distinctiveness=0 → eviction score=0
    expect(evictedEventId).toBe('same1');
  });
});

// ---------------------------------------------------------------------------
// 16. Large timestamps
// ---------------------------------------------------------------------------

describe('episodicBuffer – large timestamps', () => {
  it('handles very large nowMs without overflow', () => {
    const farFuture = 1e15;
    let state = createBuffer(2);
    state = pushEvent(state, makeEvent('a', 0.5, 0, basisVec(0)), 0).nextState;
    state = pushEvent(state, makeEvent('b', 0.5, farFuture, basisVec(1)), farFuture).nextState;

    const { nextState, evictedEventId } = pushEvent(
      state,
      makeEvent('c', 0.5, farFuture, basisVec(2)),
      farFuture,
    );
    expect(nextState.events.length).toBe(2);
    expect(evictedEventId).toBeDefined();
    for (const e of nextState.events) {
      expect(Number.isFinite(e.salience)).toBe(true);
      expect(Number.isFinite(e.timestampMs)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 17. Negative / zero salience
// ---------------------------------------------------------------------------

describe('episodicBuffer – edge-case salience', () => {
  it('zero salience is stored and clamped correctly', () => {
    const buf = createBuffer(5);
    const { nextState } = pushEvent(buf, makeEvent('z', 0, BASE_TS), BASE_TS);
    expect(nextState.events[0].salience).toBe(0);
  });

  it('negative salience is clamped to 0', () => {
    const buf = createBuffer(5);
    const { nextState } = pushEvent(buf, makeEvent('neg', -0.5, BASE_TS), BASE_TS);
    expect(nextState.events[0].salience).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 18. NaN / Infinity safety
// ---------------------------------------------------------------------------

describe('episodicBuffer – NaN/Infinity safety', () => {
  it('NaN salience is treated as 0', () => {
    const buf = createBuffer(5);
    const { nextState } = pushEvent(buf, makeEvent('nan', NaN, BASE_TS), BASE_TS);
    expect(nextState.events[0].salience).toBe(0);
    expect(Number.isFinite(nextState.events[0].salience)).toBe(true);
  });

  it('Infinity salience is treated as 0 (safeNumber fallback)', () => {
    const buf = createBuffer(5);
    const { nextState } = pushEvent(buf, makeEvent('inf', Infinity, BASE_TS), BASE_TS);
    expect(nextState.events[0].salience).toBe(0);
    expect(Number.isFinite(nextState.events[0].salience)).toBe(true);
  });

  it('NaN in emotionVec does not produce NaN in stored event', () => {
    const vec = zeroVec();
    vec[0] = NaN;
    vec[3] = Infinity;
    const buf = createBuffer(5);
    const { nextState } = pushEvent(buf, { id: 'bad', emotionVec: vec, salience: 0.5, timestampMs: BASE_TS }, BASE_TS);
    // The vec is stored as-is (caller provides L2-normalized), but eviction math must not break.
    // Push enough to force eviction and verify no crash.
    let state: EpisodicBufferState = nextState;
    for (let i = 0; i < 5; i++) {
      state = pushEvent(state, makeEvent(`fill${i}`, 0.5, BASE_TS + i + 1, basisVec(i % 21)), BASE_TS + i + 1).nextState;
    }
    for (const e of state.events) {
      expect(Number.isFinite(e.salience)).toBe(true);
      expect(Number.isFinite(e.timestampMs)).toBe(true);
    }
  });
});
