/**
 * Tests for the merge_datasets module.
 *
 * All tests use small in-memory fixtures — no dependency on real 7k-row files.
 */

import {
  mergeDatasets,
  MergeConfig,
  MergeResult,
  SyntheticRawRow,
  normalizeTextForId,
  generateDeterministicId,
  prefixId,
  injectISEARProvenance,
  convertSyntheticRow,
  formatReport,
} from '../dataset/merge_datasets';
import { AppraisalRow, MergedAppraisalRow } from '../types';
import { validateMergedRow } from '../schema';

// ============================================================
// Fixtures
// ============================================================

function makeIsearRow(overrides: Partial<AppraisalRow> = {}): AppraisalRow {
  return {
    id:       'ISEAR-001',
    text:     'I felt angry when ignored.',
    emotion:  'ANGER',
    appraisals: {
      valence: 'NEG', arousal: 'HIGH', agency: 'OTHER',
      control: 'HIGH', certainty: 'HIGH', goalRelevance: 'HIGH',
    },
    ...overrides,
  };
}

function makeSyntheticRow(overrides: Partial<SyntheticRawRow> = {}): SyntheticRawRow {
  return {
    id:        'synthetic_disgust_0001',
    sentiment: 'DISGUST',
    content:   'The food stall had unsanitary conditions.',
    ...overrides,
  };
}

function makeMergeConfig(
  isearRows: AppraisalRow[],
  syntheticRows: SyntheticRawRow[],
  overrides: Partial<MergeConfig> = {},
): MergeConfig {
  return {
    isearData:          isearRows,
    syntheticData:      syntheticRows,
    isearPath:          'test/isear.json',
    syntheticPath:      'test/synthetic.json',
    syntheticGenerator: 'OPUS_v1',
    failOnCollision:    true,
    ...overrides,
  };
}

// ============================================================
// normalizeTextForId
// ============================================================

describe('normalizeTextForId', () => {
  it('lowercases text', () => {
    expect(normalizeTextForId('HELLO')).toBe('hello');
  });

  it('collapses whitespace', () => {
    expect(normalizeTextForId('a   b\t\nc')).toBe('a b c');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeTextForId('  foo  ')).toBe('foo');
  });
});

// ============================================================
// generateDeterministicId
// ============================================================

describe('generateDeterministicId', () => {
  it('returns the same id for the same inputs', () => {
    const a = generateDeterministicId('hello world', 'ANGER', 0);
    const b = generateDeterministicId('hello world', 'ANGER', 0);
    expect(a).toBe(b);
  });

  it('returns different ids for different text', () => {
    const a = generateDeterministicId('hello', 'ANGER', 0);
    const b = generateDeterministicId('goodbye', 'ANGER', 0);
    expect(a).not.toBe(b);
  });

  it('returns different ids for different emotions', () => {
    const a = generateDeterministicId('hello', 'ANGER', 0);
    const b = generateDeterministicId('hello', 'JOY', 0);
    expect(a).not.toBe(b);
  });

  it('returns a 12-char hex string', () => {
    const id = generateDeterministicId('test', 'FEAR', 5);
    expect(id).toMatch(/^[0-9a-f]{12}$/);
  });
});

// ============================================================
// prefixId
// ============================================================

describe('prefixId', () => {
  it('keeps ISEAR-prefixed IDs unchanged', () => {
    expect(prefixId('ISEAR-001', 'ISEAR')).toBe('ISEAR-001');
  });

  it('prepends ISEAR_ to unprefixed IDs', () => {
    expect(prefixId('abc123', 'ISEAR')).toBe('ISEAR_abc123');
  });

  it('keeps SYN_-prefixed IDs unchanged', () => {
    expect(prefixId('SYN_abc', 'SYNTHETIC')).toBe('SYN_abc');
  });

  it('prepends SYN_ to unprefixed synthetic IDs', () => {
    expect(prefixId('synthetic_disgust_0001', 'SYNTHETIC')).toBe('SYN_synthetic_disgust_0001');
  });
});

// ============================================================
// injectISEARProvenance
// ============================================================

describe('injectISEARProvenance', () => {
  it('sets source to ISEAR', () => {
    const result = injectISEARProvenance(makeIsearRow(), 0);
    expect(result.source).toBe('ISEAR');
  });

  it('sets generator to null', () => {
    const result = injectISEARProvenance(makeIsearRow(), 0);
    expect(result.generator).toBeNull();
  });

  it('sets created_at to null', () => {
    const result = injectISEARProvenance(makeIsearRow(), 0);
    expect(result.created_at).toBeNull();
  });

  it('preserves text, emotion, and appraisals', () => {
    const row = makeIsearRow();
    const result = injectISEARProvenance(row, 0);
    expect(result.text).toBe(row.text);
    expect(result.emotion).toBe(row.emotion);
    expect(result.appraisals.valence).toBe(row.appraisals.valence);
  });
});

