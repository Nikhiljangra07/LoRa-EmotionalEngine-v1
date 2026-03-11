/**
 * Tests for the multi-mode evaluation harness.
 *
 * All tests use small in-memory fixtures — no disk I/O.
 * Tests verify structural validity, not specific accuracy values.
 */

import { AppraisalRow, AppraisalVector } from '../types';
import {
  runEvaluation,
  seededShuffle,
  partitionBySupport,
  buildLocalConfusionMatrix,
  computePerClassMetrics,
  formatModeResult,
  EvalModeResult,
} from '../cli/eval_modes';

// ============================================================
// Appraisal vector fixtures (from DESIGN.md locked mappings)
// ============================================================

const ANGER_VEC: AppraisalVector = {
  valence: 'NEG', arousal: 'HIGH', agency: 'OTHER',
  control: 'HIGH', certainty: 'HIGH', goalRelevance: 'HIGH',
};

const FEAR_VEC: AppraisalVector = {
  valence: 'NEG', arousal: 'HIGH', agency: 'SITUATION',
  control: 'LOW', certainty: 'LOW', goalRelevance: 'HIGH',
};

const JOY_VEC: AppraisalVector = {
  valence: 'POS', arousal: 'MED', agency: 'SELF',
  control: 'HIGH', certainty: 'HIGH', goalRelevance: 'HIGH',
};

const SADNESS_VEC: AppraisalVector = {
  valence: 'NEG', arousal: 'LOW', agency: 'SITUATION',
  control: 'LOW', certainty: 'HIGH', goalRelevance: 'HIGH',
};

const DISGUST_VEC: AppraisalVector = {
  valence: 'NEG', arousal: 'MED', agency: 'SITUATION',
  control: 'LOW', certainty: 'HIGH', goalRelevance: 'HIGH',
};

const NEUTRAL_VEC: AppraisalVector = {
  valence: 'NEU', arousal: 'LOW', agency: 'SITUATION',
  control: 'MED', certainty: 'HIGH', goalRelevance: 'LOW',
};

// ============================================================
// Row factory
// ============================================================

function makeRows(emotion: string, vec: AppraisalVector, count: number, prefix: string): AppraisalRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    text: `${emotion.toLowerCase()} text ${i}`,
    emotion: emotion as AppraisalRow['emotion'],
    appraisals: { ...vec },
  }));
}

// ============================================================
// Fixtures
// ============================================================

const REAL_DATA: AppraisalRow[] = [
  ...makeRows('ANGER',   ANGER_VEC,   10, 'R-ANG'),
  ...makeRows('FEAR',    FEAR_VEC,    10, 'R-FEA'),
  ...makeRows('JOY',     JOY_VEC,     10, 'R-JOY'),
  ...makeRows('SADNESS', SADNESS_VEC, 10, 'R-SAD'),
];

const SYNTHETIC_DATA: AppraisalRow[] = [
  ...makeRows('DISGUST', DISGUST_VEC, 10, 'S-DIS'),
  ...makeRows('NEUTRAL', NEUTRAL_VEC, 10, 'S-NEU'),
];

const MERGED_DATA: AppraisalRow[] = [
  ...REAL_DATA,
  ...SYNTHETIC_DATA,
];

// ============================================================
// seededShuffle
// ============================================================

describe('seededShuffle', () => {
  it('same seed produces identical order', () => {
    const a = seededShuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 2024);
    const b = seededShuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 2024);
    expect(a).toEqual(b);
  });

  it('different seeds produce different order', () => {
    const a = seededShuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 2024);
    const b = seededShuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 9999);
    expect(a).not.toEqual(b);
  });

  it('does not mutate the original array', () => {
    const original = [1, 2, 3, 4, 5];
    const copy = [...original];
    seededShuffle(original, 42);
    expect(original).toEqual(copy);
  });

  it('returns an array of the same length', () => {
    const result = seededShuffle([10, 20, 30], 1);
    expect(result.length).toBe(3);
  });

  it('contains the same elements', () => {
    const result = seededShuffle([10, 20, 30, 40, 50], 42);
    expect(result.sort((a, b) => a - b)).toEqual([10, 20, 30, 40, 50]);
  });
});

// ============================================================
// partitionBySupport
// ============================================================

describe('partitionBySupport', () => {
  it('separates supported and unsupported labels', () => {
    const { supported, unsupported, unsupportedLabels } = partitionBySupport(MERGED_DATA);
    expect(supported.length).toBe(REAL_DATA.length + 10); // DISGUST is supported
    expect(unsupported.length).toBe(10); // NEUTRAL is unsupported
    expect(unsupportedLabels).toEqual(['NEUTRAL']);
  });

  it('returns all rows as supported when no unsupported labels', () => {
    const { supported, unsupported } = partitionBySupport(REAL_DATA);
    expect(supported.length).toBe(REAL_DATA.length);
    expect(unsupported.length).toBe(0);
  });
});

