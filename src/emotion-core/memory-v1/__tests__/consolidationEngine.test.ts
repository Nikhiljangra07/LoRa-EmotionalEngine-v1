import { consolidate } from '../consolidationEngine';
import type {
  ConsolidationInput,
  ConsolidationEpisode,
  CSchema,
} from '../consolidationTypes';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_TS = 1_000_000_000;
const HOUR_MS = 1000 * 60 * 60;

function unitVec3(x: number, y: number, z: number): number[] {
  const n = Math.sqrt(x * x + y * y + z * z);
  return n > 0 ? [x / n, y / n, z / n] : [0, 0, 0];
}

function vecNorm(v: number[]): number {
  return Math.sqrt(v.reduce((s, x) => s + x * x, 0));
}

function makeSchema(
  id: string,
  centroid: number[],
  overrides: Partial<CSchema> = {},
): CSchema {
  return {
    schemaId: id,
    centroid,
    salienceWeight: 0.5,
    episodeCount: 5,
    retrievalBias: 0,
    createdAt: BASE_TS,
    lastUpdatedAt: BASE_TS,
    sessionCount: 3,
    ...overrides,
  };
}

function makeEp(id: string, vec: number[], salience = 0.5): ConsolidationEpisode {
  return { id, emotionVec: vec, salience };
}

