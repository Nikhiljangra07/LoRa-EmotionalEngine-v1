import { createMoodState, updateMoodState, EmotionFamily, MoodCategory, type FamilyVector } from "..";

type SeedState = { value: number };

const FAMILIES: EmotionFamily[] = [
  EmotionFamily.JOY,
  EmotionFamily.ANGER,
  EmotionFamily.FEAR,
  EmotionFamily.SADNESS,
  EmotionFamily.SURPRISE,
  EmotionFamily.DISGUST,
];

const MOODS: MoodCategory[] = [
  MoodCategory.POSITIVE,
  MoodCategory.IRRITABLE,
  MoodCategory.ANXIOUS,
  MoodCategory.MELANCHOLIC,
  MoodCategory.ALERT,
  MoodCategory.AVERSIVE,
  MoodCategory.NEUTRAL,
];

function nextSeed(seed: SeedState): number {
  seed.value = (seed.value * 1664525 + 1013904223) >>> 0;
  return seed.value;
}

function seededRand(seed: SeedState): number {
  return nextSeed(seed) / 4294967296;
}

function familyVector(v: Partial<Record<EmotionFamily, number>>): FamilyVector {
  return {
    [EmotionFamily.JOY]: v[EmotionFamily.JOY] ?? 0,
    [EmotionFamily.ANGER]: v[EmotionFamily.ANGER] ?? 0,
    [EmotionFamily.FEAR]: v[EmotionFamily.FEAR] ?? 0,
    [EmotionFamily.SADNESS]: v[EmotionFamily.SADNESS] ?? 0,
    [EmotionFamily.SURPRISE]: v[EmotionFamily.SURPRISE] ?? 0,
    [EmotionFamily.DISGUST]: v[EmotionFamily.DISGUST] ?? 0,
  };
}

function sampledFamilyWeights(seed: SeedState): FamilyVector {
  const raw = FAMILIES.map(() => seededRand(seed));
  const sum = raw.reduce((acc, n) => acc + n, 0) || 1;
  return familyVector({
    [EmotionFamily.JOY]: raw[0] / sum,
    [EmotionFamily.ANGER]: raw[1] / sum,
    [EmotionFamily.FEAR]: raw[2] / sum,
    [EmotionFamily.SADNESS]: raw[3] / sum,
    [EmotionFamily.SURPRISE]: raw[4] / sum,
    [EmotionFamily.DISGUST]: raw[5] / sum,
  });
}

function sampledPressure(seed: SeedState): FamilyVector {
  return familyVector({
    [EmotionFamily.JOY]: seededRand(seed) * 40,
    [EmotionFamily.ANGER]: seededRand(seed) * 40,
    [EmotionFamily.FEAR]: seededRand(seed) * 40,
    [EmotionFamily.SADNESS]: seededRand(seed) * 40,
    [EmotionFamily.SURPRISE]: seededRand(seed) * 40,
    [EmotionFamily.DISGUST]: seededRand(seed) * 40,
  });
}

function sumMoodVector(vector: Record<MoodCategory, number>): number {
  return MOODS.reduce((acc, mood) => acc + vector[mood], 0);
}

describe("mood-engine stress", () => {
  test("50k deterministic updates remain finite and normalized", () => {
    let state = createMoodState();
    const seed: SeedState = { value: 0x1a2b3c4d };

    for (let i = 0; i < 50000; i += 1) {
      const result = updateMoodState(state, {
        familyWeights: sampledFamilyWeights(seed),
        pressureVector: sampledPressure(seed),
        deltaMessageSeconds: seededRand(seed) * 7200,
        escalationLevel: Math.floor(seededRand(seed) * 5),
        isShock: seededRand(seed) > 0.8,
      });
      state = result.state;

      expect(Number.isFinite(result.outputs.moodDominance)).toBe(true);
      expect(Number.isFinite(result.outputs.moodConfidence)).toBe(true);
      expect(result.outputs.moodDominance).toBeGreaterThanOrEqual(0);
      expect(result.outputs.moodDominance).toBeLessThanOrEqual(1);
      expect(result.outputs.moodConfidence).toBeGreaterThanOrEqual(0);
      expect(result.outputs.moodConfidence).toBeLessThanOrEqual(1);

      for (const mood of MOODS) {
        const w = result.outputs.moodVector[mood];
        expect(Number.isFinite(w)).toBe(true);
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(1);
      }
      expect(sumMoodVector(result.outputs.moodVector)).toBeCloseTo(1, 6);
      expect(Object.keys(result.outputs.moodVector)).toHaveLength(7);
      expect(MOODS).toContain(result.outputs.moodCategory);
    }
  });
});
