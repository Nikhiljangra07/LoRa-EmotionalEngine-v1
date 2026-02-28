import { mapEkmanToDominant, EKMAN_CONFIDENCE_THRESHOLD } from '../ekmanToDominant';

describe('mapEkmanToDominant', () => {
  test('maps valid Ekman family with sufficient confidence', () => {
    const result = mapEkmanToDominant('ANGER', 0.7);
    expect(result).toEqual({ ekmanDominant: 'ANGER', ekmanConfidence: 0.7 });
  });

  test.each(['JOY', 'ANGER', 'FEAR', 'SADNESS', 'SURPRISE', 'DISGUST'])(
    'maps %s correctly',
    (family) => {
      const result = mapEkmanToDominant(family, 0.5);
      expect(result).toBeDefined();
      expect(result!.ekmanDominant).toBe(family);
    },
  );

  test('returns undefined when confidence is below threshold', () => {
    const result = mapEkmanToDominant('ANGER', 0.2);
    expect(result).toBeUndefined();
  });

  test('returns undefined at exact threshold boundary', () => {
    const result = mapEkmanToDominant('ANGER', EKMAN_CONFIDENCE_THRESHOLD - 0.001);
    expect(result).toBeUndefined();
  });

  test('returns value at exact threshold', () => {
    const result = mapEkmanToDominant('ANGER', EKMAN_CONFIDENCE_THRESHOLD);
    expect(result).toBeDefined();
  });

  test('returns undefined for unknown family name', () => {
    const result = mapEkmanToDominant('CONTEMPT', 0.9);
    expect(result).toBeUndefined();
  });

  test('returns undefined for empty string', () => {
    const result = mapEkmanToDominant('', 0.9);
    expect(result).toBeUndefined();
  });
});