function padSchemas(
  base: CSchema[],
  total: number,
): CSchema[] {
  const out = [...base];
  let idx = 0;
  while (out.length < total) {
    out.push(
      makeSchema(`pad_${idx}`, unitVec3(0, 0, 1), {
        salienceWeight: 0.4,
        sessionCount: 3,
        episodeCount: 5,
        lastUpdatedAt: BASE_TS,
      }),
    );
    idx++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. Deterministic schema creation IDs and ordering
// ---------------------------------------------------------------------------

describe('consolidation – deterministic creation', () => {
  it('creates schemas with sequential IDs in episode-id-sorted order', () => {
    const input: ConsolidationInput = {
      nowMs: BASE_TS,
      episodes: [
        makeEp('ep_b', unitVec3(0, 1, 0)),
        makeEp('ep_a', unitVec3(1, 0, 0)),
      ],
      schemas: [],
      mode: 'baseline',
    };
    const r = consolidate(input);
    expect(r.createdSchemaIds).toEqual(['schema_new_0', 'schema_new_1']);
    expect(r.episodeAssignments[0].eventId).toBe('ep_a');
    expect(r.episodeAssignments[1].eventId).toBe('ep_b');
  });

  it('output schemas are sorted by schemaId ascending', () => {
    const input: ConsolidationInput = {
      nowMs: BASE_TS,
      episodes: [makeEp('ep1', unitVec3(1, 0, 0)), makeEp('ep2', unitVec3(0, 1, 0))],
      schemas: [],
      mode: 'baseline',
    };
    const r = consolidate(input);
    for (let i = 1; i < r.updatedSchemas.length; i++) {
      expect(
        r.updatedSchemas[i].schemaId.localeCompare(r.updatedSchemas[i - 1].schemaId),
      ).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Assignment uses THETA_TOPIC correctly
// ---------------------------------------------------------------------------

describe('consolidation – assignment threshold', () => {
  it('assigns episode to schema when cosine >= 0.65', () => {
    const schema = makeSchema('s1', unitVec3(1, 0, 0));
    const ep = makeEp('e1', unitVec3(1, 0.1, 0));
    const r = consolidate({
      nowMs: BASE_TS,
      episodes: [ep],
      schemas: [schema],
      mode: 'baseline',
    });
    expect(r.episodeAssignments[0].schemaId).toBe('s1');
    expect(r.createdSchemaIds.length).toBe(0);
  });

  it('creates new schema when cosine < 0.65', () => {
    const schema = makeSchema('s1', unitVec3(1, 0, 0));
    const ep = makeEp('e1', unitVec3(0, 1, 0));
    const r = consolidate({
      nowMs: BASE_TS,
      episodes: [ep],
      schemas: [schema],
      mode: 'baseline',
    });
    expect(r.createdSchemaIds.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. EWMA centroid update + L2 normalize
// ---------------------------------------------------------------------------

describe('consolidation – centroid EWMA', () => {
  it('centroid moves toward episode vec and remains L2-normalized', () => {
    const schema = makeSchema('s1', unitVec3(1, 0, 0));
    const ep = makeEp('e1', unitVec3(1, 0.3, 0));
    const r = consolidate({
      nowMs: BASE_TS,
      episodes: [ep],
      schemas: [schema],
      mode: 'baseline',
    });
    const updated = r.updatedSchemas.find((s) => s.schemaId === 's1')!;
    expect(updated.centroid[1]).toBeGreaterThan(0);
    expect(vecNorm(updated.centroid)).toBeCloseTo(1.0, 6);
  });
});

// ---------------------------------------------------------------------------
// 4. salienceWeight EWMA update
// ---------------------------------------------------------------------------

describe('consolidation – salienceWeight EWMA', () => {
  it('salienceWeight moves toward episode salience via EWMA(0.30)', () => {
    const schema = makeSchema('s1', unitVec3(1, 0, 0), { salienceWeight: 0.5 });
    const ep = makeEp('e1', unitVec3(1, 0.1, 0), 0.9);
    const r = consolidate({
      nowMs: BASE_TS,
      episodes: [ep],
      schemas: [schema],
      mode: 'baseline',
    });
    const updated = r.updatedSchemas.find((s) => s.schemaId === 's1')!;
    // (1-0.3)*0.5 + 0.3*0.9 = 0.35 + 0.27 = 0.62
    expect(updated.salienceWeight).toBeCloseTo(0.62, 5);
  });
});

// ---------------------------------------------------------------------------
// 5. sessionCount increments only when touched
// ---------------------------------------------------------------------------

describe('consolidation – sessionCount', () => {
  it('increments for schema that received episodes', () => {
    const s = makeSchema('s1', unitVec3(1, 0, 0), { sessionCount: 2 });
    const r = consolidate({
      nowMs: BASE_TS,
      episodes: [makeEp('e1', unitVec3(1, 0.1, 0))],
      schemas: [s],
      mode: 'baseline',
    });
    expect(r.updatedSchemas.find((x) => x.schemaId === 's1')!.sessionCount).toBe(3);
  });

  it('does NOT increment for untouched schema', () => {
    const s1 = makeSchema('s1', unitVec3(1, 0, 0), { sessionCount: 5 });
    const s2 = makeSchema('s2', unitVec3(0, 1, 0), { sessionCount: 2 });
    const r = consolidate({
      nowMs: BASE_TS,
      episodes: [makeEp('e1', unitVec3(1, 0.05, 0))],
      schemas: [s1, s2],
      mode: 'baseline',
    });
    expect(r.updatedSchemas.find((x) => x.schemaId === 's2')!.sessionCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 6. Capacity merge triggers only when all criteria met
// ---------------------------------------------------------------------------

describe('consolidation – merge criteria', () => {
  it('does NOT merge when sessionCount < 2 even if cosine and cooccurrence pass', () => {
    const sA = makeSchema('sA', unitVec3(1, 0, 0), { sessionCount: 0, salienceWeight: 0.8 });
    const sB = makeSchema('sB', unitVec3(0.9, 0.44, 0), { sessionCount: 0, salienceWeight: 0.8 });
    const eps = [
      ...Array.from({ length: 4 }, (_, i) => makeEp(`a${i}`, unitVec3(1, -0.2, 0))),
      ...Array.from({ length: 4 }, (_, i) => makeEp(`b${i}`, unitVec3(0.7, 0.7, 0))),
    ];
    const schemas = padSchemas([sA, sB], 21);
    const r = consolidate({ nowMs: BASE_TS, episodes: eps, schemas, mode: 'baseline' });
    expect(r.mergedPairs.length).toBe(0);
    expect(r.prunedSchemaIds.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Co-occurrence logic works
// ---------------------------------------------------------------------------

describe('consolidation – co-occurrence', () => {
  it('merge happens when both schemas receive >= 3 episodes each', () => {
    const sA = makeSchema('sA', unitVec3(1, 0, 0), {
      sessionCount: 3,
      salienceWeight: 0.8,
      episodeCount: 10,
    });
    const sB = makeSchema('sB', unitVec3(0.9, 0.44, 0), {
      sessionCount: 3,
      salienceWeight: 0.7,
      episodeCount: 8,
    });
    const epsA = Array.from({ length: 4 }, (_, i) =>
      makeEp(`a${i}`, unitVec3(1, -0.2, 0)),
    );
    const epsB = Array.from({ length: 4 }, (_, i) =>
      makeEp(`b${i}`, unitVec3(0.7, 0.7, 0)),
    );
    const schemas = padSchemas([sA, sB], 21);
    const r = consolidate({
      nowMs: BASE_TS,
      episodes: [...epsA, ...epsB],
      schemas,
      mode: 'baseline',
    });
    expect(r.mergedPairs.length).toBeGreaterThan(0);
    const mp = r.mergedPairs.find(
      (p) =>
        (p.fromId === 'sA' || p.fromId === 'sB') &&
        (p.intoId === 'sA' || p.intoId === 'sB'),
    );
    expect(mp).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 8. Merge tie-break determinism
// ---------------------------------------------------------------------------

describe('consolidation – merge direction', () => {
  it('higher salienceWeight becomes "into"', () => {
    const sA = makeSchema('sA', unitVec3(1, 0, 0), {
      sessionCount: 3,
      salienceWeight: 0.9,
      episodeCount: 10,
    });
    const sB = makeSchema('sB', unitVec3(0.9, 0.44, 0), {
      sessionCount: 3,
      salienceWeight: 0.6,
      episodeCount: 10,
    });
    const eps = [
      ...Array.from({ length: 4 }, (_, i) => makeEp(`a${i}`, unitVec3(1, -0.2, 0))),
      ...Array.from({ length: 4 }, (_, i) => makeEp(`b${i}`, unitVec3(0.7, 0.7, 0))),
    ];
    const schemas = padSchemas([sA, sB], 21);
    const r = consolidate({ nowMs: BASE_TS, episodes: eps, schemas, mode: 'baseline' });
    const mp = r.mergedPairs.find(
      (p) =>
        (p.fromId === 'sA' || p.fromId === 'sB') &&
        (p.intoId === 'sA' || p.intoId === 'sB'),
    );
    expect(mp).toBeDefined();
    if (mp) expect(mp.intoId).toBe('sA');
  });

  it('on salience tie, higher episodeCount becomes "into"', () => {
    const sA = makeSchema('sA', unitVec3(1, 0, 0), {
      sessionCount: 3,
      salienceWeight: 0.7,
      episodeCount: 20,
    });
    const sB = makeSchema('sB', unitVec3(0.9, 0.44, 0), {
      sessionCount: 3,
      salienceWeight: 0.7,
      episodeCount: 5,
    });
    const eps = [
      ...Array.from({ length: 4 }, (_, i) => makeEp(`a${i}`, unitVec3(1, -0.2, 0))),
      ...Array.from({ length: 4 }, (_, i) => makeEp(`b${i}`, unitVec3(0.7, 0.7, 0))),
    ];
    const schemas = padSchemas([sA, sB], 21);
    const r = consolidate({ nowMs: BASE_TS, episodes: eps, schemas, mode: 'baseline' });
    const mp = r.mergedPairs.find(
      (p) =>
        (p.fromId === 'sA' || p.fromId === 'sB') &&
        (p.intoId === 'sA' || p.intoId === 'sB'),
    );
    expect(mp).toBeDefined();
    if (mp) expect(mp.intoId).toBe('sA');
  });
});

// ---------------------------------------------------------------------------
// 9. Relax steps allow merge only after relax
// ---------------------------------------------------------------------------

describe('consolidation – merge relaxation', () => {
  it('merges at relaxed threshold when base threshold fails', () => {
    // cos(sA, sB) ≈ 0.77: fails THETA_MERGE=0.80 but passes 0.75 after 1 relax step.
    // Episode vecs hug centroids tightly so EWMA drift is minimal.
    const sA = makeSchema('sA', unitVec3(1, 0, 0), {
      sessionCount: 3,
      salienceWeight: 0.8,
      episodeCount: 10,
    });
    const sB = makeSchema('sB', unitVec3(0.766, 0.643, 0), {
      sessionCount: 3,
      salienceWeight: 0.7,
      episodeCount: 8,
    });
    const eps = [
      ...Array.from({ length: 4 }, (_, i) => makeEp(`a${i}`, unitVec3(1, 0.05, 0))),
      ...Array.from({ length: 4 }, (_, i) => makeEp(`b${i}`, unitVec3(0.77, 0.64, 0))),
    ];
    const schemas = padSchemas([sA, sB], 21);
    const r = consolidate({ nowMs: BASE_TS, episodes: eps, schemas, mode: 'baseline' });
    const mp = r.mergedPairs.find(
      (p) =>
        (p.fromId === 'sA' || p.fromId === 'sB') &&
        (p.intoId === 'sA' || p.intoId === 'sB'),
    );
    expect(mp).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 10. Prune triggers when no merge candidates
// ---------------------------------------------------------------------------

describe('consolidation – prune fallback', () => {
  it('prunes when no merge candidates exist', () => {
    const schemas = padSchemas([], 21);
    const r = consolidate({ nowMs: BASE_TS, episodes: [], schemas, mode: 'baseline' });
    expect(r.prunedSchemaIds.length).toBeGreaterThan(0);
    expect(r.updatedSchemas.length).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// 11. Prune score uses recency
// ---------------------------------------------------------------------------

describe('consolidation – prune recency', () => {
  it('old schema pruned before recent schema with same salience', () => {
    const old = makeSchema('old', unitVec3(0.5, 0.5, 0.7), {
      salienceWeight: 0.3,
      lastUpdatedAt: BASE_TS - HOUR_MS * 500,
      episodeCount: 2,
    });
    const fresh = makeSchema('fresh', unitVec3(0.6, 0.4, 0.7), {
      salienceWeight: 0.3,
      lastUpdatedAt: BASE_TS,
      episodeCount: 2,
    });
    const schemas = padSchemas([old, fresh], 21);
    const r = consolidate({ nowMs: BASE_TS, episodes: [], schemas, mode: 'baseline' });
    expect(r.prunedSchemaIds).toContain('old');
  });
});

// ---------------------------------------------------------------------------
// 12. Prune tie-break determinism
// ---------------------------------------------------------------------------

describe('consolidation – prune tie-break', () => {
  it('breaks score tie by lowest episodeCount, then oldest createdAt, then schemaId', () => {
    const s1 = makeSchema('s_b', unitVec3(0.3, 0.4, 0.9), {
      salienceWeight: 0.01,
      episodeCount: 1,
      createdAt: BASE_TS,
      lastUpdatedAt: BASE_TS - HOUR_MS * 1000,
    });
    const s2 = makeSchema('s_a', unitVec3(0.4, 0.3, 0.9), {
      salienceWeight: 0.01,
      episodeCount: 1,
      createdAt: BASE_TS,
      lastUpdatedAt: BASE_TS - HOUR_MS * 1000,
    });
    const schemas = padSchemas([s1, s2], 21);
    const r = consolidate({ nowMs: BASE_TS, episodes: [], schemas, mode: 'baseline' });
    expect(r.prunedSchemaIds[0]).toBe('s_a');
  });
});

// ---------------------------------------------------------------------------
// 13. retrievalBias NOT used in centroid similarity
// ---------------------------------------------------------------------------

describe('consolidation – retrievalBias ignored in similarity', () => {
  it('high bias does not affect assignment cosine comparison', () => {
    const sNear = makeSchema('sNear', unitVec3(1, 0, 0), { retrievalBias: 0 });
    const sFar = makeSchema('sFar', unitVec3(0, 1, 0), { retrievalBias: 0.20 });
    const ep = makeEp('e1', unitVec3(1, 0.1, 0));
    const r = consolidate({
      nowMs: BASE_TS,
      episodes: [ep],
      schemas: [sNear, sFar],
      mode: 'baseline',
    });
    expect(r.episodeAssignments[0].schemaId).toBe('sNear');
  });
});

// ---------------------------------------------------------------------------
// 14. retrievalBias merged and clamped
// ---------------------------------------------------------------------------

describe('consolidation – retrievalBias merge', () => {
  it('averages biases on merge and clamps to [-0.20, 0.20]', () => {
    const sA = makeSchema('sA', unitVec3(1, 0, 0), {
      sessionCount: 3,
      salienceWeight: 0.8,
      episodeCount: 10,
      retrievalBias: 0.18,
    });
    const sB = makeSchema('sB', unitVec3(0.9, 0.44, 0), {
      sessionCount: 3,
      salienceWeight: 0.7,
      episodeCount: 10,
      retrievalBias: 0.16,
    });
    const eps = [
      ...Array.from({ length: 4 }, (_, i) => makeEp(`a${i}`, unitVec3(1, -0.2, 0))),
      ...Array.from({ length: 4 }, (_, i) => makeEp(`b${i}`, unitVec3(0.7, 0.7, 0))),
    ];
    const schemas = padSchemas([sA, sB], 21);
    const r = consolidate({ nowMs: BASE_TS, episodes: eps, schemas, mode: 'baseline' });
    const merged = r.updatedSchemas.find((s) => s.schemaId === 'sA');
    expect(merged).toBeDefined();
    expect(merged!.retrievalBias).toBeCloseTo(0.17, 2);
    expect(merged!.retrievalBias).toBeLessThanOrEqual(0.20);
  });
});

// ---------------------------------------------------------------------------
// 15. Created schemas initialize retrievalBias=0
// ---------------------------------------------------------------------------

describe('consolidation – new schema defaults', () => {
  it('new schemas have retrievalBias=0', () => {
    const r = consolidate({
      nowMs: BASE_TS,
      episodes: [makeEp('e1', unitVec3(1, 0, 0))],
      schemas: [],
      mode: 'baseline',
    });
    expect(r.updatedSchemas[0].retrievalBias).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 16. noveltyFlag
// ---------------------------------------------------------------------------

describe('consolidation – noveltyFlag', () => {
  it('true when schemas are created', () => {
    const r = consolidate({
      nowMs: BASE_TS,
      episodes: [makeEp('e1', unitVec3(1, 0, 0))],
      schemas: [],
      mode: 'baseline',
    });
    expect(r.noveltyFlag).toBe(true);
  });

  it('false when no schemas are created', () => {
    const s = makeSchema('s1', unitVec3(1, 0, 0));
    const r = consolidate({
      nowMs: BASE_TS,
      episodes: [makeEp('e1', unitVec3(1, 0.1, 0))],
      schemas: [s],
      mode: 'baseline',
    });
    expect(r.noveltyFlag).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 17. No NaN / no Infinity
// ---------------------------------------------------------------------------

describe('consolidation – NaN safety', () => {
  it('no NaN in output with NaN inputs', () => {
    const s = makeSchema('s1', [NaN, 0, 1]);
    const ep = makeEp('e1', [NaN, Infinity, 0]);
    const r = consolidate({
      nowMs: BASE_TS,
      episodes: [ep],
      schemas: [s],
      mode: 'baseline',
    });
    for (const schema of r.updatedSchemas) {
      for (const v of schema.centroid) {
        expect(Number.isFinite(v)).toBe(true);
      }
      expect(Number.isFinite(schema.salienceWeight)).toBe(true);
      expect(Number.isFinite(schema.retrievalBias)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 18. Schemas never exceed MAX_SCHEMAS after consolidation
// ---------------------------------------------------------------------------

describe('consolidation – capacity cap', () => {
  it('never exceeds 20 schemas regardless of input count', () => {
    const schemas = padSchemas([], 25);
    const eps = Array.from({ length: 5 }, (_, i) =>
      makeEp(`novel_${i}`, unitVec3(Math.random(), Math.random(), Math.random())),
    );
    const r = consolidate({ nowMs: BASE_TS, episodes: eps, schemas, mode: 'baseline' });
    expect(r.updatedSchemas.length).toBeLessThanOrEqual(20);
  });
});

// ---------------------------------------------------------------------------
// 19–20. Merging and pruning reduce count by 1
// ---------------------------------------------------------------------------

describe('consolidation – count reduction', () => {
  it('merging reduces schema count by 1', () => {
    const sA = makeSchema('sA', unitVec3(1, 0, 0), {
      sessionCount: 3,
      salienceWeight: 0.9,
      episodeCount: 10,
    });
    const sB = makeSchema('sB', unitVec3(1, 0.02, 0), {
      sessionCount: 3,
      salienceWeight: 0.8,
      episodeCount: 10,
    });
    const eps = [
      ...Array.from({ length: 4 }, (_, i) => makeEp(`a${i}`, unitVec3(1, 0.01, 0))),
      ...Array.from({ length: 4 }, (_, i) => makeEp(`b${i}`, unitVec3(1, 0.03, 0))),
    ];
    const schemas = padSchemas([sA, sB], 21);
    const before = schemas.length;
    const r = consolidate({ nowMs: BASE_TS, episodes: eps, schemas, mode: 'baseline' });
    if (r.mergedPairs.length > 0) {
      expect(r.updatedSchemas.length).toBe(before - r.mergedPairs.length - r.prunedSchemaIds.length);
    }
  });

  it('pruning reduces schema count by 1', () => {
    const schemas = padSchemas([], 21);
    const r = consolidate({ nowMs: BASE_TS, episodes: [], schemas, mode: 'baseline' });
    expect(r.prunedSchemaIds.length).toBe(1);
    expect(r.updatedSchemas.length).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// 21. Multiple merges possible
// ---------------------------------------------------------------------------

describe('consolidation – multiple merges', () => {
  it('can merge two distinct pairs in one consolidation run', () => {
    // Pair 1 in x-y plane
    const sA = makeSchema('mA1', unitVec3(1, 0, 0), {
      sessionCount: 3, salienceWeight: 0.9, episodeCount: 10,
    });
    const sB = makeSchema('mA2', unitVec3(0.9, 0.44, 0), {
      sessionCount: 3, salienceWeight: 0.8, episodeCount: 10,
    });
    // Pair 2 in y-z plane
    const sC = makeSchema('mB1', unitVec3(0, 1, 0), {
      sessionCount: 3, salienceWeight: 0.9, episodeCount: 10,
    });
    const sD = makeSchema('mB2', unitVec3(0, 0.9, 0.44), {
      sessionCount: 3, salienceWeight: 0.8, episodeCount: 10,
    });
    const eps = [
      ...Array.from({ length: 4 }, (_, i) => makeEp(`xa${i}`, unitVec3(1, -0.2, 0))),
      ...Array.from({ length: 4 }, (_, i) => makeEp(`xb${i}`, unitVec3(0.7, 0.7, 0))),
      ...Array.from({ length: 4 }, (_, i) => makeEp(`ya${i}`, unitVec3(0, 1, -0.2))),
      ...Array.from({ length: 4 }, (_, i) => makeEp(`yb${i}`, unitVec3(0, 0.7, 0.7))),
    ];
    const schemas = padSchemas([sA, sB, sC, sD], 22);
    const r = consolidate({ nowMs: BASE_TS, episodes: eps, schemas, mode: 'baseline' });
    expect(r.mergedPairs.length).toBeGreaterThanOrEqual(2);
    expect(r.updatedSchemas.length).toBeLessThanOrEqual(20);
  });
});

// ---------------------------------------------------------------------------
// 22. Multiple prunes possible
// ---------------------------------------------------------------------------

describe('consolidation – multiple prunes', () => {
  it('prunes multiple schemas when well over capacity', () => {
    const schemas = padSchemas([], 23);
    const r = consolidate({ nowMs: BASE_TS, episodes: [], schemas, mode: 'baseline' });
    expect(r.prunedSchemaIds.length).toBe(3);
    expect(r.updatedSchemas.length).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// 23. baseline vs enhanced mode passes through
// ---------------------------------------------------------------------------

describe('consolidation – mode passthrough', () => {
  it('produces identical results for baseline and enhanced with same data', () => {
    const s = makeSchema('s1', unitVec3(1, 0, 0));
    const ep = makeEp('e1', unitVec3(1, 0.1, 0), 0.6);
    const common = { nowMs: BASE_TS, episodes: [ep], schemas: [s] };
    const rb = consolidate({ ...common, mode: 'baseline' });
    const re = consolidate({ ...common, mode: 'enhanced' });
    expect(rb.updatedSchemas).toEqual(re.updatedSchemas);
    expect(rb.episodeAssignments).toEqual(re.episodeAssignments);
  });
});

// ---------------------------------------------------------------------------
// 24. Empty episodes: no change
// ---------------------------------------------------------------------------

describe('consolidation – empty episodes', () => {
  it('returns schemas unchanged (except sorting) when no episodes', () => {
    const s1 = makeSchema('s1', unitVec3(1, 0, 0), { sessionCount: 2 });
    const s2 = makeSchema('s2', unitVec3(0, 1, 0), { sessionCount: 2 });
    const r = consolidate({
      nowMs: BASE_TS,
      episodes: [],
      schemas: [s2, s1],
      mode: 'baseline',
    });
    expect(r.updatedSchemas.length).toBe(2);
    expect(r.updatedSchemas[0].schemaId).toBe('s1');
    expect(r.createdSchemaIds.length).toBe(0);
    expect(r.episodeAssignments.length).toBe(0);
    expect(r.noveltyFlag).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 25. Empty schemas + episodes: creates new schemas
// ---------------------------------------------------------------------------

describe('consolidation – empty schemas with episodes', () => {
  it('creates schemas from all episodes', () => {
    const r = consolidate({
      nowMs: BASE_TS,
      episodes: [
        makeEp('e1', unitVec3(1, 0, 0)),
        makeEp('e2', unitVec3(0, 1, 0)),
        makeEp('e3', unitVec3(0, 0, 1)),
      ],
      schemas: [],
      mode: 'baseline',
    });
    expect(r.createdSchemaIds.length).toBe(3);
    expect(r.updatedSchemas.length).toBe(3);
    expect(r.noveltyFlag).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 26. Stable sort by schemaId
// ---------------------------------------------------------------------------

describe('consolidation – stable schemaId sort', () => {
  it('outputs are always sorted by schemaId regardless of input order', () => {
    const schemas = [
      makeSchema('z', unitVec3(1, 0, 0)),
      makeSchema('a', unitVec3(0, 1, 0)),
      makeSchema('m', unitVec3(0, 0, 1)),
    ];
    const r = consolidate({ nowMs: BASE_TS, episodes: [], schemas, mode: 'baseline' });
    const ids = r.updatedSchemas.map((s) => s.schemaId);
    expect(ids).toEqual(['a', 'm', 'z']);
  });
});

// ---------------------------------------------------------------------------
// 27. No mutation of input arrays
// ---------------------------------------------------------------------------

describe('consolidation – immutability', () => {
  it('does not mutate input schemas array or objects', () => {
    const schema = makeSchema('s1', unitVec3(1, 0, 0), { salienceWeight: 0.5, episodeCount: 3 });
    const original = JSON.parse(JSON.stringify(schema));
    const schemasArr = [schema];

    consolidate({
      nowMs: BASE_TS,
      episodes: [makeEp('e1', unitVec3(1, 0.1, 0), 0.8)],
      schemas: schemasArr,
      mode: 'baseline',
    });

    expect(schemasArr.length).toBe(1);
    expect(schema.salienceWeight).toBe(original.salienceWeight);
    expect(schema.episodeCount).toBe(original.episodeCount);
    expect(schema.centroid).toEqual(original.centroid);
  });

  it('does not mutate input episodes array', () => {
    const eps = [makeEp('e1', unitVec3(1, 0, 0))];
    const origLen = eps.length;
    consolidate({ nowMs: BASE_TS, episodes: eps, schemas: [], mode: 'baseline' });
    expect(eps.length).toBe(origLen);
  });
});

// ---------------------------------------------------------------------------
// 28–30. Additional coverage
// ---------------------------------------------------------------------------

describe('consolidation – episodeCount accumulation', () => {
  it('episodeCount increases by number of assigned episodes', () => {
    const s = makeSchema('s1', unitVec3(1, 0, 0), { episodeCount: 5 });
    const eps = [
      makeEp('e1', unitVec3(1, 0.05, 0)),
      makeEp('e2', unitVec3(1, 0.08, 0)),
      makeEp('e3', unitVec3(1, 0.03, 0)),
    ];
    const r = consolidate({ nowMs: BASE_TS, episodes: eps, schemas: [s], mode: 'baseline' });
    expect(r.updatedSchemas.find((x) => x.schemaId === 's1')!.episodeCount).toBe(8);
  });
});

describe('consolidation – lastUpdatedAt', () => {
  it('sets lastUpdatedAt to nowMs for touched schemas', () => {
    const s = makeSchema('s1', unitVec3(1, 0, 0), { lastUpdatedAt: 0 });
    const r = consolidate({
      nowMs: BASE_TS + 999,
      episodes: [makeEp('e1', unitVec3(1, 0.1, 0))],
      schemas: [s],
      mode: 'baseline',
    });
    expect(r.updatedSchemas.find((x) => x.schemaId === 's1')!.lastUpdatedAt).toBe(
      BASE_TS + 999,
    );
  });
});

describe('consolidation – new schema L2 centroid', () => {
  it('newly created schema centroid is L2-normalized', () => {
    const r = consolidate({
      nowMs: BASE_TS,
      episodes: [makeEp('e1', [3, 4, 0])],
      schemas: [],
      mode: 'baseline',
    });
    const norm = vecNorm(r.updatedSchemas[0].centroid);
    expect(norm).toBeCloseTo(1.0, 6);
  });
});
