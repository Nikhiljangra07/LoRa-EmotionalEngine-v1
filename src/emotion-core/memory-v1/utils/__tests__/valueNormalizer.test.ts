import { normalizeDate, normalizeMoney } from '../valueNormalizer';

describe('valueNormalizer', () => {
  describe('normalizeDate', () => {
    it('returns ISO date string YYYY-MM-DD for valid date', () => {
      expect(normalizeDate('March 23 2026')).toBe('2026-03-23');
      expect(normalizeDate('March 23, 2026')).toBe('2026-03-23');
      expect(normalizeDate('2026-03-23')).toBe('2026-03-23');
    });

    it('returns null for invalid date', () => {
      expect(normalizeDate('not a date')).toBeNull();
      expect(normalizeDate('')).toBeNull();
    });
  });

  describe('normalizeMoney', () => {
    it('parses integer from string with optional commas', () => {
      expect(normalizeMoney('2000')).toBe(2000);
      expect(normalizeMoney('2,000')).toBe(2000);
      expect(normalizeMoney('1,000,000')).toBe(1000000);
    });

    it('returns null for non-numeric', () => {
      expect(normalizeMoney('abc')).toBeNull();
      expect(normalizeMoney('')).toBeNull();
    });
  });
});
