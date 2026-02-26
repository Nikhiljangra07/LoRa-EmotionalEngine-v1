import { createInMemoryFactAnchorStore } from '../factAnchorStore';
import type { FactAnchorStoreState } from '../factAnchorStoreTypes';
import type { FactAnchor } from '../factAnchorTypes';
import {
  MAX_ANCHORS_CONFIRMED,
  MAX_ANCHORS_QUARANTINED,
} from '../factAnchorTypes';

const store = createInMemoryFactAnchorStore();

const VEC = [0.1, 0.2, 0.3];

function makeAnchor(overrides: Partial<FactAnchor> & { anchorId: string }): FactAnchor {
  return {
    userId: 'u1',
    type: 'goal',
    summary: { template: 'goal_active', slot: 'learning' },
    salience: 0.75,
    extractionConfidence: 0.75,
    status: 'confirmed',
    emotionVecAtCreation: [...VEC],
    sessionId: 'sess-1',
    createdAt: 1000,
    reinforceCount: 1,
    appearsInSessions: 1,
    lastSeenSessionId: 'sess-1',
    ...overrides,
  };
}

function futureDate(nowMs: number, daysAhead: number): string {
  return new Date(nowMs + daysAhead * 86_400_000).toISOString();
}

// =========================================================================
// 1. init
// =========================================================================

describe('init', () => {
  it('returns empty state', () => {
    const s = store.init();
    expect(s.confirmed).toEqual([]);
    expect(s.quarantined).toEqual([]);
    expect(s.sessionAnchorCount).toEqual({});
    expect(s.sessionSeen).toEqual({});
    expect(s.quarantineMeta).toEqual({});
  });
});

// =========================================================================
// 2. Caps & truncation
// =========================================================================

describe('caps & truncation', () => {
  it('per-message cap truncates to 1', () => {
    const s = store.init();
    const a1 = makeAnchor({ anchorId: 'a1' });
    const a2 = makeAnchor({ anchorId: 'a2', summary: { template: 'goal_active', slot: 'exercise' } });
    const { results } = store.upsertFromExtraction(s, {
      userId: 'u1', sessionId: 'sess-1', nowMs: 1000,
      extracted: [a1, a2],
      maxAnchorsPerMessage: 1,
    });
    expect(results.rejectedByCap).toBe(1);
    expect(results.createdConfirmed).toBe(1);
  });

  it('per-session cap truncates to 3 across multiple calls', () => {
    let s = store.init();
    for (let i = 0; i < 5; i++) {
      const a = makeAnchor({
        anchorId: `a-${i}`,
        summary: { template: 'goal_active', slot: (['learning', 'exercise', 'diet', 'hobby', 'career_change'] as const)[i] },
      });
      const { nextState, results } = store.upsertFromExtraction(s, {
        userId: 'u1', sessionId: 'sess-1', nowMs: 1000 + i,
        extracted: [a],
      });
      s = nextState;
      if (i >= 3) {
        expect(results.rejectedByCap).toBe(1);
      }
    }
    expect(s.confirmed.length).toBe(3);
  });

  it('rejectedByCap increments correctly', () => {
    const s = store.init();
    const anchors = Array.from({ length: 5 }, (_, i) =>
      makeAnchor({
        anchorId: `a-${i}`,
        summary: { template: 'goal_active', slot: (['learning', 'exercise', 'diet', 'hobby', 'career_change'] as const)[i] },
      }),
    );
    const { results } = store.upsertFromExtraction(s, {
      userId: 'u1', sessionId: 'sess-1', nowMs: 1000,
      extracted: anchors,
      maxAnchorsPerMessage: 2,
      maxAnchorsPerSession: 2,
    });
    expect(results.rejectedByCap).toBe(3);
  });

  it('upsert with empty extracted returns unchanged state', () => {
    const s = store.init();
    const { nextState, results } = store.upsertFromExtraction(s, {
      userId: 'u1', sessionId: 'sess-1', nowMs: 1000,
      extracted: [],
    });
    expect(nextState).toBe(s);
    expect(results.createdConfirmed).toBe(0);
  });
});

// =========================================================================
// 3. Dedupe & reinforcement
// =========================================================================

