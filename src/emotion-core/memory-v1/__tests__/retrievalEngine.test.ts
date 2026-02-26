import { retrieveSchemas, type RetrievalResult } from '../retrievalEngine';
import { applyRIF, applyBiasDecay, createRIFState, MAX_BIAS, type RIFState } from '../rif';
import { createGuardState, updateGuard, FLIP_WINDOW, FLIP_THRESHOLD, type RIFGuardState } from '../rifGuard';
import type { SchemaRecord } from '../schemaStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function vec3(x: number, y: number, z: number): number[] {
  return [x, y, z];
}

function unitVec3(x: number, y: number, z: number): number[] {
  const n = Math.sqrt(x * x + y * y + z * z);
  return n > 0 ? [x / n, y / n, z / n] : [0, 0, 0];
}

function makeSchema(
  id: string,
  centroid: number[],
  overrides: Partial<SchemaRecord> = {},
): SchemaRecord {
  return {
    schemaId: id,
    centroid,
    salienceWeight: 0.5,
    episodeCount: 1,
    retrievalBias: 0,
    createdAt: 0,
    lastUpdatedAt: 0,
    ...overrides,
  };
}

const defaultRIF: RIFState = { alpha: 0.04, beta: 0.02 };
const defaultGuard: RIFGuardState = createGuardState();

// ---------------------------------------------------------------------------
// 1. noMatch when cosine below threshold
// ---------------------------------------------------------------------------

