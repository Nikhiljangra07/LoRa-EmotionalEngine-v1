import { EkmanFamily, classifyFamily, type FamilyOutputs } from "..";

function sumWeights(outputs: FamilyOutputs): number {
  const w = outputs.familyWeights;
  return w.JOY + w.ANGER + w.FEAR + w.SADNESS + w.SURPRISE + w.DISGUST;
}

function assertInvariants(outputs: FamilyOutputs): void {
  const entries = Object.entries(outputs.familyWeights);
  for (const [, value] of entries) {
    expect(Number.isFinite(value)).toBe(true);
    expect(Number.isNaN(value)).toBe(false);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  }
  expect(Number.isFinite(outputs.confidence)).toBe(true);
  expect(outputs.confidence).toBeGreaterThanOrEqual(0);
  expect(outputs.confidence).toBeLessThanOrEqual(1);
  expect(sumWeights(outputs)).toBeCloseTo(1, 6);
}

describe("family-engine v0 scenario tests", () => {
  test("positive + high arousal => JOY dominant", () => {
    const result = classifyFamily({
      valence: 0.8,
      arousal: 0.8,
      expressionStrength: 0.6,
      signals: {
        capsRatio: 0.05,
        punctuationHits: 1,
        emojiHits: 1,
        repetitionScore: 0.1,
        questionMarks: 0,
      },
    });

    assertInvariants(result);
    expect(result.dominantFamily).toBe(EkmanFamily.JOY);
    expect(result.familyWeights.JOY).toBeGreaterThan(0.45);
    expect(result.confidence).toBeGreaterThan(0.2);
  });

  test("negative + low arousal => SADNESS dominant", () => {
    const result = classifyFamily({
      valence: -0.7,
      arousal: 0.2,
      expressionStrength: 0.3,
      signals: {
        capsRatio: 0.02,
        punctuationHits: 0,
        emojiHits: 0,
        repetitionScore: 0,
        questionMarks: 0,
      },
    });

    assertInvariants(result);
    expect(result.dominantFamily).toBe(EkmanFamily.SADNESS);
  });

  test("negative + high arousal + caps/punct => ANGER dominant", () => {
    const result = classifyFamily({
      valence: -0.7,
      arousal: 0.85,
      expressionStrength: 0.8,
      signals: {
        capsRatio: 0.5,
        punctuationHits: 8,
        emojiHits: 0,
        repetitionScore: 0.7,
        questionMarks: 1,
      },
    });

    assertInvariants(result);
    expect(result.dominantFamily).toBe(EkmanFamily.ANGER);
    expect(result.familyWeights.ANGER).toBeGreaterThan(result.familyWeights.FEAR);
  });

  test("negative + high arousal + many question marks => FEAR >= SURPRISE, FEAR > ANGER", () => {
    const result = classifyFamily({
      valence: -0.6,
      arousal: 0.85,
      expressionStrength: 0.4,
      signals: {
        capsRatio: 0.05,
        punctuationHits: 1,
        emojiHits: 0,
        repetitionScore: 0.2,
        questionMarks: 6,
      },
    });

    assertInvariants(result);
    expect(result.familyWeights.FEAR).toBeGreaterThanOrEqual(result.familyWeights.SURPRISE);
    expect(result.familyWeights.FEAR).toBeGreaterThan(result.familyWeights.ANGER);
  });

  test("neutral + high arousal + questions => SURPRISE dominant", () => {
    const result = classifyFamily({
      valence: 0.05,
      arousal: 0.9,
      expressionStrength: 0.3,
      signals: {
        capsRatio: 0.03,
        punctuationHits: 1,
        emojiHits: 0,
        repetitionScore: 0.1,
        questionMarks: 5,
      },
    });

    assertInvariants(result);
    expect(result.dominantFamily).toBe(EkmanFamily.SURPRISE);
  });

  test("all zeros => fallback neutral baseline with zero confidence", () => {
    const result = classifyFamily({
      valence: 0,
      arousal: 0,
      expressionStrength: 0,
      signals: {
        capsRatio: 0,
        punctuationHits: 0,
        emojiHits: 0,
        repetitionScore: 0,
        questionMarks: 0,
      },
    });

    assertInvariants(result);
    expect(result.dominantFamily).toBe(EkmanFamily.SURPRISE);
    expect(result.familyWeights.SURPRISE).toBeCloseTo(4 / 9, 6);
    expect(result.confidence).toBe(0);
    expect(result.reasons).toContain("FALLBACK_NEUTRAL_BASELINE");
  });

  test("negative high arousal without anger cues => FEAR weight >= ANGER weight", () => {
    const result = classifyFamily({
      valence: -0.6,
      arousal: 0.8,
      expressionStrength: 0.3,
      signals: {
        capsRatio: 0,
        punctuationHits: 0,
        emojiHits: 0,
        repetitionScore: 0.1,
        questionMarks: 0,
      },
    });

    assertInvariants(result);
    expect(result.familyWeights.FEAR).toBeGreaterThanOrEqual(result.familyWeights.ANGER);
  });

  test("negative mid arousal + repetition => DISGUST > ANGER", () => {
    const result = classifyFamily({
      valence: -0.6,
      arousal: 0.4,
      expressionStrength: 0.3,
      signals: {
        capsRatio: 0.05,
        punctuationHits: 0,
        emojiHits: 0,
        repetitionScore: 0.8,
        questionMarks: 0,
      },
    });

    assertInvariants(result);
    expect(result.familyWeights.DISGUST).toBeGreaterThan(result.familyWeights.ANGER);
  });

  test("all zeros fallback keeps surprise near baseline and avoids hard one-hot", () => {
    const result = classifyFamily({
      valence: 0,
      arousal: 0,
      expressionStrength: 0,
      signals: {
        capsRatio: 0,
        punctuationHits: 0,
        emojiHits: 0,
        repetitionScore: 0,
        questionMarks: 0,
      },
    });

    assertInvariants(result);
    expect(result.familyWeights.SURPRISE).toBeCloseTo(4 / 9, 6);
    expect(result.familyWeights.SURPRISE).toBeLessThan(1);
    expect(result.familyWeights.JOY).toBeLessThan(1);
    expect(result.familyWeights.SADNESS).toBeLessThan(1);
    expect(result.familyWeights.FEAR).toBeLessThan(1);
    expect(result.familyWeights.ANGER).toBeLessThan(1);
    expect(result.familyWeights.DISGUST).toBeLessThan(1);
  });
});
