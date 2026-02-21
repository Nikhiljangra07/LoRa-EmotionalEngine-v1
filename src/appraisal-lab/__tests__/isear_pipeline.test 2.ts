/**
 * Tests for the ISEAR ingestion pipeline.
 *
 * Covers: loader filtering, emotion validation, appraisal mapping,
 * JSON export round-trip, and data integrity checks.
 */

import * as path from 'path';
import { loadISEAR, parseCSV, ISEARRow, ISEAR_EMOTIONS } from '../dataset/isear_loader';
import { getAppraisalMapping, mapToAppraisalRow, mapAllToAppraisalRows } from '../dataset/appraisal_mapper';
import { Emotion, AppraisalVector, AppraisalRow } from '../types';
import { DIMENSION_NAMES } from '../schema';

// ============================================================
// Resolve CSV path
// ============================================================

const CSV_PATH = path.resolve(__dirname, '..', 'dataset', 'eng_dataset.csv');

// ============================================================
// Loader tests
// ============================================================

describe('ISEAR Loader', () => {
  let rows: ISEARRow[];

  beforeAll(() => {
    rows = loadISEAR(CSV_PATH);
  });

  it('loads more than 3000 rows', () => {
    expect(rows.length).toBeGreaterThan(3000);
  });

  it('removes shame and guilt labels', () => {
    const emotions = new Set(rows.map(r => r.emotion));
    expect(emotions.has('SHAME' as Emotion)).toBe(false);
    expect(emotions.has('GUILT' as Emotion)).toBe(false);
  });

  it('only contains allowed ISEAR emotions', () => {
    const allowedSet = new Set(ISEAR_EMOTIONS as readonly string[]);
    for (const row of rows) {
      expect(allowedSet.has(row.emotion)).toBe(true);
    }
  });

  it('the allowed emotion set has exactly 5 entries', () => {
    expect(ISEAR_EMOTIONS.length).toBe(5);
    const unique = new Set(ISEAR_EMOTIONS);
    expect(unique.size).toBe(5);
  });

  it('contains no empty text rows', () => {
    for (const row of rows) {
      expect(row.text.trim().length).toBeGreaterThan(0);
    }
  });

  it('all rows have a valid string id', () => {
    for (const row of rows) {
      expect(typeof row.id).toBe('string');
      expect(row.id.length).toBeGreaterThan(0);
    }
  });

  it('all IDs are prefixed with ISEAR-', () => {
    for (const row of rows) {
      expect(row.id.startsWith('ISEAR-')).toBe(true);
    }
  });
});

// ============================================================
// CSV parser tests
// ============================================================

describe('parseCSV', () => {
  it('handles quoted fields with commas', () => {
    const csv = 'id,label,text\n1,anger,"hello, world"\n2,joy,simple text\n';
    const parsed = parseCSV(csv);
    expect(parsed.length).toBe(3); // header + 2 rows
    expect(parsed[1]).toEqual(['1', 'anger', 'hello, world']);
    expect(parsed[2]).toEqual(['2', 'joy', 'simple text']);
  });

  it('handles escaped quotes inside quoted fields', () => {
    const csv = 'a,b\n1,"he said ""hello"""\n';
    const parsed = parseCSV(csv);
    expect(parsed[1][1]).toBe('he said "hello"');
  });

  it('strips UTF-8 BOM', () => {
    const csv = '\uFEFFid,text\n1,hello\n';
    const parsed = parseCSV(csv);
    expect(parsed[0][0]).toBe('id');
  });
});

// ============================================================
// Filtering tests (synthetic data)
// ============================================================

describe('Emotion filtering logic', () => {
  it('filters out shame and guilt from synthetic data via parseCSV + manual check', () => {
    // Simulate a CSV with all 7 ISEAR-like emotions
    const csv = [
      'ID,emotion,text',
      '1,anger,I am angry',
      '2,fear,I am afraid',
      '3,joy,I am happy',
      '4,sadness,I am sad',
      '5,disgust,That is disgusting',
      '6,shame,I feel ashamed',
      '7,guilt,I feel guilty',
      '8,surprise,I am surprised',
    ].join('\n');

    const parsed = parseCSV(csv);
    const headers = parsed[0].map(h => h.trim().toLowerCase());
    const emotionIdx = headers.indexOf('emotion');
    const textIdx = headers.indexOf('text');

    const allowedSet = new Set(ISEAR_EMOTIONS as readonly string[]);
    const kept: string[] = [];
    const dropped: string[] = [];

    for (let i = 1; i < parsed.length; i++) {
      const label = parsed[i][emotionIdx].trim().toUpperCase();
      if (allowedSet.has(label)) {
        kept.push(label);
      } else {
        dropped.push(label);
      }
    }

    // Shame, guilt, and surprise should be dropped
    expect(dropped).toContain('SHAME');
    expect(dropped).toContain('GUILT');
    expect(dropped).toContain('SURPRISE');

    // The 5 target emotions should be kept
    expect(kept).toContain('ANGER');
    expect(kept).toContain('FEAR');
    expect(kept).toContain('JOY');
    expect(kept).toContain('SADNESS');
    expect(kept).toContain('DISGUST');
    expect(kept.length).toBe(5);
  });
});

// ============================================================
// Appraisal mapper tests
// ============================================================

