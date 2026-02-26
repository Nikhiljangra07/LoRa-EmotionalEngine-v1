import { buildMemoryContext } from '../memoryContext';
import type { BuildMemoryContextInput } from '../memoryContextTypes';
import { getMemoryV1Policy } from '../policyMap';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(
  overrides: Partial<BuildMemoryContextInput> = {},
): BuildMemoryContextInput {
  return {
    results: [
      { schemaId: 's1', prob: 0.7, sim: 0.8 },
      { schemaId: 's2', prob: 0.2, sim: 0.6 },
    ],
    schemasById: {
      s1: { schemaId: 's1', trajectoryLabel: 'calm-stable', tendencyLabel: 'responds-to-validation' },
      s2: { schemaId: 's2', trajectoryLabel: 'volatile', tendencyLabel: 'needs-structure' },
    },
    thetaRetrieve: 0.40,
    cMin: 0.30,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. null when results empty
// ---------------------------------------------------------------------------

describe('memoryContext – null gates', () => {
  it('returns null when results array is empty', () => {
    expect(buildMemoryContext(makeInput({ results: [] }))).toBeNull();
  });

  // 2. null when bestSim below thetaRetrieve
  it('returns null when bestSim < thetaRetrieve even if prob is high', () => {
    const r = buildMemoryContext(makeInput({
      results: [{ schemaId: 's1', prob: 0.9, sim: 0.35 }],
      thetaRetrieve: 0.40,
    }));
    expect(r).toBeNull();
  });

  // 3. null when bestProb below cMin
  it('returns null when bestProb < cMin even if sim is high', () => {
    const r = buildMemoryContext(makeInput({
      results: [{ schemaId: 's1', prob: 0.20, sim: 0.90 }],
      cMin: 0.30,
    }));
    expect(r).toBeNull();
  });

  it('returns null when sim is NaN', () => {
    const r = buildMemoryContext(makeInput({
      results: [{ schemaId: 's1', prob: 0.5, sim: NaN }],
    }));
    expect(r).toBeNull();
  });

  it('returns null when prob is NaN', () => {
    const r = buildMemoryContext(makeInput({
      results: [{ schemaId: 's1', prob: NaN, sim: 0.8 }],
    }));
    expect(r).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Confidence mapping
// ---------------------------------------------------------------------------

describe('memoryContext – confidenceLevel', () => {
  it('HIGH when bestProb >= 0.60', () => {
    const r = buildMemoryContext(makeInput({
      results: [{ schemaId: 's1', prob: 0.65, sim: 0.8 }],
    }));
    expect(r!.confidenceLevel).toBe('HIGH');
  });

  it('MED when bestProb >= 0.40 and < 0.60', () => {
    const r = buildMemoryContext(makeInput({
      results: [{ schemaId: 's1', prob: 0.45, sim: 0.8 }],
    }));
    expect(r!.confidenceLevel).toBe('MED');
  });

  it('LOW when bestProb < 0.40 (and cMin allows)', () => {
    const r = buildMemoryContext(makeInput({
      results: [{ schemaId: 's1', prob: 0.35, sim: 0.8 }],
      cMin: 0.30,
    }));
    expect(r!.confidenceLevel).toBe('LOW');
  });

  it('exactly 0.60 is HIGH', () => {
    const r = buildMemoryContext(makeInput({
      results: [{ schemaId: 's1', prob: 0.60, sim: 0.8 }],
    }));
    expect(r!.confidenceLevel).toBe('HIGH');
  });

  it('exactly 0.40 is MED', () => {
    const r = buildMemoryContext(makeInput({
      results: [{ schemaId: 's1', prob: 0.40, sim: 0.8 }],
    }));
    expect(r!.confidenceLevel).toBe('MED');
  });
});

// ---------------------------------------------------------------------------
// 5. Relevance mapping
// ---------------------------------------------------------------------------

describe('memoryContext – relevance', () => {
  it('HIGH when prob >= 0.50', () => {
    const r = buildMemoryContext(makeInput({
      results: [{ schemaId: 's1', prob: 0.55, sim: 0.8 }],
    }));
    expect(r!.topSchemas[0].relevance).toBe('HIGH');
  });

  it('MED when prob >= 0.25 and < 0.50', () => {
    const r = buildMemoryContext(makeInput({
      results: [
        { schemaId: 's1', prob: 0.60, sim: 0.8 },
        { schemaId: 's2', prob: 0.30, sim: 0.7 },
      ],
    }));
    const s2 = r!.topSchemas.find((s) => s.schemaId === 's2');
    expect(s2!.relevance).toBe('MED');
  });

  it('LOW when prob < 0.25', () => {
    const r = buildMemoryContext(makeInput({
      results: [
        { schemaId: 's1', prob: 0.60, sim: 0.8 },
        { schemaId: 's2', prob: 0.10, sim: 0.5 },
      ],
    }));
    const s2 = r!.topSchemas.find((s) => s.schemaId === 's2');
    expect(s2!.relevance).toBe('LOW');
  });
});

// ---------------------------------------------------------------------------
// 6. Trajectory / tendency sanitization
// ---------------------------------------------------------------------------

describe('memoryContext – label sanitization', () => {
  it('valid trajectoryLabel passes through', () => {
    const r = buildMemoryContext(makeInput());
    expect(r!.topSchemas[0].emotionTrajectory).toBe('calm-stable');
  });

  it('invalid trajectoryLabel becomes unknown', () => {
    const r = buildMemoryContext(makeInput({
      schemasById: {
        s1: { schemaId: 's1', trajectoryLabel: 'made-up-label' },
        s2: { schemaId: 's2' },
      },
    }));
    expect(r!.topSchemas[0].emotionTrajectory).toBe('unknown');
  });

  it('missing trajectoryLabel becomes unknown', () => {
    const r = buildMemoryContext(makeInput({
      schemasById: { s1: { schemaId: 's1' }, s2: { schemaId: 's2' } },
    }));
    expect(r!.topSchemas[0].emotionTrajectory).toBe('unknown');
  });

  it('valid tendencyLabel passes through', () => {
    const r = buildMemoryContext(makeInput());
    expect(r!.topSchemas[0].behavioralTendency).toBe('responds-to-validation');
  });

  it('invalid tendencyLabel becomes unknown', () => {
    const r = buildMemoryContext(makeInput({
      schemasById: {
        s1: { schemaId: 's1', tendencyLabel: 'nonsense' },
        s2: { schemaId: 's2' },
      },
    }));
    expect(r!.topSchemas[0].behavioralTendency).toBe('unknown');
  });

  it('missing schema metadata still produces unknown labels', () => {
    const r = buildMemoryContext(makeInput({ schemasById: {} }));
    expect(r!.topSchemas[0].emotionTrajectory).toBe('unknown');
    expect(r!.topSchemas[0].behavioralTendency).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// 7. Sorting
// ---------------------------------------------------------------------------

describe('memoryContext – sorting', () => {
  it('sorts by prob desc', () => {
    const r = buildMemoryContext(makeInput({
      results: [
        { schemaId: 's1', prob: 0.3, sim: 0.8 },
        { schemaId: 's2', prob: 0.5, sim: 0.8 },
      ],
      schemasById: {
        s1: { schemaId: 's1' },
        s2: { schemaId: 's2' },
      },
    }));
    expect(r!.topSchemas[0].schemaId).toBe('s2');
    expect(r!.topSchemas[1].schemaId).toBe('s1');
  });

  it('breaks prob tie by schemaId ascending', () => {
    const r = buildMemoryContext(makeInput({
      results: [
        { schemaId: 'b', prob: 0.5, sim: 0.8 },
        { schemaId: 'a', prob: 0.5, sim: 0.8 },
      ],
      schemasById: {
        a: { schemaId: 'a' },
        b: { schemaId: 'b' },
      },
    }));
    expect(r!.topSchemas[0].schemaId).toBe('a');
    expect(r!.topSchemas[1].schemaId).toBe('b');
  });
});

// ---------------------------------------------------------------------------
// 8. Truncation to top 3
// ---------------------------------------------------------------------------

describe('memoryContext – truncation', () => {
  it('includes at most 3 schemas even with more results', () => {
    const r = buildMemoryContext(makeInput({
      results: [
        { schemaId: 's1', prob: 0.5, sim: 0.8 },
        { schemaId: 's2', prob: 0.4, sim: 0.7 },
        { schemaId: 's3', prob: 0.3, sim: 0.6 },
        { schemaId: 's4', prob: 0.2, sim: 0.5 },
        { schemaId: 's5', prob: 0.1, sim: 0.5 },
      ],
      schemasById: {
        s1: { schemaId: 's1' }, s2: { schemaId: 's2' },
        s3: { schemaId: 's3' }, s4: { schemaId: 's4' },
        s5: { schemaId: 's5' },
      },
    }));
    expect(r!.topSchemas.length).toBe(3);
    expect(r!.topSchemas.map((s) => s.schemaId)).toEqual(['s1', 's2', 's3']);
  });

  it('returns fewer than 3 when fewer results exist', () => {
    const r = buildMemoryContext(makeInput({
      results: [{ schemaId: 's1', prob: 0.5, sim: 0.8 }],
    }));
    expect(r!.topSchemas.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 9. No numeric leakage
// ---------------------------------------------------------------------------

describe('memoryContext – no numeric leakage', () => {
  it('serialized output contains no floating-point numbers', () => {
    const r = buildMemoryContext(makeInput());
    const json = JSON.stringify(r);
    // Match any standalone decimal number like 0.7 or 3.14 — should not appear
    expect(json).not.toMatch(/\d+\.\d+/);
  });
});

// ---------------------------------------------------------------------------
// 10. Determinism
// ---------------------------------------------------------------------------

describe('memoryContext – determinism', () => {
  it('identical inputs produce identical outputs', () => {
    const inp = makeInput();
    const r1 = buildMemoryContext(inp);
    const r2 = buildMemoryContext(inp);
    expect(r1).toEqual(r2);
  });

  it('repeated calls with shuffled results produce same output', () => {
    const base = makeInput({
      results: [
        { schemaId: 'c', prob: 0.5, sim: 0.8 },
        { schemaId: 'a', prob: 0.5, sim: 0.8 },
        { schemaId: 'b', prob: 0.3, sim: 0.7 },
      ],
      schemasById: {
        a: { schemaId: 'a' },
        b: { schemaId: 'b' },
        c: { schemaId: 'c' },
      },
    });
    const shuffled: BuildMemoryContextInput = {
      ...base,
      results: [base.results[2], base.results[0], base.results[1]],
    };
    const r1 = buildMemoryContext(base);
    const r2 = buildMemoryContext(shuffled);
    expect(r1).toEqual(r2);
  });
});

// ---------------------------------------------------------------------------
// 11. sessionPattern
// ---------------------------------------------------------------------------

describe('memoryContext – sessionPattern', () => {
  it('always returns unknown in V1', () => {
    const r = buildMemoryContext(makeInput());
    expect(r!.sessionPattern).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// 12. Governor (policy-based)
// ---------------------------------------------------------------------------

describe('memoryContext – governor (MemoryV1Policy)', () => {
  it('B0 policy returns null (no prompt injection)', () => {
    const r = buildMemoryContext(makeInput({ policy: getMemoryV1Policy('B0') }));
    expect(r).toBeNull();
  });

  it('B1 policy returns null (no prompt injection)', () => {
    const r = buildMemoryContext(makeInput({ policy: getMemoryV1Policy('B1') }));
    expect(r).toBeNull();
  });

  it('B2 policy caps schemas to 1 and omits tendency', () => {
    const r = buildMemoryContext(makeInput({ policy: getMemoryV1Policy('B2') }));
    expect(r).not.toBeNull();
    expect(r!.topSchemas.length).toBeLessThanOrEqual(1);
    for (const s of r!.topSchemas) {
      expect(s.behavioralTendency).toBe('omitted');
      expect(s.emotionTrajectory).not.toBe('omitted');
    }
  });

  it('B2 policy omits sessionPattern', () => {
    const r = buildMemoryContext(makeInput({ policy: getMemoryV1Policy('B2') }));
    expect(r!.sessionPattern).toBe('omitted');
  });

  it('B3 policy caps schemas to 2, omits tendency, allows sessionPattern', () => {
    const input = makeInput({
      results: [
        { schemaId: 's1', prob: 0.7, sim: 0.8 },
        { schemaId: 's2', prob: 0.5, sim: 0.7 },
        { schemaId: 's3', prob: 0.3, sim: 0.6 },
      ],
      schemasById: {
        s1: { schemaId: 's1', trajectoryLabel: 'calm-stable', tendencyLabel: 'responds-to-validation' },
        s2: { schemaId: 's2', trajectoryLabel: 'volatile', tendencyLabel: 'needs-structure' },
        s3: { schemaId: 's3', trajectoryLabel: 'recovering' },
      },
      policy: getMemoryV1Policy('B3'),
    });
    const r = buildMemoryContext(input);
    expect(r).not.toBeNull();
    expect(r!.topSchemas.length).toBeLessThanOrEqual(2);
    for (const s of r!.topSchemas) {
      expect(s.behavioralTendency).toBe('omitted');
    }
    expect(r!.sessionPattern).not.toBe('omitted');
  });

  it('B4 policy allows up to 3 schemas with tendency', () => {
    const input = makeInput({
      results: [
        { schemaId: 's1', prob: 0.7, sim: 0.8 },
        { schemaId: 's2', prob: 0.5, sim: 0.7 },
        { schemaId: 's3', prob: 0.3, sim: 0.6 },
      ],
      schemasById: {
        s1: { schemaId: 's1', trajectoryLabel: 'calm-stable', tendencyLabel: 'responds-to-validation' },
        s2: { schemaId: 's2', trajectoryLabel: 'volatile', tendencyLabel: 'needs-structure' },
        s3: { schemaId: 's3', trajectoryLabel: 'recovering', tendencyLabel: 'resists-directiveness' },
      },
      policy: getMemoryV1Policy('B4'),
    });
    const r = buildMemoryContext(input);
    expect(r).not.toBeNull();
    expect(r!.topSchemas.length).toBeLessThanOrEqual(3);
    for (const s of r!.topSchemas) {
      expect(s.behavioralTendency).not.toBe('omitted');
      expect(s.emotionTrajectory).not.toBe('omitted');
    }
  });

  it('governed output contains no raw floats', () => {
    const r = buildMemoryContext(makeInput({ policy: getMemoryV1Policy('B4') }));
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/\d+\.\d+/);
  });

  it('no policy (undefined) preserves backward-compatible behavior', () => {
    const withPolicy = buildMemoryContext(makeInput());
    const without = buildMemoryContext(makeInput({ policy: undefined }));
    expect(withPolicy).toEqual(without);
  });
});
