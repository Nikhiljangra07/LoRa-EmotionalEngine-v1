/**
 * Behavioural sanity tests for the Naive Bayes inference engine.
 *
 * Validates posterior invariants, plausible ranking for canonical
 * emotion scenarios, and deterministic stability — all from a
 * minimal in-memory training set. No filesystem, no CLI dependency.
 *
 * Does NOT modify model math, EMOTIONS enum, schema, or types.
 */

import { AppraisalRow, AppraisalVector, Emotion } from '../types';
import { EMOTIONS } from '../schema';
import { buildLikelihoodTable } from '../model/likelihood_builder';
import { infer } from '../model/nb_inference';

// ============================================================
// Canonical appraisal profiles (2 rows per emotion)
// ============================================================

const PROFILES: Record<string, AppraisalVector> = {
  JOY:      { valence: 'POS', arousal: 'MED',  agency: 'SELF',      control: 'HIGH', certainty: 'HIGH', goalRelevance: 'HIGH' },
  ANGER:    { valence: 'NEG', arousal: 'HIGH', agency: 'OTHER',     control: 'HIGH', certainty: 'HIGH', goalRelevance: 'HIGH' },
  FEAR:     { valence: 'NEG', arousal: 'HIGH', agency: 'SITUATION', control: 'LOW',  certainty: 'LOW',  goalRelevance: 'HIGH' },
  SADNESS:  { valence: 'NEG', arousal: 'LOW',  agency: 'SITUATION', control: 'LOW',  certainty: 'HIGH', goalRelevance: 'HIGH' },
  DISGUST:  { valence: 'NEG', arousal: 'MED',  agency: 'OTHER',     control: 'MED',  certainty: 'HIGH', goalRelevance: 'HIGH' },
  SURPRISE: { valence: 'NEU', arousal: 'HIGH', agency: 'SITUATION', control: 'MED',  certainty: 'LOW',  goalRelevance: 'HIGH' },
};

function buildTrainingSet(): AppraisalRow[] {
  const rows: AppraisalRow[] = [];
  for (const emotion of EMOTIONS) {
    const vec = PROFILES[emotion];
    for (let i = 0; i < 2; i++) {
      rows.push({
        id:         `TRAIN-${emotion}-${i}`,
        text:       `${emotion.toLowerCase()} training row ${i}`,
        emotion,
        appraisals: { ...vec },
      });
    }
  }
  return rows;
}

/** Sort posterior descending, return ordered [emotion, probability] pairs. */
function sortedPosterior(dist: Record<Emotion, number>): [string, number][] {
  return (Object.entries(dist) as [string, number][])
    .sort(([, a], [, b]) => b - a);
}

// ============================================================
// Shared state
// ============================================================

const trainingSet = buildTrainingSet();
const table = buildLikelihoodTable(trainingSet);

// ============================================================
// TEST 1 — Posterior validity
// ============================================================

describe('Posterior validity', () => {
  const input: AppraisalVector = {
    valence: 'NEG', arousal: 'MED', agency: 'OTHER',
    control: 'HIGH', certainty: 'HIGH', goalRelevance: 'HIGH',
  };

  const result = infer(input, table);

  it('posterior sums to 1 (within 1e-6)', () => {
    const sum = EMOTIONS.reduce((s, e) => s + result.distribution[e], 0);
    expect(Math.abs(sum - 1.0)).toBeLessThan(1e-6);
  });

  it('no NaN in posterior', () => {
    for (const e of EMOTIONS) {
      expect(Number.isNaN(result.distribution[e])).toBe(false);
    }
  });

  it('no Infinity in posterior', () => {
    for (const e of EMOTIONS) {
      expect(Number.isFinite(result.distribution[e])).toBe(true);
    }
  });

  it('all probabilities are non-negative', () => {
    for (const e of EMOTIONS) {
      expect(result.distribution[e]).toBeGreaterThanOrEqual(0);
    }
  });
});

// ============================================================
// TEST 2 — Classic DISGUST scenario
// ============================================================

