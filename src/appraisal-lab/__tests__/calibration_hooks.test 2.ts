/**
 * Tests for the calibrated inference wrapper.
 *
 * Verifies that calibration hooks default to identity and that
 * temperature / dimension-weight knobs alter the posterior as expected.
 *
 * Uses a minimal in-memory training set — no filesystem dependency.
 */

import { AppraisalRow, AppraisalVector, Emotion, LikelihoodTable } from '../types';
import { EMOTIONS, DIMENSION_NAMES } from '../schema';
import { buildLikelihoodTable } from '../model/likelihood_builder';
import { infer } from '../model/nb_inference';
import { inferWithCalibration } from '../model/calibrated_inference';

// ============================================================
// Minimal training set (2 rows per emotion)
// ============================================================

const PROFILES: Record<string, AppraisalVector> = {
  JOY:      { valence: 'POS', arousal: 'MED',  agency: 'SELF',      control: 'HIGH', certainty: 'HIGH', goalRelevance: 'HIGH' },
  ANGER:    { valence: 'NEG', arousal: 'HIGH', agency: 'OTHER',     control: 'HIGH', certainty: 'HIGH', goalRelevance: 'HIGH' },
  FEAR:     { valence: 'NEG', arousal: 'HIGH', agency: 'SITUATION', control: 'LOW',  certainty: 'LOW',  goalRelevance: 'HIGH' },
  SADNESS:  { valence: 'NEG', arousal: 'LOW',  agency: 'SITUATION', control: 'LOW',  certainty: 'HIGH', goalRelevance: 'HIGH' },
  DISGUST:  { valence: 'NEG', arousal: 'MED',  agency: 'OTHER',     control: 'MED',  certainty: 'HIGH', goalRelevance: 'HIGH' },
  SURPRISE: { valence: 'NEU', arousal: 'HIGH', agency: 'SITUATION', control: 'MED',  certainty: 'LOW',  goalRelevance: 'HIGH' },
};

function buildTraining(): AppraisalRow[] {
  const rows: AppraisalRow[] = [];
  for (const e of EMOTIONS) {
    for (let i = 0; i < 2; i++) {
      rows.push({
        id: `T-${e}-${i}`,
        text: `${e} row ${i}`,
        emotion: e,
        appraisals: { ...PROFILES[e] },
      });
    }
  }
  return rows;
}

const table: LikelihoodTable = buildLikelihoodTable(buildTraining());

const TEST_INPUT: AppraisalVector = {
  valence: 'NEG', arousal: 'MED', agency: 'OTHER',
  control: 'HIGH', certainty: 'HIGH', goalRelevance: 'HIGH',
};

// ============================================================
// Helpers
// ============================================================

function entropy(dist: Record<string, number>): number {
  let H = 0;
  for (const p of Object.values(dist)) {
    if (p > 0) H -= p * Math.log(p);
  }
  return H;
}

function pmax(dist: Record<string, number>): number {
  return Math.max(...Object.values(dist));
}

// ============================================================
// TEST 1 — Default behaviour identical to infer()
// ============================================================

describe('Default behaviour identical to infer()', () => {
  it('undefined options matches infer()', () => {
    const base = infer(TEST_INPUT, table).distribution;
    const cal = inferWithCalibration(TEST_INPUT, table, undefined);
    for (const e of EMOTIONS) {
      expect(cal[e]).toBeCloseTo(base[e], 10);
    }
  });

  it('empty options object matches infer()', () => {
    const base = infer(TEST_INPUT, table).distribution;
    const cal = inferWithCalibration(TEST_INPUT, table, {});
    for (const e of EMOTIONS) {
      expect(cal[e]).toBeCloseTo(base[e], 10);
    }
  });

  it('temperature=1 matches infer()', () => {
    const base = infer(TEST_INPUT, table).distribution;
    const cal = inferWithCalibration(TEST_INPUT, table, { temperature: 1.0 });
    for (const e of EMOTIONS) {
      expect(cal[e]).toBeCloseTo(base[e], 10);
    }
  });

  it('all dimension weights = 1 matches infer()', () => {
    const base = infer(TEST_INPUT, table).distribution;
    const weights: Record<string, number> = {};
    for (const d of DIMENSION_NAMES) weights[d] = 1;
    const cal = inferWithCalibration(TEST_INPUT, table, { dimensionWeights: weights });
    for (const e of EMOTIONS) {
      expect(cal[e]).toBeCloseTo(base[e], 10);
    }
  });
});