describe('dedupe & reinforcement', () => {
  it('same key reinforces confirmed', () => {
    let s = store.init();
    const a = makeAnchor({ anchorId: 'a1' });
    s = store.upsertFromExtraction(s, {
      userId: 'u1', sessionId: 'sess-1', nowMs: 1000, extracted: [a],
    }).nextState;
    expect(s.confirmed[0].reinforceCount).toBe(1);

    const dup = makeAnchor({ anchorId: 'a1-dup' });
    const { nextState, results } = store.upsertFromExtraction(s, {
      userId: 'u1', sessionId: 'sess-2', nowMs: 2000, extracted: [dup],
    });
    expect(results.reinforcedConfirmed).toBe(1);
    expect(results.createdConfirmed).toBe(0);
    expect(nextState.confirmed[0].reinforceCount).toBe(2);
  });

  it('same key reinforces quarantined (promotes since reinforceCount reaches 2)', () => {
    let s = store.init();
    const a = makeAnchor({ anchorId: 'q1', extractionConfidence: 0.55 });
    s = store.upsertFromExtraction(s, {
      userId: 'u1', sessionId: 'sess-1', nowMs: 1000, extracted: [a],
    }).nextState;
    expect(s.quarantined.length).toBe(1);
    expect(s.quarantined[0].reinforceCount).toBe(1);

    const dup = makeAnchor({ anchorId: 'q1-dup', extractionConfidence: 0.55 });
    const { nextState, results } = store.upsertFromExtraction(s, {
      userId: 'u1', sessionId: 'sess-2', nowMs: 2000, extracted: [dup],
    });
    expect(results.reinforcedQuarantined).toBe(1);
    expect(results.promotedToConfirmed).toBe(1);
    expect(nextState.quarantined.length).toBe(0);
    expect(nextState.confirmed[0].reinforceCount).toBe(2);
  });

  it('reinforcement in same session increments reinforceCount but not appearsInSessions', () => {
    let s = store.init();
    const a = makeAnchor({ anchorId: 'a1' });
    s = store.upsertFromExtraction(s, {
      userId: 'u1', sessionId: 'sess-1', nowMs: 1000, extracted: [a],
    }).nextState;

    const dup = makeAnchor({ anchorId: 'a1-dup' });
    const { nextState } = store.upsertFromExtraction(s, {
      userId: 'u1', sessionId: 'sess-1', nowMs: 1001, extracted: [dup],
    });
    expect(nextState.confirmed[0].reinforceCount).toBe(2);
    expect(nextState.confirmed[0].appearsInSessions).toBe(1);
  });

  it('reinforcement across sessions increments both reinforceCount and appearsInSessions', () => {
    let s = store.init();
    const a = makeAnchor({ anchorId: 'a1' });
    s = store.upsertFromExtraction(s, {
      userId: 'u1', sessionId: 'sess-1', nowMs: 1000, extracted: [a],
    }).nextState;

    const dup = makeAnchor({ anchorId: 'a1-dup' });
    const { nextState } = store.upsertFromExtraction(s, {
      userId: 'u1', sessionId: 'sess-2', nowMs: 2000, extracted: [dup],
    });
    expect(nextState.confirmed[0].reinforceCount).toBe(2);
    expect(nextState.confirmed[0].appearsInSessions).toBe(2);
    expect(nextState.confirmed[0].lastSeenSessionId).toBe('sess-2');
  });

  it('anchorKey deduplication uses type+template+slot+date', () => {
    let s = store.init();
    const a1 = makeAnchor({ anchorId: 'a1', type: 'goal', summary: { template: 'goal_active', slot: 'learning' } });
    const a2 = makeAnchor({ anchorId: 'a2', type: 'preference', summary: { template: 'preference_positive', slot: 'learning' } });
    s = store.upsertFromExtraction(s, {
      userId: 'u1', sessionId: 'sess-1', nowMs: 1000, extracted: [a1],
      maxAnchorsPerMessage: 2, maxAnchorsPerSession: 10,
    }).nextState;
    const { nextState } = store.upsertFromExtraction(s, {
      userId: 'u1', sessionId: 'sess-1', nowMs: 1001, extracted: [a2],
      maxAnchorsPerMessage: 2, maxAnchorsPerSession: 10,
    });
    expect(nextState.confirmed.length).toBe(2);
  });
});

// =========================================================================
// 4. Quarantine + promotion
// =========================================================================