// ============================================================
// buildLocalConfusionMatrix
// ============================================================

describe('buildLocalConfusionMatrix', () => {
  it('builds a matrix of correct dimensions', () => {
    const labels = ['A', 'B', 'C'];
    const cm = buildLocalConfusionMatrix(
      ['A', 'B', 'C', 'A'],
      ['A', 'B', 'A', 'C'],
      labels,
    );
    for (const l of labels) {
      expect(Object.keys(cm[l]).length).toBe(3);
    }
  });

  it('counts correct and incorrect predictions', () => {
    const cm = buildLocalConfusionMatrix(
      ['A', 'A', 'B', 'B'],
      ['A', 'B', 'B', 'A'],
      ['A', 'B'],
    );
    expect(cm['A']['A']).toBe(1);
    expect(cm['A']['B']).toBe(1);
    expect(cm['B']['B']).toBe(1);
    expect(cm['B']['A']).toBe(1);
  });
});

// ============================================================
// computePerClassMetrics
// ============================================================

describe('computePerClassMetrics', () => {
  it('computes precision and recall from a confusion matrix', () => {
    const cm = buildLocalConfusionMatrix(
      ['A', 'A', 'A', 'B', 'B'],
      ['A', 'A', 'B', 'B', 'A'],
      ['A', 'B'],
    );
    const metrics = computePerClassMetrics(cm, ['A', 'B']);

    expect(metrics['A'].precision).toBeCloseTo(2 / 3);
    expect(metrics['A'].recall).toBeCloseTo(2 / 3);
    expect(metrics['B'].precision).toBeCloseTo(1 / 2);
    expect(metrics['B'].recall).toBeCloseTo(1 / 2);
  });

  it('handles zero-support class gracefully', () => {
    const cm = buildLocalConfusionMatrix(
      ['A', 'A'],
      ['A', 'A'],
      ['A', 'B'],
    );
    const metrics = computePerClassMetrics(cm, ['A', 'B']);
    expect(metrics['B'].precision).toBe(0);
    expect(metrics['B'].recall).toBe(0);
    expect(metrics['B'].support).toBe(0);
  });
});

// ============================================================
// runEvaluation — real-only mode
// ============================================================

describe('runEvaluation — real-only', () => {
  let result: EvalModeResult;

  beforeAll(() => {
    result = runEvaluation(REAL_DATA, 'real');
  });

  it('accuracy is between 0 and 1', () => {
    expect(result.accuracy).toBeGreaterThanOrEqual(0);
    expect(result.accuracy).toBeLessThanOrEqual(1);
  });

  it('test set is non-empty', () => {
    expect(result.testRows).toBeGreaterThan(0);
  });

  it('confusion matrix has correct dimensions', () => {
    for (const label of result.labels) {
      expect(result.confusionMatrix[label]).toBeDefined();
      for (const pred of result.labels) {
        expect(typeof result.confusionMatrix[label][pred]).toBe('number');
      }
    }
  });

  it('per-class metrics exist for every label', () => {
    for (const label of result.labels) {
      expect(result.perClass[label]).toBeDefined();
      expect(result.perClass[label].precision).toBeGreaterThanOrEqual(0);
      expect(result.perClass[label].recall).toBeGreaterThanOrEqual(0);
    }
  });

  it('confusion matrix row sums equal test set size', () => {
    let total = 0;
    for (const actual of result.labels) {
      for (const pred of result.labels) {
        total += result.confusionMatrix[actual][pred];
      }
    }
    expect(total).toBe(result.testRows);
  });

  it('shuffled split includes multiple emotion classes in test set', () => {
    expect(result.labels.length).toBeGreaterThanOrEqual(2);
  });

  it('is NOT marked as structural-only', () => {
    expect(result.structuralOnly).toBe(false);
  });

  it('has zero unsupported rows', () => {
    expect(result.unsupportedRows).toBe(0);
    expect(result.unsupportedLabels).toEqual([]);
  });
});

// ============================================================
// runEvaluation — synthetic-only mode
// ============================================================

