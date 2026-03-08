/**
 * Tests for the Naive Bayes inference engine.
 */

import { generateDataset } from '../dataset/generator';
import { buildLikelihoodTable } from '../model/likelihood_builder';
import { splitDataset } from '../model/metrics';
import { infer } from '../model/nb_inference';
import { EMOTIONS } from '../schema';
import { AppraisalVector, LikelihoodTable } from '../types';

describe('infer', () => {
  let table: LikelihoodTable;

  beforeAll(() => {
    const dataset = generateDataset(42, 900);
    const { train } = splitDataset(dataset, 0.8);
    table = buildLikelihoodTable(train);
  });

  it('posterior sums to 1 within tolerance', () => {
    const appraisals: AppraisalVector = {
      valence: "NEG",
      arousal: "HIGH",
      agency: "OTHER",
      control: "MED",
      certainty: "HIGH",
      goalRelevance: "HIGH",
    };
    const result = infer(appraisals, table);
    const sum = EMOTIONS.reduce((s, e) => s + result.distribution[e], 0);
    expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9);
  });

  it('contains no NaN values in the distribution', () => {
    const appraisals: AppraisalVector = {
      valence: "POS",
      arousal: "MED",
      agency: "SELF",
      control: "HIGH",
      certainty: "HIGH",
      goalRelevance: "HIGH",
    };
    const result = infer(appraisals, table);
    for (const e of EMOTIONS) {
      expect(isNaN(result.distribution[e])).toBe(false);
    }
  });

  it('contains no Infinity values in the distribution', () => {
    const appraisals: AppraisalVector = {
      valence: "NEU",
      arousal: "LOW",
      agency: "SITUATION",
      control: "LOW",
      certainty: "LOW",
      goalRelevance: "LOW",
    };
    const result = infer(appraisals, table);
    for (const e of EMOTIONS) {
      expect(isFinite(result.distribution[e])).toBe(true);
    }
  });

  it('all probabilities are non-negative', () => {
    const appraisals: AppraisalVector = {
      valence: "NEG",
      arousal: "MED",
      agency: "OTHER",
      control: "LOW",
      certainty: "HIGH",
      goalRelevance: "HIGH",
    };
    const result = infer(appraisals, table);
    for (const e of EMOTIONS) {
      expect(result.distribution[e]).toBeGreaterThanOrEqual(0);
    }
  });

  it('predicted emotion has the highest probability', () => {
    const appraisals: AppraisalVector = {
      valence: "NEG",
      arousal: "HIGH",
      agency: "OTHER",
      control: "HIGH",
      certainty: "HIGH",
      goalRelevance: "HIGH",
    };
    const result = infer(appraisals, table);
    for (const e of EMOTIONS) {
      expect(result.distribution[result.predicted]).toBeGreaterThanOrEqual(
        result.distribution[e],
      );
    }
  });

  it('produces deterministic output for the same input', () => {
    const appraisals: AppraisalVector = {
      valence: "NEG",
      arousal: "HIGH",
      agency: "SITUATION",
      control: "LOW",
      certainty: "LOW",
      goalRelevance: "HIGH",
    };
    const r1 = infer(appraisals, table);
    const r2 = infer(appraisals, table);
    expect(r1.predicted).toBe(r2.predicted);
    expect(r1.confidence).toBe(r2.confidence);
    for (const e of EMOTIONS) {
      expect(r1.distribution[e]).toBe(r2.distribution[e]);
    }
  });

  it('ambiguous case does NOT produce 0.99 confidence', () => {
    // This appraisal vector sits right between ANGER and FEAR:
    // - NEG valence + HIGH arousal: shared by ANGER and FEAR
    // - OTHER agency: more ANGER-like
    // - LOW control + LOW certainty: more FEAR-like
    // The conflicting signals should prevent any single class from dominating.
    const ambiguousAppraisals: AppraisalVector = {
      valence: "NEG",
      arousal: "HIGH",
      agency: "OTHER",
      control: "LOW",
      certainty: "LOW",
      goalRelevance: "HIGH",
    };
    const result = infer(ambiguousAppraisals, table);
    expect(result.confidence).toBeLessThan(0.99);
  });

  it('clear JOY profile produces high confidence for JOY', () => {
    const clearJoy: AppraisalVector = {
      valence: "POS",
      arousal: "HIGH",
      agency: "SELF",
      control: "HIGH",
      certainty: "HIGH",
      goalRelevance: "HIGH",
    };
    const result = infer(clearJoy, table);
    expect(result.predicted).toBe("JOY");
    // Should be fairly confident (but we only assert it beats the other classes)
    expect(result.distribution["JOY"]).toBeGreaterThan(0.5);
  });

  it('works correctly for every dimension combination boundary', () => {
    // Test a few extreme combinations to ensure no crashes
    const combos: AppraisalVector[] = [
      { valence: "NEG", arousal: "LOW", agency: "SELF", control: "LOW", certainty: "LOW", goalRelevance: "LOW" },
      { valence: "POS", arousal: "HIGH", agency: "OTHER", control: "HIGH", certainty: "HIGH", goalRelevance: "HIGH" },
      { valence: "NEU", arousal: "MED", agency: "SITUATION", control: "MED", certainty: "LOW", goalRelevance: "HIGH" },
    ];

    for (const appraisals of combos) {
      const result = infer(appraisals, table);
      const sum = EMOTIONS.reduce((s, e) => s + result.distribution[e], 0);
      expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    }
  });
});