describe('quarantine & promotion', () => {
  it('confidence < 0.60 creates quarantined', () => {
    const s = store.init();
    const a = makeAnchor({ anchorId: 'q1', extractionConfidence: 0.55 });
    const { nextState } = store.upsertFromExtraction(s, {
      userId: 'u1', sessionId: 'sess-1', nowMs: 1000, extracted: [a],
    });
    expect(nextState.quarantined.length).toBe(1);
    expect(nextState.quarantined[0].status).toBe('quarantined');
    expect(nextState.confirmed.length).toBe(0);
  });

  it('confidence >= 0.60 creates confirmed', () => {
    const s = store.init();
    const a = makeAnchor({ anchorId: 'c1', extractionConfidence: 0.65 });
    const { nextState } = store.upsertFromExtraction(s, {
      userId: 'u1', sessionId: 'sess-1', nowMs: 1000, extracted: [a],
    });
    expect(nextState.confirmed.length).toBe(1);
    expect(nextState.confirmed[0].status).toBe('confirmed');
  });

  it('promotion requires reinforceCount >= 2 (via upsert reinforcement)', () => {
    let s = store.init();
    const a = makeAnchor({ anchorId: 'q1', extractionConfidence: 0.55 });
    s = store.upsertFromExtraction(s, {
      userId: 'u1', sessionId: 'sess-1', nowMs: 1000, extracted: [a],
    }).nextState;
    expect(s.quarantined.length).toBe(1);

    const dup = makeAnchor({ anchorId: 'q1-dup', extractionConfidence: 0.55 });
    const { nextState, results } = store.upsertFromExtraction(s, {
      userId: 'u1', sessionId: 'sess-2', nowMs: 2000, extracted: [dup],
    });
    expect(results.promotedToConfirmed).toBe(1);
    expect(nextState.quarantined.length).toBe(0);
    expect(nextState.confirmed.length).toBe(1);
    expect(nextState.confirmed[0].status).toBe('confirmed');
  });

  it('promotion via high confidence + appearsInSessions >= 2', () => {
    let s = store.init();
    const a = makeAnchor({ anchorId: 'q1', extractionConfidence: 0.55 });
    s = store.upsertFromExtraction(s, {
      userId: 'u1', sessionId: 'sess-1', nowMs: 1000, extracted: [a],
    }).nextState;

    const reinforced: FactAnchor = {
      ...s.quarantined[0],
      extractionConfidence: 0.80,
      appearsInSessions: 2,
      lastSeenSessionId: 'sess-1',
    };
    s = { ...s, quarantined: [reinforced] };

    const { nextState, report } = store.maintain(s, { sessionId: 'sess-2', nowMs: 3000 });
    expect(report.promotedToConfirmed).toBe(1);
    expect(nextState.confirmed.length).toBe(1);
    expect(nextState.quarantined.length).toBe(0);
  });

  it('does not promote quarantined with low confidence and reinforceCount=1', () => {
    let s = store.init();
    const a = makeAnchor({ anchorId: 'q1', extractionConfidence: 0.55 });
    s = store.upsertFromExtraction(s, {
      userId: 'u1', sessionId: 'sess-1', nowMs: 1000, extracted: [a],
    }).nextState;
    const { nextState } = store.maintain(s, { sessionId: 'sess-2', nowMs: 2000 });
    expect(nextState.confirmed.length).toBe(0);
  });
});

// =========================================================================
// 5. Capacity eviction
// =========================================================================

