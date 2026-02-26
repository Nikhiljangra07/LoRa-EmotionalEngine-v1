import {
  createMemoryV1,
  processMessage,
  endSession,
} from '../memoryV1Engine';
import { encodeEvent } from '../eventEncoder';
import type { EncoderInput } from '../types';
import type { MemoryV1State } from '../memoryV1EngineTypes';
import type { SchemaRecord } from '../schemaStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_TS = 1_000_000_000;

const HIGH_EIV_INPUT: EncoderInput = {
  eivValue: 0.8,
  avi: 0.6,
  arousalScore: 0.5,
  valenceScore: 0.3,
  expressionStrength: 0.4,
  dominantEmotion: 'JOY',
};

const LOW_EIV_INPUT: EncoderInput = {
  eivValue: 0.01,
  avi: 0.01,
};

function seedSchema(
  state: MemoryV1State,
  schemaId: string,
  input: EncoderInput,
): MemoryV1State {
  const encoded = encodeEvent(input);
  const schema: SchemaRecord = {
    schemaId,
    centroid: encoded.emotionVec,
    salienceWeight: 0.5,
    episodeCount: 5,
    retrievalBias: 0,
    createdAt: BASE_TS,
    lastUpdatedAt: BASE_TS,
  };
  return {
    ...state,
    schemas: {
      ...state.schemas,
      schemas: [...state.schemas.schemas, schema],
    },
  };
}

// ---------------------------------------------------------------------------
// 1. Initial state is empty
// ---------------------------------------------------------------------------