describe('Appraisal Mapper', () => {
  it('ANGER mapping matches spec', () => {
    const v = getAppraisalMapping('ANGER');
    expect(v.valence).toBe('NEG');
    expect(v.arousal).toBe('HIGH');
    expect(v.agency).toBe('OTHER');
    expect(v.control).toBe('HIGH');
    expect(v.certainty).toBe('HIGH');
    expect(v.goalRelevance).toBe('HIGH');
  });

  it('FEAR mapping matches spec', () => {
    const v = getAppraisalMapping('FEAR');
    expect(v.valence).toBe('NEG');
    expect(v.arousal).toBe('HIGH');
    expect(v.agency).toBe('SITUATION');
    expect(v.control).toBe('LOW');
    expect(v.certainty).toBe('LOW');
    expect(v.goalRelevance).toBe('HIGH');
  });

  it('DISGUST mapping matches spec', () => {
    const v = getAppraisalMapping('DISGUST');
    expect(v.valence).toBe('NEG');
    expect(v.arousal).toBe('MED');
    expect(v.agency).toBe('OTHER');
    expect(v.control).toBe('MED');
    expect(v.certainty).toBe('HIGH');
    // GoalRelevance: spec says MED, mapped to HIGH (binary dimension)
    expect(v.goalRelevance).toBe('HIGH');
  });

  it('SADNESS mapping matches spec', () => {
    const v = getAppraisalMapping('SADNESS');
    expect(v.valence).toBe('NEG');
    expect(v.arousal).toBe('LOW');
    expect(v.agency).toBe('SITUATION');
    expect(v.control).toBe('LOW');
    expect(v.certainty).toBe('HIGH');
    expect(v.goalRelevance).toBe('HIGH');
  });

  it('JOY mapping matches spec', () => {
    const v = getAppraisalMapping('JOY');
    expect(v.valence).toBe('POS');
    expect(v.arousal).toBe('MED');
    expect(v.agency).toBe('SELF');
    expect(v.control).toBe('HIGH');
    expect(v.certainty).toBe('HIGH');
    expect(v.goalRelevance).toBe('HIGH');
  });

  it('throws for unmapped emotion (SURPRISE)', () => {
    expect(() => getAppraisalMapping('SURPRISE')).toThrow();
  });

  it('mapToAppraisalRow produces correct structure', () => {
    const isearRow: ISEARRow = { id: 'TEST-1', text: 'I am upset', emotion: 'ANGER' };
    const result = mapToAppraisalRow(isearRow);
    expect(result.id).toBe('TEST-1');
    expect(result.text).toBe('I am upset');
    expect(result.emotion).toBe('ANGER');
    expect(result.appraisals).toBeDefined();
    expect(result.appraisals.valence).toBe('NEG');
  });

  it('mapAllToAppraisalRows maps all rows', () => {
    const input: ISEARRow[] = [
      { id: 'A', text: 'text1', emotion: 'JOY' },
      { id: 'B', text: 'text2', emotion: 'FEAR' },
      { id: 'C', text: 'text3', emotion: 'SADNESS' },
    ];
    const result = mapAllToAppraisalRows(input);
    expect(result.length).toBe(3);
    expect(result[0].appraisals.valence).toBe('POS');
    expect(result[1].appraisals.control).toBe('LOW');
    expect(result[2].appraisals.arousal).toBe('LOW');
  });
});

// ============================================================
// Full pipeline integration tests
// ============================================================

describe('Full ISEAR Pipeline', () => {
  let appraisalRows: AppraisalRow[];

  beforeAll(() => {
    const isearRows = loadISEAR(CSV_PATH);
    appraisalRows = mapAllToAppraisalRows(isearRows);
  });

  it('produces more than 3000 appraisal rows', () => {
    expect(appraisalRows.length).toBeGreaterThan(3000);
  });

  it('no NaN or undefined values in any field', () => {
    for (const row of appraisalRows) {
      // Top-level fields
      expect(row.id).toBeDefined();
      expect(row.text).toBeDefined();
      expect(row.emotion).toBeDefined();
      expect(row.appraisals).toBeDefined();

      expect(typeof row.id).toBe('string');
      expect(typeof row.text).toBe('string');
      expect(typeof row.emotion).toBe('string');

      // Appraisal dimensions
      for (const dim of DIMENSION_NAMES) {
        const val = row.appraisals[dim];
        expect(val).toBeDefined();
        expect(val).not.toBeNull();
        expect(typeof val).toBe('string');
        expect(val.length).toBeGreaterThan(0);
      }
    }
  });

  it('JSON export round-trips correctly', () => {
    const json = JSON.stringify(appraisalRows, null, 2);
    const parsed: AppraisalRow[] = JSON.parse(json);
    expect(parsed.length).toBe(appraisalRows.length);
    // Spot-check first and last rows
    expect(parsed[0].id).toBe(appraisalRows[0].id);
    expect(parsed[0].emotion).toBe(appraisalRows[0].emotion);
    expect(parsed[0].appraisals.valence).toBe(appraisalRows[0].appraisals.valence);
    const last = appraisalRows.length - 1;
    expect(parsed[last].text).toBe(appraisalRows[last].text);
  });

  it('all emotion labels are from the ISEAR allowed set', () => {
    const allowedSet = new Set(ISEAR_EMOTIONS as readonly string[]);
    for (const row of appraisalRows) {
      expect(allowedSet.has(row.emotion)).toBe(true);
    }
  });

  it('all appraisal dimensions have valid bin values', () => {
    const validBins: Record<string, Set<string>> = {
      valence: new Set(['NEG', 'NEU', 'POS']),
      arousal: new Set(['LOW', 'MED', 'HIGH']),
      agency: new Set(['SELF', 'OTHER', 'SITUATION']),
      control: new Set(['LOW', 'MED', 'HIGH']),
      certainty: new Set(['LOW', 'HIGH']),
      goalRelevance: new Set(['LOW', 'HIGH']),
    };

    for (const row of appraisalRows) {
      for (const dim of DIMENSION_NAMES) {
        const val = row.appraisals[dim] as string;
        expect(validBins[dim].has(val)).toBe(true);
      }
    }
  });
});