describe('capacity eviction', () => {
  it('quarantined eviction at > MAX removes oldest', () => {
    let s = store.init();
    for (let i = 0; i < MAX_ANCHORS_QUARANTINED + 2; i++) {
      const a = makeAnchor({
        anchorId: `q-${String(i).padStart(3, '0')}`,
        extractionConfidence: 0.55,
        createdAt: 1000 + i,
        summary: { template: 'goal_active', slot: (['learning', 'exercise', 'diet', 'hobby', 'career_change', 'learning', 'exercise', 'diet', 'hobby', 'career_change', 'learning', 'exercise'] as const)[i % 12] },
        date: `key-${i}`,
      });
      const { nextState, results } = store.upsertFromExtraction(s, {
        userId: 'u1',
        sessionId: `sess-${i}`,
        nowMs: 1000 + i,
        extracted: [a],
      });
      s = nextState;
      if (i >= MAX_ANCHORS_QUARANTINED) {
        expect(results.evictedQuarantined).toBeGreaterThan(0);
      }
    }
    expect(s.quarantined.length).toBe(MAX_ANCHORS_QUARANTINED);
    const ids = s.quarantined.map((a) => a.anchorId);
    expect(ids).not.toContain('q-000');
    expect(ids).not.toContain('q-001');
  });

  it('confirmed eviction at > MAX removes lowest priority', () => {
    let s = store.init();
    for (let i = 0; i < MAX_ANCHORS_CONFIRMED + 2; i++) {
      const a = makeAnchor({
        anchorId: `c-${String(i).padStart(3, '0')}`,
        extractionConfidence: 0.75,
        createdAt: 1000 + i,
        reinforceCount: i === 0 ? 1 : 3,
        appearsInSessions: i === 0 ? 1 : 3,
        summary: { template: 'goal_active', slot: 'learning' },
        date: `key-${i}`,
      });
      const { nextState } = store.upsertFromExtraction(s, {
        userId: 'u1',
        sessionId: `sess-${i}`,
        nowMs: 5000,
        extracted: [a],
      });
      s = nextState;
    }
    expect(s.confirmed.length).toBe(MAX_ANCHORS_CONFIRMED);
    const ids = s.confirmed.map((a) => a.anchorId);
    expect(ids).not.toContain('c-000');
  });

  it('tie-break deterministic by anchorId', () => {
    let s = store.init();
    for (let i = 0; i < MAX_ANCHORS_QUARANTINED + 1; i++) {
      const a = makeAnchor({
        anchorId: `q-${String(i).padStart(3, '0')}`,
        extractionConfidence: 0.55,
        createdAt: 5000,
        summary: { template: 'goal_active', slot: 'learning' },
        date: `key-${i}`,
      });
      s = store.upsertFromExtraction(s, {
        userId: 'u1', sessionId: `sess-${i}`, nowMs: 5000,
        extracted: [a],
      }).nextState;
    }
    expect(s.quarantined.length).toBe(MAX_ANCHORS_QUARANTINED);
    expect(s.quarantined.map((a) => a.anchorId)).not.toContain('q-000');
  });
});

// =========================================================================
// 6. Maintain expiry
// =========================================================================

describe('maintain expiry', () => {
  it('quarantined expires after 3 maintain sessions without reinforcement', () => {
    let s = store.init();
    const a = makeAnchor({ anchorId: 'q1', extractionConfidence: 0.55 });
    s = store.upsertFromExtraction(s, {
      userId: 'u1', sessionId: 'sess-1', nowMs: 1000, extracted: [a],
    }).nextState;
    expect(s.quarantined.length).toBe(1);

    s = store.maintain(s, { sessionId: 'sess-2', nowMs: 2000 }).nextState;
    s = store.maintain(s, { sessionId: 'sess-3', nowMs: 3000 }).nextState;
    expect(s.quarantined.length).toBe(1);

    const { nextState, report } = store.maintain(s, { sessionId: 'sess-4', nowMs: 4000 });
    expect(report.expiredQuarantined).toBe(1);
    expect(nextState.quarantined.length).toBe(0);
  });

  it('reinforced quarantined does not expire', () => {
    let s = store.init();
    const a = makeAnchor({ anchorId: 'q1', extractionConfidence: 0.55 });
    s = store.upsertFromExtraction(s, {
      userId: 'u1', sessionId: 'sess-1', nowMs: 1000, extracted: [a],
    }).nextState;

    s = store.maintain(s, { sessionId: 'sess-2', nowMs: 2000 }).nextState;

    const dup = makeAnchor({ anchorId: 'q1-dup', extractionConfidence: 0.55 });
    s = store.upsertFromExtraction(s, {
      userId: 'u1', sessionId: 'sess-3', nowMs: 3000, extracted: [dup],
    }).nextState;

    s = store.maintain(s, { sessionId: 'sess-3', nowMs: 3000 }).nextState;
    const { nextState } = store.maintain(s, { sessionId: 'sess-4', nowMs: 4000 });
    expect(nextState.quarantined.length).toBe(0);
    expect(nextState.confirmed.length).toBe(1);
  });

  it('maintain is deterministic with same inputs', () => {
    let s = store.init();
    const a = makeAnchor({ anchorId: 'q1', extractionConfidence: 0.55 });
    s = store.upsertFromExtraction(s, {
      userId: 'u1', sessionId: 'sess-1', nowMs: 1000, extracted: [a],
    }).nextState;
    s = store.maintain(s, { sessionId: 'sess-2', nowMs: 2000 }).nextState;

    const r1 = store.maintain(s, { sessionId: 'sess-3', nowMs: 3000 });
    const r2 = store.maintain(s, { sessionId: 'sess-3', nowMs: 3000 });
    expect(r1.nextState.quarantined.length).toBe(r2.nextState.quarantined.length);
    expect(r1.report).toEqual(r2.report);
  });

  it('maintain does not mutate previous state', () => {
    let s = store.init();
    const a = makeAnchor({ anchorId: 'q1', extractionConfidence: 0.55 });
    s = store.upsertFromExtraction(s, {
      userId: 'u1', sessionId: 'sess-1', nowMs: 1000, extracted: [a],
    }).nextState;
    const before = JSON.parse(JSON.stringify(s));
    store.maintain(s, { sessionId: 'sess-2', nowMs: 2000 });
    expect(JSON.parse(JSON.stringify(s))).toEqual(before);
  });
});

