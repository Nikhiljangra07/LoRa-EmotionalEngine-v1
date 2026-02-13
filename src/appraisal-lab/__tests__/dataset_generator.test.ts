/**
 * Tests for the deterministic synthetic dataset generator.
 */

import { generateDataset, SeededRNG } from '../dataset/generator';
import { validateRow } from '../schema';
import { EMOTIONS } from '../schema';

describe('SeededRNG', () => {
  it('produces deterministic output for the same seed', () => {
    const rng1 = new SeededRNG(42);
    const rng2 = new SeededRNG(42);
    const values1 = Array.from({ length: 100 }, () => rng1.next());
    const values2 = Array.from({ length: 100 }, () => rng2.next());
    expect(values1).toEqual(values2);
  });

  it('produces different output for different seeds', () => {
    const rng1 = new SeededRNG(42);
    const rng2 = new SeededRNG(123);
    const values1 = Array.from({ length: 20 }, () => rng1.next());
    const values2 = Array.from({ length: 20 }, () => rng2.next());
    expect(values1).not.toEqual(values2);
  });

  it('produces values in [0, 1)', () => {
    const rng = new SeededRNG(99);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('generateDataset', () => {
  it('same seed produces identical dataset', () => {
    const ds1 = generateDataset(42, 100);
    const ds2 = generateDataset(42, 100);
    expect(JSON.stringify(ds1)).toBe(JSON.stringify(ds2));
  });

  it('different seed produces different dataset', () => {
    const ds1 = generateDataset(42, 100);
    const ds2 = generateDataset(123, 100);
    // At minimum, the first row should differ (extremely unlikely to match)
    const firstTextsMatch = ds1[0].text === ds2[0].text && ds1[0].emotion === ds2[0].emotion;
    expect(firstTextsMatch).toBe(false);
  });

  it('generates the requested number of rows', () => {
    expect(generateDataset(42, 100).length).toBe(100);
    expect(generateDataset(42, 900).length).toBe(900);
    expect(generateDataset(42, 50).length).toBe(50);
  });

  it('generates default 900 rows when n is omitted', () => {
    const ds = generateDataset(42);
    expect(ds.length).toBe(900);
  });

  it('all rows pass schema validation', () => {
    const ds = generateDataset(42, 900);
    for (const row of ds) {
      expect(validateRow(row)).toBe(true);
    }
  });

  it('generates sequential IDs in APR-XXXX format', () => {
    const ds = generateDataset(42, 100);
    for (let i = 0; i < ds.length; i++) {
      expect(ds[i].id).toBe(`APR-${String(i + 1).padStart(4, '0')}`);
    }
  });

  it('covers all six emotions', () => {
    const ds = generateDataset(42, 900);
    const present = new Set(ds.map(r => r.emotion));
    for (const e of EMOTIONS) {
      expect(present.has(e)).toBe(true);
    }
  });

  it('has mildly imbalanced but not extreme distribution', () => {
    const ds = generateDataset(42, 900);
    const counts: Record<string, number> = {};
    for (const e of EMOTIONS) counts[e] = 0;
    for (const row of ds) counts[row.emotion]++;

    // Each emotion should have at least 80 and at most 250 rows out of 900
    for (const e of EMOTIONS) {
      expect(counts[e]).toBeGreaterThan(80);
      expect(counts[e]).toBeLessThan(250);
    }
  });

  it('all texts are non-empty strings', () => {
    const ds = generateDataset(42, 900);
    for (const row of ds) {
      expect(typeof row.text).toBe('string');
      expect(row.text.length).toBeGreaterThan(10);
    }
  });
});