// ============================================================
// convertSyntheticRow
// ============================================================

describe('convertSyntheticRow', () => {
  it('maps sentiment to emotion', () => {
    const result = convertSyntheticRow(makeSyntheticRow(), 0, 'OPUS_v1');
    expect(result.emotion).toBe('DISGUST');
  });

  it('maps content to text', () => {
    const raw = makeSyntheticRow();
    const result = convertSyntheticRow(raw, 0, 'OPUS_v1');
    expect(result.text).toBe(raw.content);
  });

  it('applies locked appraisal vector for DISGUST', () => {
    const result = convertSyntheticRow(makeSyntheticRow(), 0, 'OPUS_v1');
    expect(result.appraisals.valence).toBe('NEG');
    expect(result.appraisals.arousal).toBe('MED');
    expect(result.appraisals.agency).toBe('SITUATION');
    expect(result.appraisals.control).toBe('LOW');
  });

  it('applies locked appraisal vector for NEUTRAL', () => {
    const raw = makeSyntheticRow({ id: 'synthetic_neutral_0001', sentiment: 'NEUTRAL', content: 'A routine day.' });
    const result = convertSyntheticRow(raw, 0, 'OPUS_v1');
    expect(result.appraisals.valence).toBe('NEU');
    expect(result.appraisals.arousal).toBe('LOW');
    expect(result.appraisals.agency).toBe('SITUATION');
    expect(result.appraisals.control).toBe('MED');
  });

  it('sets source to SYNTHETIC and generator', () => {
    const result = convertSyntheticRow(makeSyntheticRow(), 0, 'OPUS_v1');
    expect(result.source).toBe('SYNTHETIC');
    expect(result.generator).toBe('OPUS_v1');
  });

  it('throws for unknown sentiment', () => {
    const raw = makeSyntheticRow({ sentiment: 'UNKNOWN' });
    expect(() => convertSyntheticRow(raw, 0, 'OPUS_v1')).toThrow(/Unknown sentiment/);
  });
});

// ============================================================
// mergeDatasets — counts and ordering
// ============================================================

describe('mergeDatasets', () => {
  const isearRows: AppraisalRow[] = [
    makeIsearRow({ id: 'ISEAR-001', text: 'angry text' }),
    makeIsearRow({ id: 'ISEAR-002', text: 'sad text', emotion: 'SADNESS',
      appraisals: { valence: 'NEG', arousal: 'LOW', agency: 'SITUATION', control: 'LOW', certainty: 'HIGH', goalRelevance: 'HIGH' },
    }),
  ];

  const syntheticRows: SyntheticRawRow[] = [
    makeSyntheticRow({ id: 'synthetic_disgust_0001' }),
    makeSyntheticRow({ id: 'synthetic_neutral_0001', sentiment: 'NEUTRAL', content: 'Morning routine.' }),
  ];

  let result: MergeResult;

  beforeAll(() => {
    result = mergeDatasets(makeMergeConfig(isearRows, syntheticRows));
  });

  it('produces correct total count', () => {
    expect(result.rows.length).toBe(4);
    expect(result.report.merged_total).toBe(4);
  });

  it('reports correct per-source counts', () => {
    expect(result.report.isear_count).toBe(2);
    expect(result.report.synthetic_count).toBe(2);
  });

  it('has zero collisions', () => {
    expect(result.report.collision_count).toBe(0);
  });

  it('places ISEAR rows before synthetic rows', () => {
    expect(result.rows[0].source).toBe('ISEAR');
    expect(result.rows[1].source).toBe('ISEAR');
    expect(result.rows[2].source).toBe('SYNTHETIC');
    expect(result.rows[3].source).toBe('SYNTHETIC');
  });

  it('reports emotion distribution', () => {
    expect(result.report.emotion_distribution['ANGER']).toBe(1);
    expect(result.report.emotion_distribution['SADNESS']).toBe(1);
    expect(result.report.emotion_distribution['DISGUST']).toBe(1);
    expect(result.report.emotion_distribution['NEUTRAL']).toBe(1);
  });
});

// ============================================================
// Provenance injection when missing
// ============================================================

describe('provenance injection', () => {
  it('ISEAR rows get source=ISEAR, generator=null', () => {
    const result = mergeDatasets(makeMergeConfig(
      [makeIsearRow()],
      [],
    ));
    expect(result.rows[0].source).toBe('ISEAR');
    expect(result.rows[0].generator).toBeNull();
  });

  it('synthetic rows get source=SYNTHETIC, generator=OPUS_v1', () => {
    const result = mergeDatasets(makeMergeConfig(
      [],
      [makeSyntheticRow()],
    ));
    expect(result.rows[0].source).toBe('SYNTHETIC');
    expect(result.rows[0].generator).toBe('OPUS_v1');
  });
});

