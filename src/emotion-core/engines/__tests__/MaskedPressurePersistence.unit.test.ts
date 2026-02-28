import { isMaskedPressurePersistent, MASKED_PRESSURE_HISTORY_MAX } from '../maskedPressurePersistence';

describe('Masked Pressure Persistence Gate (2-of-4)', () => {
  test('1-of-4 does not trigger', () => {
    expect(isMaskedPressurePersistent([true, false, false, false])).toBe(false);
    expect(isMaskedPressurePersistent([false, true, false, false])).toBe(false);
    expect(isMaskedPressurePersistent([false, false, false, true])).toBe(false);
    expect(isMaskedPressurePersistent([true])).toBe(false);
  });

  test('2-of-4 triggers', () => {
    expect(isMaskedPressurePersistent([true, true, false, false])).toBe(true);
    expect(isMaskedPressurePersistent([true, false, true, false])).toBe(true);
    expect(isMaskedPressurePersistent([false, true, false, true])).toBe(true);
    expect(isMaskedPressurePersistent([true, true])).toBe(true);
  });

  test('3-of-4 and 4-of-4 trigger', () => {
    expect(isMaskedPressurePersistent([true, true, true, false])).toBe(true);
    expect(isMaskedPressurePersistent([true, true, true, true])).toBe(true);
  });

  test('uses only last 4 entries', () => {
    // 5 entries: first 3 true, last 2 false → last 4 = [true, true, false, false] → 2-of-4 triggers
    expect(isMaskedPressurePersistent([true, true, true, false, false])).toBe(true);
    // 5 entries: first 2 true, last 3 false → last 4 = [true, false, false, false] → 1-of-4, no trigger
    expect(isMaskedPressurePersistent([true, true, false, false, false])).toBe(false);
  });

  test('empty history does not trigger', () => {
    expect(isMaskedPressurePersistent([])).toBe(false);
  });

  test('MASKED_PRESSURE_HISTORY_MAX is 4', () => {
    expect(MASKED_PRESSURE_HISTORY_MAX).toBe(4);
  });
});