describe('runEvaluation — synthetic-only', () => {
  let result: EvalModeResult;

  beforeAll(() => {
    result = runEvaluation(SYNTHETIC_DATA, 'synthetic');
  });

  it('does not throw', () => {
    expect(result).toBeDefined();
  });

  it('handles 2-class scenario', () => {
    expect(result.testRows).toBeGreaterThan(0);
    expect(result.accuracy).toBeGreaterThanOrEqual(0);
    expect(result.accuracy).toBeLessThanOrEqual(1);
  });

  it('confusion matrix has correct dimensions', () => {
    for (const label of result.labels) {
      expect(result.confusionMatrix[label]).toBeDefined();
    }
  });

  it('is marked as structural-only when all labels unsupported', () => {
    const allUnsupported: AppraisalRow[] = makeRows('NEUTRAL', NEUTRAL_VEC, 20, 'U');
    const r = runEvaluation(allUnsupported, 'synthetic');
    expect(r.structuralOnly).toBe(true);
  });

  it('emits compatibility-check warning when all labels unsupported', () => {
    const allUnsupported: AppraisalRow[] = makeRows('NEUTRAL', NEUTRAL_VEC, 20, 'U');
    const r = runEvaluation(allUnsupported, 'synthetic');
    const hasMsg = r.warnings.some(w => w.includes('compatibility check'));
    expect(hasMsg).toBe(true);
  });

  it('emits structural limitation warning for unsupported labels', () => {
    const r = runEvaluation(SYNTHETIC_DATA, 'synthetic');
    const hasWarning = r.warnings.some(w => w.includes('EMOTIONS enum'));
    expect(hasWarning).toBe(true);
  });

  it('reports unsupported labels', () => {
    expect(result.unsupportedLabels).toContain('NEUTRAL');
  });
});

// ============================================================
// runEvaluation — merged mode
// ============================================================

describe('runEvaluation — merged mode', () => {
  let result: EvalModeResult;

  beforeAll(() => {
    result = runEvaluation(MERGED_DATA, 'merged');
  });

  it('does not throw', () => {
    expect(result).toBeDefined();
  });

  it('accuracy is between 0 and 1', () => {
    expect(result.accuracy).toBeGreaterThanOrEqual(0);
    expect(result.accuracy).toBeLessThanOrEqual(1);
  });

  it('train + test equals supported rows, not total', () => {
    expect(result.trainRows + result.testRows).toBe(result.supportedRows);
  });

  it('per-class metrics include every label in test data', () => {
    for (const label of result.labels) {
      expect(result.perClass[label]).toBeDefined();
    }
  });

  it('confusion matrix row sums equal test set size', () => {
    let total = 0;
    for (const actual of result.labels) {
      for (const pred of result.labels) {
        total += result.confusionMatrix[actual][pred];
      }
    }
    expect(total).toBe(result.testRows);
  });

  it('excludes unsupported rows from accuracy computation', () => {
    expect(result.unsupportedRows).toBe(10); // 10 NEUTRAL rows
    expect(result.unsupportedLabels).toEqual(['NEUTRAL']);
    // test + train = supported, not total
    expect(result.testRows + result.trainRows).toBeLessThan(result.totalRows);
  });

  it('reports total, supported, and unsupported counts', () => {
    expect(result.totalRows).toBe(MERGED_DATA.length);
    expect(result.supportedRows).toBe(MERGED_DATA.length - 10);
    expect(result.unsupportedRows).toBe(10);
  });

  it('emits warning about unsupported labels', () => {
    const hasWarning = result.warnings.some(w => w.includes('EMOTIONS enum'));
    expect(hasWarning).toBe(true);
  });

  it('is NOT marked as structural-only', () => {
    expect(result.structuralOnly).toBe(false);
  });
});

// ============================================================
// formatModeResult
// ============================================================

describe('formatModeResult', () => {
  it('produces readable output with mode name', () => {
    const result = runEvaluation(REAL_DATA, 'real');
    const output = formatModeResult(result);
    expect(output).toContain('=== MODE: REAL ===');
    expect(output).toContain('Accuracy');
    expect(output).toContain('Confusion Matrix');
    expect(output).toContain('Per-Class Metrics');
  });

  it('includes structural limitation banner for synthetic-only', () => {
    const allUnsupported: AppraisalRow[] = makeRows('NEUTRAL', NEUTRAL_VEC, 20, 'U');
    const result = runEvaluation(allUnsupported, 'synthetic');
    const output = formatModeResult(result);
    expect(output).toContain('STRUCTURAL LIMITATION');
  });

  it('includes unsupported-rows line for merged mode', () => {
    const result = runEvaluation(MERGED_DATA, 'merged');
    const output = formatModeResult(result);
    expect(output).toContain('Unsupported rows:');
    expect(output).toContain('NEUTRAL');
  });
});