// =========================================================================
// 7. getCandidates
// =========================================================================

describe('getCandidates', () => {
  it('returns confirmed only', () => {
    let s = store.init();
    const c = makeAnchor({ anchorId: 'c1', extractionConfidence: 0.75 });
    const q = makeAnchor({ anchorId: 'q1', extractionConfidence: 0.55,
      summary: { template: 'goal_active', slot: 'exercise' },
    });
    s = store.upsertFromExtraction(s, {
      userId: 'u1', sessionId: 'sess-1', nowMs: 1000,
      extracted: [c], maxAnchorsPerMessage: 2, maxAnchorsPerSession: 10,
    }).nextState;
    s = store.upsertFromExtraction(s, {
      userId: 'u1', sessionId: 'sess-1', nowMs: 1001,
      extracted: [q], maxAnchorsPerMessage: 2, maxAnchorsPerSession: 10,
    }).nextState;
    expect(s.confirmed.length).toBe(1);
    expect(s.quarantined.length).toBe(1);
    const candidates = store.getCandidates(s, { nowMs: 2000 });
    expect(candidates.length).toBe(1);
    expect(candidates[0].anchorId).toBe('c1');
  });

  it('ordering: upcoming > reinforced > appears > createdAt > anchorId', () => {
    const nowMs = 1_000_000;
    const s: FactAnchorStoreState = {
      ...store.init(),
      confirmed: [
        makeAnchor({ anchorId: 'b-old', reinforceCount: 5, appearsInSessions: 3, createdAt: 100 }),
        makeAnchor({ anchorId: 'a-new', reinforceCount: 5, appearsInSessions: 3, createdAt: 200 }),
        makeAnchor({
          anchorId: 'c-date', type: 'date_event',
          summary: { template: 'upcoming_event', slot: 'exam' },
          date: futureDate(nowMs, 2),
          reinforceCount: 1, appearsInSessions: 1, createdAt: 50,
        }),
        makeAnchor({ anchorId: 'd-low', reinforceCount: 1, appearsInSessions: 1, createdAt: 300 }),
      ],
    };
    const candidates = store.getCandidates(s, { nowMs });
    expect(candidates[0].anchorId).toBe('c-date');
    expect(candidates[1].anchorId).toBe('a-new');
    expect(candidates[2].anchorId).toBe('b-old');
    expect(candidates[3].anchorId).toBe('d-low');
  });

  it('returns deep copies (mutation does not affect state)', () => {
    const s: FactAnchorStoreState = {
      ...store.init(),
      confirmed: [makeAnchor({ anchorId: 'c1' })],
    };
    const candidates = store.getCandidates(s, { nowMs: 1000 });
    candidates[0].reinforceCount = 999;
    expect(s.confirmed[0].reinforceCount).toBe(1);
  });
});

// =========================================================================
// 8. Purge & export
// =========================================================================