// ============================================================
// ID prefixing and collision prevention
// ============================================================

describe('ID collision prevention', () => {
  it('rows with same original id across sources get different final ids', () => {
    const isear = [makeIsearRow({ id: 'shared_id' })];
    const synthetic = [makeSyntheticRow({ id: 'shared_id' })];

    const result = mergeDatasets(makeMergeConfig(isear, synthetic));
    const ids = result.rows.map(r => r.id);
    expect(ids[0]).not.toBe(ids[1]);
    expect(result.report.collision_count).toBe(0);
  });

  it('fails on collision when failOnCollision=true and IDs actually collide', () => {
    const isear1 = makeIsearRow({ id: 'ISEAR-001' });
    const isear2 = makeIsearRow({ id: 'ISEAR-001', text: 'different text' });

    expect(() =>
      mergeDatasets(makeMergeConfig([isear1, isear2], [])),
    ).toThrow(/collision/i);
  });
});

// ============================================================
// Deterministic ID generation (when id is missing)
// ============================================================

describe('deterministic ID generation', () => {
  it('two runs on the same fixture produce identical ids', () => {
    const isear = [makeIsearRow({ id: '' })];
    const synthetic = [makeSyntheticRow({ id: '' })];

    const run1 = mergeDatasets(makeMergeConfig(isear, synthetic));
    const run2 = mergeDatasets(makeMergeConfig(isear, synthetic));

    expect(run1.rows[0].id).toBe(run2.rows[0].id);
    expect(run1.rows[1].id).toBe(run2.rows[1].id);
  });
});

// ============================================================
// Output schema sanity
// ============================================================

describe('output schema sanity', () => {
  it('every merged row has all required provenance fields', () => {
    const result = mergeDatasets(makeMergeConfig(
      [makeIsearRow()],
      [makeSyntheticRow()],
    ));

    for (const row of result.rows) {
      expect(row).toHaveProperty('source');
      expect(row).toHaveProperty('generator');
      expect(row).toHaveProperty('created_at');
      expect(row).toHaveProperty('id');
      expect(row).toHaveProperty('text');
      expect(row).toHaveProperty('emotion');
      expect(row).toHaveProperty('appraisals');
    }
  });

  it('every merged row passes validateMergedRow()', () => {
    const result = mergeDatasets(makeMergeConfig(
      [
        makeIsearRow({ id: 'ISEAR-001' }),
        makeIsearRow({ id: 'ISEAR-002', text: 'happy times', emotion: 'JOY',
          appraisals: { valence: 'POS', arousal: 'MED', agency: 'SELF', control: 'HIGH', certainty: 'HIGH', goalRelevance: 'HIGH' },
        }),
      ],
      [
        makeSyntheticRow({ id: 'synthetic_disgust_0001' }),
        makeSyntheticRow({ id: 'synthetic_neutral_0001', sentiment: 'NEUTRAL', content: 'Routine.' }),
      ],
    ));

    for (const row of result.rows) {
      expect(validateMergedRow(row)).toBe(true);
    }
  });
});

// ============================================================
// Validation errors
// ============================================================

describe('input validation', () => {
  it('throws if ISEAR data is not an array', () => {
    expect(() =>
      mergeDatasets(makeMergeConfig(
        {} as any,
        [makeSyntheticRow()],
      )),
    ).toThrow(/expected JSON array/);
  });

  it('throws if synthetic data is not an array', () => {
    expect(() =>
      mergeDatasets(makeMergeConfig(
        [makeIsearRow()],
        'not an array' as any,
      )),
    ).toThrow(/expected JSON array/);
  });

  it('throws on ISEAR row with invalid emotion', () => {
    const bad = makeIsearRow({ emotion: 'UNKNOWN' as any });
    expect(() =>
      mergeDatasets(makeMergeConfig([bad], [])),
    ).toThrow(/fails schema validation/);
  });

  it('throws on synthetic row with missing content', () => {
    const bad = makeSyntheticRow({ content: '' });
    expect(() =>
      mergeDatasets(makeMergeConfig([], [bad])),
    ).toThrow(/missing or invalid "content"/);
  });
});

// ============================================================
// formatReport
// ============================================================

describe('formatReport', () => {
  it('produces human-readable output', () => {
    const result = mergeDatasets(makeMergeConfig(
      [makeIsearRow()],
      [makeSyntheticRow()],
    ));
    const output = formatReport(result.report);
    expect(output).toContain('Merge Report');
    expect(output).toContain('ISEAR rows');
    expect(output).toContain('Collisions');
  });
});