describe('Classic DISGUST scenario', () => {
  const input: AppraisalVector = {
    valence: 'NEG', arousal: 'MED', agency: 'OTHER',
    control: 'HIGH', certainty: 'HIGH', goalRelevance: 'HIGH',
  };

  const result = infer(input, table);
  const sorted = sortedPosterior(result.distribution);
  const top2Labels = sorted.slice(0, 2).map(([e]) => e);

  it('DISGUST appears in top-2', () => {
    expect(top2Labels).toContain('DISGUST');
  });
});

// ============================================================
// TEST 3 — Boring routine scenario (NEUTRAL check)
// ============================================================

describe('Boring routine scenario — NEUTRAL structural check', () => {
  const input: AppraisalVector = {
    valence: 'NEU', arousal: 'LOW', agency: 'SITUATION',
    control: 'MED', certainty: 'HIGH', goalRelevance: 'LOW',
  };

  const emotionSet = new Set<string>(EMOTIONS as readonly string[]);
  const neutralSupported = emotionSet.has('NEUTRAL');

  if (neutralSupported) {
    // If NEUTRAL were ever promoted, this branch would verify ranking
    it('NEUTRAL appears in top-2', () => {
      const result = infer(input, table);
      const sorted = sortedPosterior(result.distribution);
      const top2 = sorted.slice(0, 2).map(([e]) => e);
      expect(top2).toContain('NEUTRAL');
    });
  } else {
    it('NEUTRAL is not in EMOTIONS — structural limitation acknowledged', () => {
      expect(emotionSet.has('NEUTRAL')).toBe(false);
    });

    it('posterior distribution does not contain a NEUTRAL key', () => {
      const result = infer(input, table);
      expect(result.distribution).not.toHaveProperty('NEUTRAL');
    });

    it('inference still produces a valid result for a neutral-like vector', () => {
      const result = infer(input, table);
      const sum = EMOTIONS.reduce((s, e) => s + result.distribution[e], 0);
      expect(Math.abs(sum - 1.0)).toBeLessThan(1e-6);
    });
  }
});

// ============================================================
// TEST 4 — Anger vs Fear ambiguity
// ============================================================

describe('Anger / Fear ambiguity', () => {
  // Deliberately mixed: shares NEG/HIGH-arousal/HIGH-goalRelevance with both.
  // Agency=SITUATION favours FEAR; certainty=HIGH favours ANGER;
  // control=MED matches neither exactly → forces the model to split.
  const input: AppraisalVector = {
    valence: 'NEG', arousal: 'HIGH', agency: 'SITUATION',
    control: 'MED', certainty: 'HIGH', goalRelevance: 'HIGH',
  };

  const result = infer(input, table);
  const sorted = sortedPosterior(result.distribution);
  const top2Labels = sorted.slice(0, 2).map(([e]) => e);
  const margin = sorted[0][1] - sorted[1][1];

  it('top-2 contains at least one of ANGER or FEAR', () => {
    const hasAngerOrFear = top2Labels.includes('ANGER') || top2Labels.includes('FEAR');
    expect(hasAngerOrFear).toBe(true);
  });

  it('margin between top-1 and top-2 is < 0.5', () => {
    expect(margin).toBeLessThan(0.5);
  });
});

// ============================================================
// TEST 5 — Deterministic stability
// ============================================================

describe('Deterministic stability', () => {
  const input: AppraisalVector = {
    valence: 'NEG', arousal: 'MED', agency: 'SITUATION',
    control: 'LOW', certainty: 'HIGH', goalRelevance: 'HIGH',
  };

  it('two inferences on the same input produce identical posteriors', () => {
    const r1 = infer(input, table);
    const r2 = infer(input, table);

    for (const e of EMOTIONS) {
      expect(r1.distribution[e]).toBe(r2.distribution[e]);
    }
    expect(r1.predicted).toBe(r2.predicted);
    expect(r1.confidence).toBe(r2.confidence);
  });
});