describe('retrievalEngine – noMatch', () => {
  it('returns noMatch when max cosine < 0.50', () => {
    const query = unitVec3(1, 0, 0);
    const schemas = [makeSchema('s1', unitVec3(0, 1, 0))];
    const { result } = retrieveSchemas(query, schemas, defaultRIF, defaultGuard);
    expect(result.noMatch).toBe(true);
    expect(result.winnerId).toBeUndefined();
    expect(result.confidence).toBe(0);
  });

  it('returns noMatch for empty schemas', () => {
    const { result } = retrieveSchemas(unitVec3(1, 0, 0), [], defaultRIF, defaultGuard);
    expect(result.noMatch).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. bias cannot rescue low cosine
// ---------------------------------------------------------------------------

describe('retrievalEngine – bias cannot rescue', () => {
  it('high bias does not override noMatch when cosine is too low', () => {
    const query = unitVec3(1, 0, 0);
    const schemas = [makeSchema('s1', unitVec3(0, 1, 0), { retrievalBias: MAX_BIAS })];
    const { result } = retrieveSchemas(query, schemas, defaultRIF, defaultGuard);
    expect(result.noMatch).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. softmax probabilities sum to ~1
// ---------------------------------------------------------------------------

describe('retrievalEngine – softmax', () => {
  it('confidence and implicit probabilities are well-formed', () => {
    const query = unitVec3(1, 0, 0);
    const schemas = [
      makeSchema('s1', unitVec3(1, 0, 0)),
      makeSchema('s2', unitVec3(0.9, 0.44, 0)),
    ];
    schemas[1].centroid = unitVec3(0.9, 0.44, 0);
    const { result } = retrieveSchemas(query, schemas, defaultRIF, defaultGuard);
    expect(result.noMatch).toBe(false);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 4. temperature sensitivity
// ---------------------------------------------------------------------------

describe('retrievalEngine – temperature', () => {
  it('very similar schemas still produce a clear winner via softmax', () => {
    const query = unitVec3(1, 0, 0);
    const schemas = [
      makeSchema('close1', unitVec3(1, 0.01, 0)),
      makeSchema('close2', unitVec3(1, 0.02, 0)),
    ];
    const { result } = retrieveSchemas(query, schemas, defaultRIF, defaultGuard);
    expect(result.winnerId).toBeDefined();
    expect(result.confidence).toBeGreaterThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// 5. bias decay applied
// ---------------------------------------------------------------------------

describe('retrievalEngine – bias decay', () => {
  it('retrievalBias shrinks after retrieval call', () => {
    const query = unitVec3(1, 0, 0);
    const schemas = [
      makeSchema('s1', unitVec3(1, 0, 0), { retrievalBias: 0.10 }),
      makeSchema('s2', unitVec3(0.8, 0.6, 0), { retrievalBias: 0.10 }),
    ];
    const { updatedSchemas } = retrieveSchemas(query, schemas, defaultRIF, defaultGuard);
    const nonWinner = updatedSchemas.find((s) => s.schemaId !== 's1');
    // Bias decayed then RIF applied. The non-winner should have decayed + beta penalty.
    expect(nonWinner).toBeDefined();
    expect(Math.abs(nonWinner!.retrievalBias)).toBeLessThan(0.10);
  });
});

// ---------------------------------------------------------------------------
// 6–7. RIF winner increases, others decrease
// ---------------------------------------------------------------------------

describe('rif – bias updates', () => {
  it('winner bias increases', () => {
    const schemas = [
      makeSchema('w', unitVec3(1, 0, 0), { retrievalBias: 0.05 }),
      makeSchema('o', unitVec3(0, 1, 0), { retrievalBias: 0.05 }),
    ];
    const updated = applyRIF(schemas, 'w', 0.04, 0.02);
    expect(updated.find((s) => s.schemaId === 'w')!.retrievalBias).toBeGreaterThan(0.05);
  });

  it('non-winner bias decreases', () => {
    const schemas = [
      makeSchema('w', unitVec3(1, 0, 0), { retrievalBias: 0.05 }),
      makeSchema('o', unitVec3(0, 1, 0), { retrievalBias: 0.05 }),
    ];
    const updated = applyRIF(schemas, 'w', 0.04, 0.02);
    expect(updated.find((s) => s.schemaId === 'o')!.retrievalBias).toBeLessThan(0.05);
  });
});

// ---------------------------------------------------------------------------
// 8. bias clamp enforced
// ---------------------------------------------------------------------------

describe('rif – bias clamping', () => {
  it('bias cannot exceed MAX_BIAS', () => {
    const schemas = [makeSchema('s1', unitVec3(1, 0, 0), { retrievalBias: MAX_BIAS })];
    const updated = applyRIF(schemas, 's1', 1.0, 0);
    expect(updated[0].retrievalBias).toBeLessThanOrEqual(MAX_BIAS);
  });

  it('negative bias clamped to -MAX_BIAS', () => {
    const schemas = [makeSchema('s1', unitVec3(1, 0, 0), { retrievalBias: -MAX_BIAS })];
    const updated = applyRIF(schemas, 'other', 0, 1.0);
    expect(updated[0].retrievalBias).toBeGreaterThanOrEqual(-MAX_BIAS);
  });
});

// ---------------------------------------------------------------------------
// 9–10. Flip guard triggering
// ---------------------------------------------------------------------------

describe('rifGuard – flip detection', () => {
  it('triggers on alternating pattern A,B,A,B,A', () => {
    let guard = createGuardState();
    const sequence = ['A', 'B', 'A', 'B', 'A'];
    let result: ReturnType<typeof updateGuard> = { newGuard: guard, effectiveAlpha: 1, effectiveBeta: 1 };
    for (const w of sequence) {
      result = updateGuard(result.newGuard, w);
    }
    // flipRate = 4/4 = 1.0 > 0.60 → cooldown set
    expect(result.newGuard.cooldownRemaining).toBeGreaterThan(0);
    expect(result.effectiveAlpha).toBe(0.5);
    expect(result.effectiveBeta).toBe(0.5);
  });

  it('does NOT trigger on stable pattern A,A,A,B,B', () => {
    let guard = createGuardState();
    const sequence = ['A', 'A', 'A', 'B', 'B'];
    let result: ReturnType<typeof updateGuard> = { newGuard: guard, effectiveAlpha: 1, effectiveBeta: 1 };
    for (const w of sequence) {
      result = updateGuard(result.newGuard, w);
    }
    // flipRate = 1/4 = 0.25 < 0.60 → no cooldown
    // But need to check: after FLIP_WINDOW the cooldown check fires.
    // Since it didn't trigger, cooldown is 0 and alphas are 1.
    expect(result.effectiveAlpha).toBe(1);
    expect(result.effectiveBeta).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 11–12. Cooldown behavior
// ---------------------------------------------------------------------------

describe('rifGuard – cooldown', () => {
  it('halves alpha and beta during cooldown', () => {
    let guard: RIFGuardState = {
      recentWinners: ['A', 'B', 'A', 'B'],
      cooldownRemaining: 0,
    };
    // Next push triggers (flipRate = 1.0 after adding 'A')
    const r = updateGuard(guard, 'A');
    expect(r.effectiveAlpha).toBe(0.5);
    expect(r.effectiveBeta).toBe(0.5);
    expect(r.newGuard.cooldownRemaining).toBeGreaterThan(0);
  });

  it('cooldown decrements each call', () => {
    let guard: RIFGuardState = {
      recentWinners: ['A', 'B', 'A', 'B'],
      cooldownRemaining: 0,
    };
    let r = updateGuard(guard, 'A');
    const c1 = r.newGuard.cooldownRemaining;

    r = updateGuard(r.newGuard, 'A');
    const c2 = r.newGuard.cooldownRemaining;
    expect(c2).toBeLessThan(c1);

    r = updateGuard(r.newGuard, 'A');
    const c3 = r.newGuard.cooldownRemaining;
    expect(c3).toBeLessThan(c2);
  });
});

// ---------------------------------------------------------------------------
// 13. Ring buffer size fixed
// ---------------------------------------------------------------------------

describe('rifGuard – ring buffer', () => {
  it('never exceeds FLIP_WINDOW entries', () => {
    let guard = createGuardState();
    for (let i = 0; i < 20; i++) {
      const r = updateGuard(guard, `w${i}`);
      guard = r.newGuard;
    }
    expect(guard.recentWinners.length).toBeLessThanOrEqual(FLIP_WINDOW);
  });
});

// ---------------------------------------------------------------------------
// 14. Deterministic ordering
// ---------------------------------------------------------------------------

describe('retrievalEngine – deterministic ordering', () => {
  it('topSchemaIds are sorted by descending probability', () => {
    const query = unitVec3(1, 0, 0);
    const schemas = [
      makeSchema('far', unitVec3(0.7, 0.7, 0)),
      makeSchema('near', unitVec3(1, 0.05, 0)),
    ];
    const { result } = retrieveSchemas(query, schemas, defaultRIF, defaultGuard);
    expect(result.topSchemaIds[0]).toBe('near');
    expect(result.topSchemaIds[1]).toBe('far');
  });
});

// ---------------------------------------------------------------------------
// 15. NaN safety
// ---------------------------------------------------------------------------

describe('retrievalEngine – NaN safety', () => {
  it('no NaN in result with NaN in query vector', () => {
    const query = [NaN, 0, 1];
    const schemas = [makeSchema('s1', unitVec3(1, 0, 0))];
    const { result, updatedSchemas } = retrieveSchemas(query, schemas, defaultRIF, defaultGuard);
    expect(Number.isFinite(result.confidence)).toBe(true);
    for (const s of updatedSchemas) {
      expect(Number.isFinite(s.retrievalBias)).toBe(true);
    }
  });

  it('no NaN in result with NaN in centroid', () => {
    const query = unitVec3(1, 0, 0);
    const schemas = [makeSchema('s1', [NaN, 0, 1])];
    const { result } = retrieveSchemas(query, schemas, defaultRIF, defaultGuard);
    expect(Number.isFinite(result.confidence)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 16. confidence in [0,1]
// ---------------------------------------------------------------------------

describe('retrievalEngine – confidence bounds', () => {
  it('confidence is always in [0,1]', () => {
    const query = unitVec3(1, 0, 0);
    const schemas = [
      makeSchema('s1', unitVec3(1, 0, 0)),
      makeSchema('s2', unitVec3(0.9, 0.44, 0)),
      makeSchema('s3', unitVec3(0.7, 0.7, 0)),
    ];
    const { result } = retrieveSchemas(query, schemas, defaultRIF, defaultGuard);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 17. winner undefined in noMatch
// ---------------------------------------------------------------------------

describe('retrievalEngine – winner in noMatch', () => {
  it('winnerId is undefined when noMatch', () => {
    const query = unitVec3(1, 0, 0);
    const schemas = [makeSchema('s1', unitVec3(0, 0, 1))];
    const { result } = retrieveSchemas(query, schemas, defaultRIF, defaultGuard);
    expect(result.noMatch).toBe(true);
    expect(result.winnerId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 18. updatedSchemas immutable
// ---------------------------------------------------------------------------

describe('retrievalEngine – immutability', () => {
  it('does not mutate input schemas array', () => {
    const query = unitVec3(1, 0, 0);
    const schemas = [
      makeSchema('s1', unitVec3(1, 0, 0), { retrievalBias: 0.05 }),
    ];
    const origBias = schemas[0].retrievalBias;
    retrieveSchemas(query, schemas, defaultRIF, defaultGuard);
    expect(schemas[0].retrievalBias).toBe(origBias);
  });

  it('does not mutate input guard state', () => {
    const query = unitVec3(1, 0, 0);
    const schemas = [makeSchema('s1', unitVec3(1, 0, 0))];
    const guard = createGuardState();
    const origLen = guard.recentWinners.length;
    retrieveSchemas(query, schemas, defaultRIF, guard);
    expect(guard.recentWinners.length).toBe(origLen);
  });
});

// ---------------------------------------------------------------------------
// 19. retrievalBias preserved across noMatch
// ---------------------------------------------------------------------------

describe('retrievalEngine – bias preserved in noMatch', () => {
  it('biases stay unchanged when noMatch', () => {
    const query = unitVec3(1, 0, 0);
    const schemas = [
      makeSchema('s1', unitVec3(0, 1, 0), { retrievalBias: 0.12 }),
    ];
    const { updatedSchemas } = retrieveSchemas(query, schemas, defaultRIF, defaultGuard);
    expect(updatedSchemas[0].retrievalBias).toBe(0.12);
  });
});

// ---------------------------------------------------------------------------
// 20–21. MAX_BIAS ceiling and negative clamp
// ---------------------------------------------------------------------------

describe('rif – MAX_BIAS enforcement', () => {
  it('repeated RIF cannot push bias above MAX_BIAS', () => {
    let schemas = [makeSchema('s1', unitVec3(1, 0, 0), { retrievalBias: 0 })];
    for (let i = 0; i < 100; i++) {
      schemas = applyRIF(schemas, 's1', 0.5, 0);
    }
    expect(schemas[0].retrievalBias).toBeLessThanOrEqual(MAX_BIAS);
  });

  it('repeated negative RIF cannot push bias below -MAX_BIAS', () => {
    let schemas = [makeSchema('s1', unitVec3(1, 0, 0), { retrievalBias: 0 })];
    for (let i = 0; i < 100; i++) {
      schemas = applyRIF(schemas, 'other', 0, 0.5);
    }
    expect(schemas[0].retrievalBias).toBeGreaterThanOrEqual(-MAX_BIAS);
  });
});

// ---------------------------------------------------------------------------
// 22. Single schema edge case
// ---------------------------------------------------------------------------

describe('retrievalEngine – single schema', () => {
  it('works with exactly one schema above threshold', () => {
    const query = unitVec3(1, 0, 0);
    const schemas = [makeSchema('only', unitVec3(1, 0, 0))];
    const { result } = retrieveSchemas(query, schemas, defaultRIF, defaultGuard);
    expect(result.noMatch).toBe(false);
    expect(result.winnerId).toBe('only');
    expect(result.confidence).toBeCloseTo(1.0, 3);
  });
});

// ---------------------------------------------------------------------------
// 23. Many schemas edge case
// ---------------------------------------------------------------------------

describe('retrievalEngine – many schemas', () => {
  it('handles 50 schemas without error', () => {
    const query = unitVec3(1, 0, 0);
    const schemas: SchemaRecord[] = [];
    for (let i = 0; i < 50; i++) {
      const angle = (i / 50) * 0.4;
      schemas.push(makeSchema(`s${i}`, unitVec3(Math.cos(angle), Math.sin(angle), 0)));
    }
    const { result, updatedSchemas } = retrieveSchemas(query, schemas, defaultRIF, defaultGuard);
    expect(result.noMatch).toBe(false);
    expect(updatedSchemas.length).toBe(50);
    expect(result.topSchemaIds.length).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// 25. Stable winner across identical inputs
// ---------------------------------------------------------------------------

describe('retrievalEngine – stability', () => {
  it('same input produces same winner repeatedly', () => {
    const query = unitVec3(1, 0, 0);
    const schemas = [
      makeSchema('s1', unitVec3(1, 0.05, 0)),
      makeSchema('s2', unitVec3(0.8, 0.6, 0)),
    ];
    const winners = new Set<string>();
    let guard = defaultGuard;
    let currentSchemas = schemas;
    for (let i = 0; i < 5; i++) {
      const r = retrieveSchemas(query, currentSchemas, defaultRIF, guard);
      if (r.result.winnerId) winners.add(r.result.winnerId);
      currentSchemas = r.updatedSchemas;
      guard = r.updatedGuard;
    }
    expect(winners.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 26. Bias decay approximate half-life
// ---------------------------------------------------------------------------

describe('rif – bias decay half-life', () => {
  it('bias decays toward zero over many rounds of decay', () => {
    let schemas = [makeSchema('s1', unitVec3(1, 0, 0), { retrievalBias: 0.10 })];
    for (let i = 0; i < 70; i++) {
      schemas = applyBiasDecay(schemas, 0.01);
    }
    // After 70 rounds: 0.10 * (0.99)^70 ≈ 0.0496
    expect(schemas[0].retrievalBias).toBeLessThan(0.06);
    expect(schemas[0].retrievalBias).toBeGreaterThan(0.03);
  });
});

// ---------------------------------------------------------------------------
// 27. No mutation of input arrays
// ---------------------------------------------------------------------------

describe('rif – no mutation', () => {
  it('applyRIF returns new array', () => {
    const schemas = [makeSchema('s1', unitVec3(1, 0, 0), { retrievalBias: 0.05 })];
    const updated = applyRIF(schemas, 's1', 0.04, 0.02);
    expect(updated).not.toBe(schemas);
    expect(schemas[0].retrievalBias).toBe(0.05);
  });

  it('applyBiasDecay returns new array', () => {
    const schemas = [makeSchema('s1', unitVec3(1, 0, 0), { retrievalBias: 0.10 })];
    const decayed = applyBiasDecay(schemas, 0.01);
    expect(decayed).not.toBe(schemas);
    expect(schemas[0].retrievalBias).toBe(0.10);
  });
});

// ---------------------------------------------------------------------------
// 28. Guard resets properly
// ---------------------------------------------------------------------------

describe('rifGuard – reset', () => {
  it('cooldown eventually reaches 0 and stops halving', () => {
    let guard: RIFGuardState = {
      recentWinners: ['A', 'B', 'A', 'B'],
      cooldownRemaining: 0,
    };
    // Trigger cooldown
    let r = updateGuard(guard, 'A');
    expect(r.newGuard.cooldownRemaining).toBeGreaterThan(0);

    // Drain cooldown with stable winner
    for (let i = 0; i < FLIP_WINDOW + 2; i++) {
      r = updateGuard(r.newGuard, 'A');
    }
    expect(r.newGuard.cooldownRemaining).toBe(0);
    expect(r.effectiveAlpha).toBe(1);
    expect(r.effectiveBeta).toBe(1);
  });
});