describe('memoryV1Engine – createMemoryV1', () => {
  it('creates empty state with correct userId', () => {
    const s = createMemoryV1('user-1');
    expect(s.userId).toBe('user-1');
    expect(s.episodic.events).toEqual([]);
    expect(s.schemas.schemas).toEqual([]);
    expect(s.schemas.userId).toBe('user-1');
    expect(s.rifGuard.recentWinners).toEqual([]);
    expect(s.rifGuard.cooldownRemaining).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. processMessage without salience write
// ---------------------------------------------------------------------------

describe('memoryV1Engine – low salience', () => {
  it('does not add episode when salience below floor', () => {
    const s = createMemoryV1('u');
    const { nextState, salience } = processMessage(s, {
      encoderInput: LOW_EIV_INPUT,
      eventId: 'e1',
      timestampMs: BASE_TS,
    });
    expect(salience.shouldWrite).toBe(false);
    expect(nextState.episodic.events.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. processMessage with salience write
// ---------------------------------------------------------------------------

describe('memoryV1Engine – high salience', () => {
  it('adds episode when salience above floor', () => {
    const s = createMemoryV1('u');
    const { nextState, salience } = processMessage(s, {
      encoderInput: HIGH_EIV_INPUT,
      eventId: 'e1',
      timestampMs: BASE_TS,
    });
    expect(salience.shouldWrite).toBe(true);
    expect(nextState.episodic.events.length).toBe(1);
    expect(nextState.episodic.events[0].id).toBe('e1');
  });
});

// ---------------------------------------------------------------------------
// 4. retrievalResult returned
// ---------------------------------------------------------------------------

describe('memoryV1Engine – retrieval result', () => {
  it('returns noMatch when no schemas exist', () => {
    const s = createMemoryV1('u');
    const { retrievalResult } = processMessage(s, {
      encoderInput: HIGH_EIV_INPUT,
      eventId: 'e1',
      timestampMs: BASE_TS,
    });
    expect(retrievalResult.noMatch).toBe(true);
  });

  it('returns match when schema centroid is identical to query', () => {
    let s = createMemoryV1('u');
    s = seedSchema(s, 'seed', HIGH_EIV_INPUT);
    const { retrievalResult } = processMessage(s, {
      encoderInput: HIGH_EIV_INPUT,
      eventId: 'e1',
      timestampMs: BASE_TS,
    });
    expect(retrievalResult.noMatch).toBe(false);
    expect(retrievalResult.winnerId).toBe('seed');
    expect(retrievalResult.confidence).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 5. memoryContext null when no schemas
// ---------------------------------------------------------------------------

describe('memoryV1Engine – memoryContext', () => {
  it('returns null when no schemas', () => {
    const s = createMemoryV1('u');
    const { memoryContext } = processMessage(s, {
      encoderInput: HIGH_EIV_INPUT,
      eventId: 'e1',
      timestampMs: BASE_TS,
    });
    expect(memoryContext).toBeNull();
  });

  it('returns context when schema matches', () => {
    let s = createMemoryV1('u');
    s = seedSchema(s, 'seed', HIGH_EIV_INPUT);
    const { memoryContext } = processMessage(s, {
      encoderInput: HIGH_EIV_INPUT,
      eventId: 'e1',
      timestampMs: BASE_TS,
    });
    expect(memoryContext).not.toBeNull();
    expect(memoryContext!.topSchemas.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 6. RIF bias updated across calls
// ---------------------------------------------------------------------------

describe('memoryV1Engine – RIF bias evolution', () => {
  it('winner retrievalBias increases after retrieval', () => {
    let s = createMemoryV1('u');
    s = seedSchema(s, 'seed', HIGH_EIV_INPUT);
    const biasBefore = s.schemas.schemas.find((x) => x.schemaId === 'seed')!.retrievalBias;

    const { nextState } = processMessage(s, {
      encoderInput: HIGH_EIV_INPUT,
      eventId: 'e1',
      timestampMs: BASE_TS,
    });
    const biasAfter = nextState.schemas.schemas.find((x) => x.schemaId === 'seed')!.retrievalBias;
    expect(biasAfter).toBeGreaterThan(biasBefore);
  });
});

// ---------------------------------------------------------------------------
// 7. rifGuard state evolves
// ---------------------------------------------------------------------------

describe('memoryV1Engine – rifGuard', () => {
  it('recentWinners grows across calls with matching schema', () => {
    let s = createMemoryV1('u');
    s = seedSchema(s, 'seed', HIGH_EIV_INPUT);

    const r1 = processMessage(s, {
      encoderInput: HIGH_EIV_INPUT,
      eventId: 'e1',
      timestampMs: BASE_TS,
    });
    expect(r1.nextState.rifGuard.recentWinners.length).toBe(1);

    const r2 = processMessage(r1.nextState, {
      encoderInput: HIGH_EIV_INPUT,
      eventId: 'e2',
      timestampMs: BASE_TS + 1,
    });
    expect(r2.nextState.rifGuard.recentWinners.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 8. No mutation of previous state
// ---------------------------------------------------------------------------

describe('memoryV1Engine – immutability', () => {
  it('processMessage does not mutate input state', () => {
    let s = createMemoryV1('u');
    s = seedSchema(s, 'seed', HIGH_EIV_INPUT);
    const snap = JSON.parse(JSON.stringify(s));

    processMessage(s, {
      encoderInput: HIGH_EIV_INPUT,
      eventId: 'e1',
      timestampMs: BASE_TS,
    });

    expect(s.episodic.events.length).toBe(snap.episodic.events.length);
    expect(s.schemas.schemas.length).toBe(snap.schemas.schemas.length);
    expect(s.rifGuard.recentWinners.length).toBe(snap.rifGuard.recentWinners.length);
  });

  it('endSession does not mutate input state', () => {
    let s = createMemoryV1('u');
    const r = processMessage(s, {
      encoderInput: HIGH_EIV_INPUT,
      eventId: 'e1',
      timestampMs: BASE_TS,
    });
    const stateBeforeEnd = r.nextState;
    const episodeCountBefore = stateBeforeEnd.episodic.events.length;

    endSession(stateBeforeEnd, BASE_TS + 1000);

    expect(stateBeforeEnd.episodic.events.length).toBe(episodeCountBefore);
  });
});

// ---------------------------------------------------------------------------
// 9. endSession clears episodic
// ---------------------------------------------------------------------------

describe('memoryV1Engine – endSession', () => {
  it('clears episodic buffer', () => {
    let s = createMemoryV1('u');
    const r1 = processMessage(s, {
      encoderInput: HIGH_EIV_INPUT,
      eventId: 'e1',
      timestampMs: BASE_TS,
    });
    expect(r1.nextState.episodic.events.length).toBe(1);

    const { nextState } = endSession(r1.nextState, BASE_TS + 1000);
    expect(nextState.episodic.events.length).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 10. endSession updates schemas
  // ---------------------------------------------------------------------------

  it('creates schemas from episodes during consolidation', () => {
    let s = createMemoryV1('u');
    for (let i = 0; i < 3; i++) {
      const r = processMessage(s, {
        encoderInput: HIGH_EIV_INPUT,
        eventId: `e${i}`,
        timestampMs: BASE_TS + i,
      });
      s = r.nextState;
    }
    expect(s.schemas.schemas.length).toBe(0);

    const { nextState, consolidationResult } = endSession(s, BASE_TS + 100);
    expect(nextState.schemas.schemas.length).toBeGreaterThan(0);
    expect(consolidationResult.createdSchemaIds.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 11. noveltyFlag flows through
// ---------------------------------------------------------------------------

describe('memoryV1Engine – noveltyFlag', () => {
  it('consolidation noveltyFlag is true when schemas created', () => {
    let s = createMemoryV1('u');
    const r = processMessage(s, {
      encoderInput: HIGH_EIV_INPUT,
      eventId: 'e1',
      timestampMs: BASE_TS,
    });
    const { consolidationResult } = endSession(r.nextState, BASE_TS + 1000);
    expect(consolidationResult.noveltyFlag).toBe(true);
  });

  it('consolidation noveltyFlag is false when no new schemas', () => {
    let s = createMemoryV1('u');
    s = seedSchema(s, 'seed', HIGH_EIV_INPUT);
    const r = processMessage(s, {
      encoderInput: HIGH_EIV_INPUT,
      eventId: 'e1',
      timestampMs: BASE_TS,
    });
    const { consolidationResult } = endSession(r.nextState, BASE_TS + 1000);
    expect(consolidationResult.noveltyFlag).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 12. Determinism
// ---------------------------------------------------------------------------

describe('memoryV1Engine – determinism', () => {
  it('identical inputs produce identical outputs', () => {
    const run = () => {
      let s = createMemoryV1('u');
      s = seedSchema(s, 'seed', HIGH_EIV_INPUT);
      const r = processMessage(s, {
        encoderInput: HIGH_EIV_INPUT,
        eventId: 'e1',
        timestampMs: BASE_TS,
      });
      return r;
    };
    const a = run();
    const b = run();
    expect(a.salience).toEqual(b.salience);
    expect(a.retrievalResult).toEqual(b.retrievalResult);
    expect(a.nextState.episodic).toEqual(b.nextState.episodic);
    expect(a.nextState.rifGuard).toEqual(b.nextState.rifGuard);
  });
});

// ---------------------------------------------------------------------------
// 13. No NaN propagation
// ---------------------------------------------------------------------------

describe('memoryV1Engine – NaN safety', () => {
  it('no NaN in output even with NaN encoder inputs', () => {
    const s = createMemoryV1('u');
    const { salience, retrievalResult, nextState } = processMessage(s, {
      encoderInput: {
        eivValue: NaN,
        avi: NaN,
        arousalScore: NaN,
        valenceScore: NaN,
      },
      eventId: 'e1',
      timestampMs: BASE_TS,
    });
    expect(Number.isFinite(salience.salience)).toBe(true);
    expect(Number.isFinite(retrievalResult.confidence)).toBe(true);
    for (const ev of nextState.episodic.events) {
      for (const v of ev.emotionVec) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 14. Single schema lifecycle
// ---------------------------------------------------------------------------

describe('memoryV1Engine – lifecycle', () => {
  it('create → write episodes → consolidate → retrieve', () => {
    let s = createMemoryV1('u');

    for (let i = 0; i < 3; i++) {
      const r = processMessage(s, {
        encoderInput: HIGH_EIV_INPUT,
        eventId: `e${i}`,
        timestampMs: BASE_TS + i,
      });
      s = r.nextState;
    }
    expect(s.episodic.events.length).toBe(3);
    expect(s.schemas.schemas.length).toBe(0);

    const { nextState: afterEnd } = endSession(s, BASE_TS + 100);
    expect(afterEnd.episodic.events.length).toBe(0);
    expect(afterEnd.schemas.schemas.length).toBeGreaterThan(0);

    const { retrievalResult } = processMessage(afterEnd, {
      encoderInput: HIGH_EIV_INPUT,
      eventId: 'e_post',
      timestampMs: BASE_TS + 200,
    });
    expect(retrievalResult.noMatch).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 15. Multiple messages produce stable behavior
// ---------------------------------------------------------------------------

describe('memoryV1Engine – multi-message stability', () => {
  it('10 sequential messages do not crash and produce finite outputs', () => {
    let s = createMemoryV1('u');
    s = seedSchema(s, 'seed', HIGH_EIV_INPUT);

    for (let i = 0; i < 10; i++) {
      const { nextState, salience, retrievalResult } = processMessage(s, {
        encoderInput: { ...HIGH_EIV_INPUT, eivValue: 0.5 + i * 0.03 },
        eventId: `msg_${i}`,
        timestampMs: BASE_TS + i * 100,
      });
      expect(Number.isFinite(salience.salience)).toBe(true);
      expect(Number.isFinite(retrievalResult.confidence)).toBe(true);
      s = nextState;
    }
    expect(s.episodic.events.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 16. retrievalBias preserved between calls
// ---------------------------------------------------------------------------

describe('memoryV1Engine – bias persistence', () => {
  it('retrievalBias accumulates across multiple processMessage calls', () => {
    let s = createMemoryV1('u');
    s = seedSchema(s, 'seed', HIGH_EIV_INPUT);

    const r1 = processMessage(s, {
      encoderInput: HIGH_EIV_INPUT,
      eventId: 'e1',
      timestampMs: BASE_TS,
    });
    const bias1 = r1.nextState.schemas.schemas.find((x) => x.schemaId === 'seed')!.retrievalBias;

    const r2 = processMessage(r1.nextState, {
      encoderInput: HIGH_EIV_INPUT,
      eventId: 'e2',
      timestampMs: BASE_TS + 1,
    });
    const bias2 = r2.nextState.schemas.schemas.find((x) => x.schemaId === 'seed')!.retrievalBias;

    expect(bias2).toBeGreaterThan(bias1);
  });
});

// ---------------------------------------------------------------------------
// 17. Guard cooldown persists across state transitions
// ---------------------------------------------------------------------------

describe('memoryV1Engine – guard cooldown', () => {
  it('rifGuard persists through endSession', () => {
    let s = createMemoryV1('u');
    s = seedSchema(s, 'seed', HIGH_EIV_INPUT);

    for (let i = 0; i < 3; i++) {
      const r = processMessage(s, {
        encoderInput: HIGH_EIV_INPUT,
        eventId: `e${i}`,
        timestampMs: BASE_TS + i,
      });
      s = r.nextState;
    }
    const guardBefore = s.rifGuard;

    const { nextState } = endSession(s, BASE_TS + 1000);
    expect(nextState.rifGuard).toEqual(guardBefore);
  });
});

// ---------------------------------------------------------------------------
// 18. Salience output returned
// ---------------------------------------------------------------------------

describe('memoryV1Engine – salience output', () => {
  it('salience result has all required fields', () => {
    const s = createMemoryV1('u');
    const { salience } = processMessage(s, {
      encoderInput: HIGH_EIV_INPUT,
      eventId: 'e1',
      timestampMs: BASE_TS,
    });
    expect(typeof salience.salience).toBe('number');
    expect(typeof salience.shouldWrite).toBe('boolean');
    expect(['NONE', 'VIOLATION', 'COLLAPSE']).toContain(salience.overrideReason);
    expect(salience.salience).toBeGreaterThanOrEqual(0);
    expect(salience.salience).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 19. memoryContext is categorical only
// ---------------------------------------------------------------------------

describe('memoryV1Engine – context categorical', () => {
  it('memoryContext output contains no floats in serialized form', () => {
    let s = createMemoryV1('u');
    s = seedSchema(s, 'seed', HIGH_EIV_INPUT);

    const { memoryContext } = processMessage(s, {
      encoderInput: HIGH_EIV_INPUT,
      eventId: 'e1',
      timestampMs: BASE_TS,
    });
    expect(memoryContext).not.toBeNull();
    const json = JSON.stringify(memoryContext);
    expect(json).not.toMatch(/\d+\.\d+/);
  });
});

// ---------------------------------------------------------------------------
// 20. High-level integration sanity
// ---------------------------------------------------------------------------

describe('memoryV1Engine – integration', () => {
  it('full two-session lifecycle', () => {
    let s = createMemoryV1('alice');

    // Session 1: write episodes
    for (let i = 0; i < 5; i++) {
      const r = processMessage(s, {
        encoderInput: { eivValue: 0.7, avi: 0.5, dominantEmotion: 'JOY', arousalScore: 0.4 },
        eventId: `s1_e${i}`,
        timestampMs: BASE_TS + i * 100,
      });
      s = r.nextState;
    }
    expect(s.episodic.events.length).toBe(5);

    // End session 1
    const end1 = endSession(s, BASE_TS + 1000);
    s = end1.nextState;
    expect(s.episodic.events.length).toBe(0);
    expect(s.schemas.schemas.length).toBeGreaterThan(0);
    const schemaCount1 = s.schemas.schemas.length;

    // Session 2: messages now hit retrieval
    for (let i = 0; i < 3; i++) {
      const r = processMessage(s, {
        encoderInput: { eivValue: 0.7, avi: 0.5, dominantEmotion: 'JOY', arousalScore: 0.4 },
        eventId: `s2_e${i}`,
        timestampMs: BASE_TS + 2000 + i * 100,
      });
      expect(r.retrievalResult.noMatch).toBe(false);
      expect(r.memoryContext).not.toBeNull();
      s = r.nextState;
    }

    // End session 2
    const end2 = endSession(s, BASE_TS + 3000);
    s = end2.nextState;
    expect(s.schemas.schemas.length).toBeLessThanOrEqual(20);
    expect(s.episodic.events.length).toBe(0);

    // Verify all schema data is finite
    for (const schema of s.schemas.schemas) {
      expect(Number.isFinite(schema.salienceWeight)).toBe(true);
      expect(Number.isFinite(schema.retrievalBias)).toBe(true);
      for (const v of schema.centroid) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
});
