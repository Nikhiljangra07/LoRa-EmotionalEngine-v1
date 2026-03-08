/**
 * Tests for the likelihood table builder.
 */

import { generateDataset } from '../dataset/generator';
import { buildLikelihoodTable } from '../model/likelihood_builder';
import { splitDataset } from '../model/metrics';
import { EMOTIONS, DIMENSION_NAMES, DIMENSION_BINS } from '../schema';
import { LikelihoodTable } from '../types';

describe('buildLikelihoodTable', () => {
  let table: LikelihoodTable;

  beforeAll(() => {
    const dataset = generateDataset(42, 900);
    const { train } = splitDataset(dataset, 0.8);
    table = buildLikelihoodTable(train);
  });

  it('priors sum to 1 within tolerance', () => {
    const sum = EMOTIONS.reduce((s, e) => s + table.priors[e], 0);
    expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9);
  });

  it('all priors are strictly positive', () => {
    for (const e of EMOTIONS) {
      expect(table.priors[e]).toBeGreaterThan(0);
    }
  });

  it('all priors are less than 1', () => {
    for (const e of EMOTIONS) {
      expect(table.priors[e]).toBeLessThan(1);
    }
  });

  it('conditional distributions sum to 1 for each emotion × dimension', () => {
    for (const dim of DIMENSION_NAMES) {
      const bins = DIMENSION_BINS[dim] as readonly string[];
      const dimTable = (
        table.conditionals as Record<string, Record<string, Record<string, number>>>
      )[dim];

      for (const emotion of EMOTIONS) {
        const sum = bins.reduce((s, b) => s + dimTable[emotion][b], 0);
        expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9);
      }
    }
  });

  it('no zero probabilities in any conditional', () => {
    for (const dim of DIMENSION_NAMES) {
      const bins = DIMENSION_BINS[dim] as readonly string[];
      const dimTable = (
        table.conditionals as Record<string, Record<string, Record<string, number>>>
      )[dim];

      for (const emotion of EMOTIONS) {
        for (const b of bins) {
          expect(dimTable[emotion][b]).toBeGreaterThan(0);
        }
      }
    }
  });

  it('all conditional probabilities are less than 1', () => {
    for (const dim of DIMENSION_NAMES) {
      const bins = DIMENSION_BINS[dim] as readonly string[];
      const dimTable = (
        table.conditionals as Record<string, Record<string, Record<string, number>>>
      )[dim];

      for (const emotion of EMOTIONS) {
        for (const b of bins) {
          expect(dimTable[emotion][b]).toBeLessThan(1);
        }
      }
    }
  });

  it('produces deterministic output for the same input', () => {
    const dataset = generateDataset(42, 900);
    const { train } = splitDataset(dataset, 0.8);
    const table2 = buildLikelihoodTable(train);
    expect(JSON.stringify(table)).toBe(JSON.stringify(table2));
  });

  it('throws on empty dataset', () => {
    expect(() => buildLikelihoodTable([])).toThrow();
  });
});
