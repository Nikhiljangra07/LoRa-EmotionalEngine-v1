import { EkmanFamily, classifyFamily, type FamilyInputs, type FamilyOutputs } from "..";

type SeedState = { value: number };

function nextSeed(seed: SeedState): number {
  // LCG constants from Numerical Recipes (mod 2^32).
  seed.value = (seed.value * 1664525 + 1013904223) >>> 0;
  return seed.value;
}

function seededRand(seed: SeedState): number {
  return nextSeed(seed) / 4294967296;
}

function buildInput(seed: SeedState, i: number): FamilyInputs {
  const valence = seededRand(seed) * 4 - 2;
  const arousal = seededRand(seed) * 3 - 1;
  const expressionStrength = seededRand(seed) * 3 - 1;
  const capsRatio = seededRand(seed) * 1.5;
  const punctuationHits = Math.floor(seededRand(seed) * 12);
  const emojiHits = Math.floor(seededRand(seed) * 10);
  const repetitionScore = seededRand(seed) * 1.8;
  const questionMarks = Math.floor(seededRand(seed) * 10);

  const input: FamilyInputs = {
    valence,
    arousal,
    expressionStrength,
    signals: {
      capsRatio,
      punctuationHits,
      emojiHits,
      repetitionScore,
      questionMarks,
    },
    deltaMessageSeconds: seededRand(seed) * 120,
    gain: seededRand(seed) * 4 - 1,
  };

  if (i % 997 === 0) {
    input.valence = Number.NaN;
  }
  if (i % 1999 === 0) {
    input.arousal = Number.POSITIVE_INFINITY;
  }
  if (i % 2999 === 0) {
    input.expressionStrength = Number.NEGATIVE_INFINITY;
  }
  if (i % 4093 === 0) {
    input.signals.repetitionScore = Number.NaN;
    input.signals.questionMarks = Number.POSITIVE_INFINITY;
  }

  return input;
}

function sumWeights(outputs: FamilyOutputs): number {
  const w = outputs.familyWeights;
  return w.JOY + w.ANGER + w.FEAR + w.SADNESS + w.SURPRISE + w.DISGUST;
}

function assertValidOutput(outputs: FamilyOutputs): void {
  const weights = outputs.familyWeights;
  const families: EkmanFamily[] = [
    EkmanFamily.JOY,
    EkmanFamily.ANGER,
    EkmanFamily.FEAR,
    EkmanFamily.SADNESS,
    EkmanFamily.SURPRISE,
    EkmanFamily.DISGUST,
  ];

  for (const family of families) {
    const value = weights[family];
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  }

  expect(sumWeights(outputs)).toBeCloseTo(1, 6);
  expect(Number.isFinite(outputs.confidence)).toBe(true);
  expect(outputs.confidence).toBeGreaterThanOrEqual(0);
  expect(outputs.confidence).toBeLessThanOrEqual(1);
  expect(families).toContain(outputs.dominantFamily);
}

function snapshotOutput(outputs: FamilyOutputs): string {
  const w = outputs.familyWeights;
  const round9 = (n: number): string => n.toFixed(9);
  return [
    outputs.dominantFamily,
    round9(w.JOY),
    round9(w.ANGER),
    round9(w.FEAR),
    round9(w.SADNESS),
    round9(w.SURPRISE),
    round9(w.DISGUST),
  ].join("|");
}

describe("family-engine deterministic stress", () => {
  test("50k generated inputs remain finite and normalized", () => {
    const seed: SeedState = { value: 0x1234abcd };

    for (let i = 0; i < 50000; i += 1) {
      const input = buildInput(seed, i);
      const output = classifyFamily(input);
      assertValidOutput(output);
    }
  });

  test("5k same-seed replay is bit-deterministic at 1e-9", () => {
    const seedA: SeedState = { value: 0xdecafbad };
    const seedB: SeedState = { value: 0xdecafbad };

    const seqA: string[] = [];
    const seqB: string[] = [];

    for (let i = 0; i < 5000; i += 1) {
      const outputA = classifyFamily(buildInput(seedA, i));
      const outputB = classifyFamily(buildInput(seedB, i));
      seqA.push(snapshotOutput(outputA));
      seqB.push(snapshotOutput(outputB));
    }

    expect(seqA).toEqual(seqB);
  });
});