// ============================================================
// TEST 2 — Temperature T > 1 flattens distribution
// ============================================================

describe('Temperature T > 1 flattens distribution', () => {
  const base = inferWithCalibration(TEST_INPUT, table);
  const flat = inferWithCalibration(TEST_INPUT, table, { temperature: 2.0 });

  it('pmax decreases', () => {
    expect(pmax(flat)).toBeLessThan(pmax(base));
  });

  it('entropy increases', () => {
    expect(entropy(flat)).toBeGreaterThan(entropy(base));
  });

  it('still sums to ~1', () => {
    const sum = EMOTIONS.reduce((s, e) => s + flat[e], 0);
    expect(sum).toBeCloseTo(1.0, 6);
  });
});

// ============================================================
// TEST 3 — Temperature T < 1 sharpens distribution
// ============================================================

describe('Temperature T < 1 sharpens distribution', () => {
  const base = inferWithCalibration(TEST_INPUT, table);
  const sharp = inferWithCalibration(TEST_INPUT, table, { temperature: 0.5 });

  it('pmax increases', () => {
    expect(pmax(sharp)).toBeGreaterThan(pmax(base));
  });

  it('still sums to ~1', () => {
    const sum = EMOTIONS.reduce((s, e) => s + sharp[e], 0);
    expect(sum).toBeCloseTo(1.0, 6);
  });
});

// ============================================================
// TEST 4 — Dimension weights all = 1 identical to baseline
// (covered in TEST 1, but explicit separate assertion)
// ============================================================

describe('Dimension weights all = 1 identical to baseline', () => {
  it('produces identical distribution', () => {
    const base = infer(TEST_INPUT, table).distribution;
    const weights: Record<string, number> = {};
    for (const d of DIMENSION_NAMES) weights[d] = 1;
    const cal = inferWithCalibration(TEST_INPUT, table, { dimensionWeights: weights });
    for (const e of EMOTIONS) {
      expect(cal[e]).toBeCloseTo(base[e], 10);
    }
  });
});

// ============================================================
// TEST 5 — Boosting a dimension weight shifts posterior
// ============================================================

describe('Boosting a dimension weight shifts posterior', () => {
  it('doubling valence weight changes distribution', () => {
    const base = inferWithCalibration(TEST_INPUT, table);
    const boosted = inferWithCalibration(TEST_INPUT, table, {
      dimensionWeights: { valence: 2.0 },
    });

    let changed = false;
    for (const e of EMOTIONS) {
      if (Math.abs(base[e] - boosted[e]) > 1e-6) changed = true;
    }
    expect(changed).toBe(true);
  });

  it('boosted distribution still sums to ~1', () => {
    const boosted = inferWithCalibration(TEST_INPUT, table, {
      dimensionWeights: { valence: 2.0 },
    });
    const sum = EMOTIONS.reduce((s, e) => s + boosted[e], 0);
    expect(sum).toBeCloseTo(1.0, 6);
  });

  it('zeroing a dimension removes its influence', () => {
    const withCertainty = inferWithCalibration(TEST_INPUT, table, {
      dimensionWeights: { certainty: 1.0 },
    });
    const withoutCertainty = inferWithCalibration(TEST_INPUT, table, {
      dimensionWeights: { certainty: 0.0 },
    });

    let changed = false;
    for (const e of EMOTIONS) {
      if (Math.abs(withCertainty[e] - withoutCertainty[e]) > 1e-6) changed = true;
    }
    expect(changed).toBe(true);
  });
});

// ============================================================
// TEST 6 — No NaN or Infinity under extreme T values
// ============================================================

describe('No NaN / Infinity under extreme temperatures', () => {
  const temps = [0.1, 0.5, 1.0, 2.0, 5.0, 10.0];

  for (const T of temps) {
    it(`T=${T} produces finite values`, () => {
      const dist = inferWithCalibration(TEST_INPUT, table, { temperature: T });
      for (const e of EMOTIONS) {
        expect(Number.isFinite(dist[e])).toBe(true);
        expect(Number.isNaN(dist[e])).toBe(false);
      }
    });
  }

  it('all extreme T posteriors sum to ~1', () => {
    for (const T of temps) {
      const dist = inferWithCalibration(TEST_INPUT, table, { temperature: T });
      const sum = EMOTIONS.reduce((s, e) => s + dist[e], 0);
      expect(sum).toBeCloseTo(1.0, 5);
    }
  });
});
