import { MASTER_CONSTANTS } from '../master.constants';

const expectFinite = (value: number) => {
  expect(Number.isFinite(value)).toBe(true);
};

describe('MASTER_CONSTANTS — numeric invariants', () => {
  test('all scoring numbers are finite', () => {
    const { es } = MASTER_CONSTANTS;

    Object.values(es.weights).forEach(expectFinite);
    Object.values(es.saturation).forEach(expectFinite);
    expectFinite(es.shortMessage.maxLength);
    expectFinite(es.shortMessage.boost);
    expectFinite(es.shortMessage.scoreThreshold);
    expectFinite(es.scoring.capsRatioMultiplier);
    expectFinite(es.scoring.mixedPunctuationBoost);
    expectFinite(es.clip.min);
    expectFinite(es.clip.max);

    Object.values(MASTER_CONSTANTS.capitalization.weights).forEach(expectFinite);
    Object.values(MASTER_CONSTANTS.capitalization.thresholds).forEach(expectFinite);
    Object.values(MASTER_CONSTANTS.capitalization.confidence).forEach(expectFinite);

    Object.values(MASTER_CONSTANTS.punctuationAnalyzer.thresholds).forEach(
      expectFinite
    );
    Object.values(MASTER_CONSTANTS.punctuationAnalyzer.scoring).forEach(
      expectFinite
    );

    Object.values(MASTER_CONSTANTS.emojiAnalyzer.thresholds).forEach(
      expectFinite
    );
    Object.values(MASTER_CONSTANTS.emojiAnalyzer.defaults).forEach(expectFinite);

    Object.values(MASTER_CONSTANTS.repetitionAnalyzer.thresholds).forEach(
      expectFinite
    );

    Object.values(MASTER_CONSTANTS.nrcLexiconAnalyzer.thresholds).forEach(
      expectFinite
    );
    Object.values(MASTER_CONSTANTS.nrcLexiconAnalyzer.normalization).forEach(
      expectFinite
    );

    Object.values(MASTER_CONSTANTS.negationScopeAnalyzer.windows).forEach(
      expectFinite
    );
    Object.values(MASTER_CONSTANTS.negationScopeAnalyzer.thresholds).forEach(
      expectFinite
    );
  });

  test('ranges are sane', () => {
    const { es } = MASTER_CONSTANTS;

    Object.values(es.weights).forEach((value) => {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    });

    expect(es.shortMessage.boost).toBeGreaterThanOrEqual(0);
    expect(es.shortMessage.boost).toBeLessThanOrEqual(1);
    expect(es.shortMessage.scoreThreshold).toBeGreaterThanOrEqual(0);
    expect(es.shortMessage.scoreThreshold).toBeLessThanOrEqual(1);

    expect(es.clip.min).toBeGreaterThanOrEqual(0);
    expect(es.clip.max).toBeLessThanOrEqual(1);

    Object.values(MASTER_CONSTANTS.capitalization.weights).forEach((value) => {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    });
    Object.values(MASTER_CONSTANTS.capitalization.confidence).forEach((value) => {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    });

    expect(MASTER_CONSTANTS.punctuationAnalyzer.thresholds.positionStartRatio)
      .toBeGreaterThanOrEqual(0);
    expect(MASTER_CONSTANTS.punctuationAnalyzer.thresholds.positionEndRatio)
      .toBeLessThanOrEqual(1);
    expect(MASTER_CONSTANTS.punctuationAnalyzer.scoring.mixedPairDivisor)
      .toBeGreaterThan(0);

    expect(MASTER_CONSTANTS.repetitionAnalyzer.thresholds.minRepeatCount)
      .toBeGreaterThanOrEqual(2);

    expect(MASTER_CONSTANTS.nrcLexiconAnalyzer.thresholds.dominantGapMin)
      .toBeGreaterThanOrEqual(0);
    expect(MASTER_CONSTANTS.nrcLexiconAnalyzer.thresholds.dominantGapMin)
      .toBeLessThanOrEqual(1);
  });
});