describe('purge & export', () => {
  it('purgeAll empties everything', () => {
    const s = store.purgeAll();
    expect(s.confirmed).toEqual([]);
    expect(s.quarantined).toEqual([]);
    expect(s.sessionAnchorCount).toEqual({});
    expect(s.sessionSeen).toEqual({});
  });

  it('exportAll returns deep copies', () => {
    const s: FactAnchorStoreState = {
      ...store.init(),
      confirmed: [makeAnchor({ anchorId: 'c1' })],
      quarantined: [makeAnchor({ anchorId: 'q1', extractionConfidence: 0.55, status: 'quarantined' })],
    };
    const exp = store.exportAll(s);
    exp.confirmed[0].reinforceCount = 999;
    exp.quarantined[0].reinforceCount = 888;
    expect(s.confirmed[0].reinforceCount).toBe(1);
    expect(s.quarantined[0].reinforceCount).toBe(1);
  });
});

// =========================================================================
// 9. Safety & invariants
// =========================================================================

describe('safety & invariants', () => {
  it('no raw text spans in stored anchors (only template+slot)', () => {
    let s = store.init();
    const a = makeAnchor({ anchorId: 'c1' });
    s = store.upsertFromExtraction(s, {
      userId: 'u1', sessionId: 'sess-1', nowMs: 1000, extracted: [a],
    }).nextState;
    const anchor = s.confirmed[0];
    expect(typeof anchor.summary.template).toBe('string');
    expect(typeof anchor.summary.slot).toBe('string');
    const json = JSON.stringify(anchor);
    expect(json).not.toMatch(/freetext|raw_text|name_span/i);
  });

  it('no NaN or Infinity in numeric fields', () => {
    let s = store.init();
    const a = makeAnchor({ anchorId: 'c1' });
    s = store.upsertFromExtraction(s, {
      userId: 'u1', sessionId: 'sess-1', nowMs: 1000, extracted: [a],
    }).nextState;
    const anchor = s.confirmed[0];
    expect(Number.isFinite(anchor.salience)).toBe(true);
    expect(Number.isFinite(anchor.extractionConfidence)).toBe(true);
    expect(Number.isFinite(anchor.reinforceCount)).toBe(true);
    expect(Number.isFinite(anchor.appearsInSessions)).toBe(true);
    expect(Number.isFinite(anchor.createdAt)).toBe(true);
    for (const v of anchor.emotionVecAtCreation) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('deterministic behavior across repeated runs', () => {
    function run(): FactAnchorStoreState {
      let s = store.init();
      const anchors = [
        makeAnchor({ anchorId: 'a1', summary: { template: 'goal_active', slot: 'learning' } }),
        makeAnchor({ anchorId: 'a2', summary: { template: 'goal_active', slot: 'exercise' } }),
      ];
      for (const a of anchors) {
        s = store.upsertFromExtraction(s, {
          userId: 'u1', sessionId: 'sess-1', nowMs: 1000, extracted: [a],
          maxAnchorsPerMessage: 1, maxAnchorsPerSession: 5,
        }).nextState;
      }
      s = store.maintain(s, { sessionId: 'sess-2', nowMs: 2000 }).nextState;
      return s;
    }
    const r1 = run();
    const r2 = run();
    expect(r1.confirmed.length).toBe(r2.confirmed.length);
    expect(r1.confirmed.map((a) => a.anchorId)).toEqual(r2.confirmed.map((a) => a.anchorId));
  });

  it('upsert does not mutate input state', () => {
    const s = store.init();
    const a = makeAnchor({ anchorId: 'c1' });
    const before = JSON.parse(JSON.stringify(s));
    store.upsertFromExtraction(s, {
      userId: 'u1', sessionId: 'sess-1', nowMs: 1000, extracted: [a],
    });
    expect(JSON.parse(JSON.stringify(s))).toEqual(before);
  });

  it('emotionVec in stored anchor is independent copy', () => {
    const vec = [0.5, 0.6, 0.7];
    const a = makeAnchor({ anchorId: 'c1', emotionVecAtCreation: vec });
    let s = store.init();
    s = store.upsertFromExtraction(s, {
      userId: 'u1', sessionId: 'sess-1', nowMs: 1000, extracted: [a],
    }).nextState;
    vec[0] = 999;
    expect(s.confirmed[0].emotionVecAtCreation[0]).toBe(0.5);
  });
});

// =========================================================================
// 10. Multiple operations build up state
// =========================================================================

describe('multi-operation flows', () => {
  it('multiple upserts build up confirmed list', () => {
    let s = store.init();
    const slots: Array<'learning' | 'exercise' | 'diet'> = ['learning', 'exercise', 'diet'];
    for (let i = 0; i < 3; i++) {
      const a = makeAnchor({
        anchorId: `c-${i}`,
        summary: { template: 'goal_active', slot: slots[i] },
      });
      s = store.upsertFromExtraction(s, {
        userId: 'u1', sessionId: `sess-${i}`, nowMs: 1000 + i, extracted: [a],
      }).nextState;
    }
    expect(s.confirmed.length).toBe(3);
  });

  it('sessionAnchorCount tracks correctly across sessions', () => {
    let s = store.init();
    s = store.upsertFromExtraction(s, {
      userId: 'u1', sessionId: 'sess-1', nowMs: 1000,
      extracted: [makeAnchor({ anchorId: 'a1' })],
    }).nextState;
    s = store.upsertFromExtraction(s, {
      userId: 'u1', sessionId: 'sess-1', nowMs: 1001,
      extracted: [makeAnchor({ anchorId: 'a2', summary: { template: 'goal_active', slot: 'exercise' } })],
    }).nextState;
    s = store.upsertFromExtraction(s, {
      userId: 'u1', sessionId: 'sess-2', nowMs: 2000,
      extracted: [makeAnchor({ anchorId: 'a3', summary: { template: 'goal_active', slot: 'diet' } })],
    }).nextState;
    expect(s.sessionAnchorCount['sess-1']).toBe(2);
    expect(s.sessionAnchorCount['sess-2']).toBe(1);
  });

  it('maintain after purge is no-op', () => {
    const s = store.purgeAll();
    const { nextState, report } = store.maintain(s, { sessionId: 'sess-1', nowMs: 1000 });
    expect(report.expiredQuarantined).toBe(0);
    expect(report.promotedToConfirmed).toBe(0);
    expect(nextState.confirmed.length).toBe(0);
    expect(nextState.quarantined.length).toBe(0);
  });

  it('multiple maintain calls with same session are idempotent for sessionSeen', () => {
    let s = store.init();
    s = store.maintain(s, { sessionId: 'sess-1', nowMs: 1000 }).nextState;
    s = store.maintain(s, { sessionId: 'sess-1', nowMs: 1001 }).nextState;
    expect(Object.keys(s.sessionSeen).length).toBe(1);
  });

  it('export after multiple operations shows correct state', () => {
    let s = store.init();
    s = store.upsertFromExtraction(s, {
      userId: 'u1', sessionId: 'sess-1', nowMs: 1000,
      extracted: [makeAnchor({ anchorId: 'c1', extractionConfidence: 0.75 })],
      maxAnchorsPerMessage: 2, maxAnchorsPerSession: 10,
    }).nextState;
    s = store.upsertFromExtraction(s, {
      userId: 'u1', sessionId: 'sess-1', nowMs: 1001,
      extracted: [makeAnchor({ anchorId: 'q1', extractionConfidence: 0.55, summary: { template: 'goal_active', slot: 'exercise' } })],
      maxAnchorsPerMessage: 2, maxAnchorsPerSession: 10,
    }).nextState;
    const exp = store.exportAll(s);
    expect(exp.confirmed.length).toBe(1);
    expect(exp.quarantined.length).toBe(1);
  });

  it('quarantineMeta is cleaned up after promotion', () => {
    let s = store.init();
    const a = makeAnchor({ anchorId: 'q1', extractionConfidence: 0.55 });
    s = store.upsertFromExtraction(s, {
      userId: 'u1', sessionId: 'sess-1', nowMs: 1000, extracted: [a],
    }).nextState;
    expect(s.quarantineMeta['q1']).toBeDefined();

    const dup = makeAnchor({ anchorId: 'q1-dup', extractionConfidence: 0.55 });
    s = store.upsertFromExtraction(s, {
      userId: 'u1', sessionId: 'sess-2', nowMs: 2000, extracted: [dup],
    }).nextState;
    expect(s.quarantineMeta['q1']).toBeUndefined();
    expect(s.confirmed.length).toBe(1);
  });
});
