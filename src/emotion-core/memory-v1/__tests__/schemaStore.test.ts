import {
  createSchemaStore,
  listSchemas,
  upsertSchema,
  pruneIfNeeded,
  updateSchemaFromEpisode,
  SchemaRecord,
  SchemaStoreState,
} from '../schemaStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HOUR_MS = 1000 * 60 * 60;
const BASE_TS = 1_000_000_000;

function zeroVec(len = 21): number[] {
  return new Array(len).fill(0);
}

function basisVec(dim: number, len = 21): number[] {
  const v = zeroVec(len);
  v[dim] = 1;
  return v;
}

function makeSchema(
  id: string,
  overrides: Partial<SchemaRecord> = {},
): SchemaRecord {
  return {
    schemaId: id,
    centroid: basisVec(0),
    salienceWeight: 0.5,
    episodeCount: 1,
    retrievalBias: 0,
    createdAt: BASE_TS,
    lastUpdatedAt: BASE_TS,
    ...overrides,
  };
}

function vecNorm(vec: number[]): number {
  return Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
}

// ---------------------------------------------------------------------------
// 1. createSchemaStore
// ---------------------------------------------------------------------------

describe('schemaStore – createSchemaStore', () => {
  it('initializes with empty schemas and default maxSchemas=20', () => {
    const store = createSchemaStore('user-1');
    expect(store.userId).toBe('user-1');
    expect(store.schemas).toEqual([]);
    expect(store.maxSchemas).toBe(20);
  });

  it('accepts custom maxSchemas', () => {
    const store = createSchemaStore('user-2', 5);
    expect(store.maxSchemas).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 2–3. upsertSchema
// ---------------------------------------------------------------------------

describe('schemaStore – upsertSchema', () => {
  it('adds a new schema when schemaId is not present', () => {
    const store = createSchemaStore('u');
    const next = upsertSchema(store, makeSchema('s1'));
    expect(next.schemas.length).toBe(1);
    expect(next.schemas[0].schemaId).toBe('s1');
  });

  it('replaces existing schema with same schemaId', () => {
    let store = createSchemaStore('u');
    store = upsertSchema(store, makeSchema('s1', { salienceWeight: 0.3 }));
    store = upsertSchema(store, makeSchema('s1', { salienceWeight: 0.9 }));
    expect(store.schemas.length).toBe(1);
    expect(store.schemas[0].salienceWeight).toBe(0.9);
  });

  it('preserves other schemas on upsert', () => {
    let store = createSchemaStore('u');
    store = upsertSchema(store, makeSchema('s1'));
    store = upsertSchema(store, makeSchema('s2'));
    store = upsertSchema(store, makeSchema('s1', { salienceWeight: 0.99 }));
    expect(store.schemas.length).toBe(2);
    expect(store.schemas.find((s) => s.schemaId === 's2')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 4. listSchemas
// ---------------------------------------------------------------------------

describe('schemaStore – listSchemas', () => {
  it('returns a shallow copy that cannot mutate internal state', () => {
    let store = createSchemaStore('u');
    store = upsertSchema(store, makeSchema('s1'));

    const list = listSchemas(store);
    list[0].salienceWeight = 999;
    list[0].centroid[0] = 999;

    expect(store.schemas[0].salienceWeight).toBe(0.5);
    expect(store.schemas[0].centroid[0]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 5–6. pruneIfNeeded
// ---------------------------------------------------------------------------

describe('schemaStore – pruneIfNeeded', () => {
  it('does nothing when under capacity', () => {
    let store = createSchemaStore('u', 5);
    store = upsertSchema(store, makeSchema('s1'));
    store = upsertSchema(store, makeSchema('s2'));

    const { nextState, prunedSchemaId } = pruneIfNeeded(store, BASE_TS);
    expect(nextState.schemas.length).toBe(2);
    expect(prunedSchemaId).toBeUndefined();
  });

  it('does nothing when exactly at capacity', () => {
    let store = createSchemaStore('u', 2);
    store = upsertSchema(store, makeSchema('s1'));
    store = upsertSchema(store, makeSchema('s2'));

    const { prunedSchemaId } = pruneIfNeeded(store, BASE_TS);
    expect(prunedSchemaId).toBeUndefined();
  });

  it('removes lowest pruneScore when over capacity', () => {
    let store = createSchemaStore('u', 2);
    store = upsertSchema(store, makeSchema('low', {
      salienceWeight: 0.1,
      lastUpdatedAt: BASE_TS,
    }));
    store = upsertSchema(store, makeSchema('mid', {
      salienceWeight: 0.5,
      lastUpdatedAt: BASE_TS,
    }));
    store = upsertSchema(store, makeSchema('high', {
      salienceWeight: 0.9,
      lastUpdatedAt: BASE_TS,
    }));

    const { nextState, prunedSchemaId } = pruneIfNeeded(store, BASE_TS);
    expect(prunedSchemaId).toBe('low');
    expect(nextState.schemas.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 7. recencyFactor decay
// ---------------------------------------------------------------------------

describe('schemaStore – recencyFactor', () => {
  it('old schemas have lower pruneScore and are pruned first', () => {
    let store = createSchemaStore('u', 2);
    store = upsertSchema(store, makeSchema('old', {
      salienceWeight: 0.5,
      lastUpdatedAt: BASE_TS,
    }));
    store = upsertSchema(store, makeSchema('recent', {
      salienceWeight: 0.5,
      lastUpdatedAt: BASE_TS + HOUR_MS * 500,
    }));
    store = upsertSchema(store, makeSchema('newest', {
      salienceWeight: 0.5,
      lastUpdatedAt: BASE_TS + HOUR_MS * 500,
    }));

    const { prunedSchemaId } = pruneIfNeeded(store, BASE_TS + HOUR_MS * 500);
    expect(prunedSchemaId).toBe('old');
  });
});

// ---------------------------------------------------------------------------
// 8–9. Tie-breaking
// ---------------------------------------------------------------------------

describe('schemaStore – tie-breaking', () => {
  it('breaks pruneScore tie by lowest episodeCount', () => {
    let store = createSchemaStore('u', 2);
    store = upsertSchema(store, makeSchema('few', {
      salienceWeight: 0.5,
      episodeCount: 2,
      lastUpdatedAt: BASE_TS,
      createdAt: BASE_TS,
    }));
    store = upsertSchema(store, makeSchema('many', {
      salienceWeight: 0.5,
      episodeCount: 10,
      lastUpdatedAt: BASE_TS,
      createdAt: BASE_TS,
    }));
    store = upsertSchema(store, makeSchema('extra', {
      salienceWeight: 0.5,
      episodeCount: 5,
      lastUpdatedAt: BASE_TS,
      createdAt: BASE_TS,
    }));

    const { prunedSchemaId } = pruneIfNeeded(store, BASE_TS);
    expect(prunedSchemaId).toBe('few');
  });

  it('breaks episodeCount tie by oldest createdAt', () => {
    let store = createSchemaStore('u', 2);
    store = upsertSchema(store, makeSchema('older', {
      salienceWeight: 0.5,
      episodeCount: 5,
      lastUpdatedAt: BASE_TS,
      createdAt: BASE_TS,
    }));
    store = upsertSchema(store, makeSchema('newer', {
      salienceWeight: 0.5,
      episodeCount: 5,
      lastUpdatedAt: BASE_TS,
      createdAt: BASE_TS + 1000,
    }));
    store = upsertSchema(store, makeSchema('filler', {
      salienceWeight: 0.5,
      episodeCount: 5,
      lastUpdatedAt: BASE_TS,
      createdAt: BASE_TS + 2000,
    }));

    const { prunedSchemaId } = pruneIfNeeded(store, BASE_TS);
    expect(prunedSchemaId).toBe('older');
  });
});

// ---------------------------------------------------------------------------
// 10–14. updateSchemaFromEpisode
// ---------------------------------------------------------------------------

describe('schemaStore – updateSchemaFromEpisode', () => {
  it('updates centroid via EWMA correctly', () => {
    let store = createSchemaStore('u');
    const oldCentroid = basisVec(0);
    store = upsertSchema(store, makeSchema('s1', { centroid: oldCentroid }));

    const episodeVec = basisVec(1);
    store = updateSchemaFromEpisode(store, 's1', episodeVec, 0.5, BASE_TS + 1);

    const s = store.schemas[0];
    // Before L2 renorm: dim0 = 0.8*1 + 0.2*0 = 0.8, dim1 = 0.8*0 + 0.2*1 = 0.2
    // After L2: norm = sqrt(0.64+0.04) = sqrt(0.68)
    const expectedRaw0 = 0.8;
    const expectedRaw1 = 0.2;
    const norm = Math.sqrt(expectedRaw0 ** 2 + expectedRaw1 ** 2);
    expect(s.centroid[0]).toBeCloseTo(expectedRaw0 / norm, 8);
    expect(s.centroid[1]).toBeCloseTo(expectedRaw1 / norm, 8);
  });

  it('centroid remains L2-normalized after update', () => {
    let store = createSchemaStore('u');
    store = upsertSchema(store, makeSchema('s1', { centroid: basisVec(0) }));

    store = updateSchemaFromEpisode(store, 's1', basisVec(3), 0.7, BASE_TS + 1);
    store = updateSchemaFromEpisode(store, 's1', basisVec(5), 0.3, BASE_TS + 2);
    store = updateSchemaFromEpisode(store, 's1', basisVec(10), 0.9, BASE_TS + 3);

    const norm = vecNorm(store.schemas[0].centroid);
    expect(norm).toBeCloseTo(1.0, 6);
  });

  it('salienceWeight EWMA computed correctly', () => {
    let store = createSchemaStore('u');
    store = upsertSchema(store, makeSchema('s1', { salienceWeight: 0.5 }));

    store = updateSchemaFromEpisode(store, 's1', basisVec(0), 0.9, BASE_TS + 1);
    // new = 0.8 * 0.5 + 0.2 * 0.9 = 0.4 + 0.18 = 0.58
    expect(store.schemas[0].salienceWeight).toBeCloseTo(0.58, 8);
  });

  it('increments episodeCount', () => {
    let store = createSchemaStore('u');
    store = upsertSchema(store, makeSchema('s1', { episodeCount: 3 }));

    store = updateSchemaFromEpisode(store, 's1', basisVec(0), 0.5, BASE_TS + 1);
    expect(store.schemas[0].episodeCount).toBe(4);

    store = updateSchemaFromEpisode(store, 's1', basisVec(0), 0.5, BASE_TS + 2);
    expect(store.schemas[0].episodeCount).toBe(5);
  });

  it('updates lastUpdatedAt to nowMs', () => {
    let store = createSchemaStore('u');
    store = upsertSchema(store, makeSchema('s1'));

    const newTs = BASE_TS + HOUR_MS * 10;
    store = updateSchemaFromEpisode(store, 's1', basisVec(0), 0.5, newTs);
    expect(store.schemas[0].lastUpdatedAt).toBe(newTs);
  });
});

// ---------------------------------------------------------------------------
// 15. Immutability
// ---------------------------------------------------------------------------

describe('schemaStore – immutability', () => {
  it('upsertSchema does not mutate previous state', () => {
    let store = createSchemaStore('u');
    store = upsertSchema(store, makeSchema('s1'));
    const snapshot = JSON.parse(JSON.stringify(store));

    upsertSchema(store, makeSchema('s2'));
    expect(store.schemas.length).toBe(snapshot.schemas.length);
  });

  it('updateSchemaFromEpisode does not mutate previous state', () => {
    let store = createSchemaStore('u');
    store = upsertSchema(store, makeSchema('s1', { episodeCount: 1 }));
    const countBefore = store.schemas[0].episodeCount;

    updateSchemaFromEpisode(store, 's1', basisVec(1), 0.5, BASE_TS + 1);
    expect(store.schemas[0].episodeCount).toBe(countBefore);
  });

  it('pruneIfNeeded does not mutate previous state', () => {
    let store = createSchemaStore('u', 1);
    store = upsertSchema(store, makeSchema('s1'));
    store = upsertSchema(store, makeSchema('s2'));
    const lenBefore = store.schemas.length;

    pruneIfNeeded(store, BASE_TS);
    expect(store.schemas.length).toBe(lenBefore);
  });
});

// ---------------------------------------------------------------------------
// 16. Large timestamps
// ---------------------------------------------------------------------------

describe('schemaStore – large timestamps', () => {
  it('handles very large nowMs without overflow or NaN', () => {
    const farFuture = 1e15;
    let store = createSchemaStore('u', 1);
    store = upsertSchema(store, makeSchema('s1', { lastUpdatedAt: 0 }));
    store = upsertSchema(store, makeSchema('s2', { lastUpdatedAt: farFuture }));

    const { nextState, prunedSchemaId } = pruneIfNeeded(store, farFuture);
    expect(prunedSchemaId).toBeDefined();
    expect(nextState.schemas.length).toBe(1);
    for (const s of nextState.schemas) {
      expect(Number.isFinite(s.salienceWeight)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 17–18. NaN safety
// ---------------------------------------------------------------------------

describe('schemaStore – NaN safety', () => {
  it('no NaN in centroid after update with NaN episode vec', () => {
    let store = createSchemaStore('u');
    store = upsertSchema(store, makeSchema('s1'));

    const badVec = zeroVec();
    badVec[0] = NaN;
    badVec[3] = Infinity;
    store = updateSchemaFromEpisode(store, 's1', badVec, 0.5, BASE_TS + 1);

    for (const v of store.schemas[0].centroid) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('no NaN in salienceWeight after update with NaN salience', () => {
    let store = createSchemaStore('u');
    store = upsertSchema(store, makeSchema('s1', { salienceWeight: 0.5 }));

    store = updateSchemaFromEpisode(store, 's1', basisVec(0), NaN, BASE_TS + 1);
    expect(Number.isFinite(store.schemas[0].salienceWeight)).toBe(true);
    expect(store.schemas[0].salienceWeight).toBeGreaterThanOrEqual(0);
    expect(store.schemas[0].salienceWeight).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 19. Multiple prune cycles
// ---------------------------------------------------------------------------

describe('schemaStore – multiple prune cycles', () => {
  it('deterministic across successive prune calls', () => {
    let store = createSchemaStore('u', 2);
    store = upsertSchema(store, makeSchema('a', { salienceWeight: 0.1, lastUpdatedAt: BASE_TS }));
    store = upsertSchema(store, makeSchema('b', { salienceWeight: 0.5, lastUpdatedAt: BASE_TS }));
    store = upsertSchema(store, makeSchema('c', { salienceWeight: 0.9, lastUpdatedAt: BASE_TS }));
    store = upsertSchema(store, makeSchema('d', { salienceWeight: 0.3, lastUpdatedAt: BASE_TS }));

    const r1 = pruneIfNeeded(store, BASE_TS);
    expect(r1.prunedSchemaId).toBe('a');

    const r2 = pruneIfNeeded(r1.nextState, BASE_TS);
    expect(r2.prunedSchemaId).toBe('d');

    expect(r2.nextState.schemas.length).toBe(2);
    const ids = r2.nextState.schemas.map((s) => s.schemaId).sort();
    expect(ids).toEqual(['b', 'c']);
  });
});

// ---------------------------------------------------------------------------
// 20. Capacity boundary
// ---------------------------------------------------------------------------

describe('schemaStore – capacity boundary', () => {
  it('default capacity is exactly 20', () => {
    let store = createSchemaStore('u');
    for (let i = 0; i < 20; i++) {
      store = upsertSchema(store, makeSchema(`s${i}`, {
        salienceWeight: 0.5,
        lastUpdatedAt: BASE_TS,
      }));
    }
    const { prunedSchemaId } = pruneIfNeeded(store, BASE_TS);
    expect(prunedSchemaId).toBeUndefined();
    expect(store.schemas.length).toBe(20);

    store = upsertSchema(store, makeSchema('overflow', {
      salienceWeight: 0.5,
      lastUpdatedAt: BASE_TS,
    }));
    const r = pruneIfNeeded(store, BASE_TS);
    expect(r.prunedSchemaId).toBeDefined();
    expect(r.nextState.schemas.length).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// 21. schemaId uniqueness
// ---------------------------------------------------------------------------

describe('schemaStore – schemaId uniqueness', () => {
  it('upsert with duplicate id replaces, never duplicates', () => {
    let store = createSchemaStore('u');
    store = upsertSchema(store, makeSchema('dup', { salienceWeight: 0.1 }));
    store = upsertSchema(store, makeSchema('dup', { salienceWeight: 0.2 }));
    store = upsertSchema(store, makeSchema('dup', { salienceWeight: 0.3 }));

    const matching = store.schemas.filter((s) => s.schemaId === 'dup');
    expect(matching.length).toBe(1);
    expect(matching[0].salienceWeight).toBe(0.3);
  });
});

// ---------------------------------------------------------------------------
// 22. retrievalBias preserved
// ---------------------------------------------------------------------------

describe('schemaStore – retrievalBias preserved', () => {
  it('updateSchemaFromEpisode does not alter retrievalBias', () => {
    let store = createSchemaStore('u');
    store = upsertSchema(store, makeSchema('s1', { retrievalBias: 0.42 }));

    store = updateSchemaFromEpisode(store, 's1', basisVec(1), 0.8, BASE_TS + 1);
    store = updateSchemaFromEpisode(store, 's1', basisVec(2), 0.3, BASE_TS + 2);

    expect(store.schemas[0].retrievalBias).toBe(0.42);
  });
});
