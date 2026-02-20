import { createMoodState, updateMoodState, EmotionFamily, MoodCategory, type MoodInputs } from "..";

const FAMILIES: EmotionFamily[] = [
  EmotionFamily.JOY,
  EmotionFamily.ANGER,
  EmotionFamily.FEAR,
  EmotionFamily.SADNESS,
  EmotionFamily.SURPRISE,
  EmotionFamily.DISGUST,
];

function familyVector(v: Partial<Record<EmotionFamily, number>>) {
  return {
    [EmotionFamily.JOY]: v[EmotionFamily.JOY] ?? 0,
    [EmotionFamily.ANGER]: v[EmotionFamily.ANGER] ?? 0,
    [EmotionFamily.FEAR]: v[EmotionFamily.FEAR] ?? 0,
    [EmotionFamily.SADNESS]: v[EmotionFamily.SADNESS] ?? 0,
    [EmotionFamily.SURPRISE]: v[EmotionFamily.SURPRISE] ?? 0,
    [EmotionFamily.DISGUST]: v[EmotionFamily.DISGUST] ?? 0,
  };
}

function baseInput(overrides: Partial<MoodInputs> = {}): MoodInputs {
  return {
    familyWeights: familyVector({}),
    pressureVector: familyVector({}),
    deltaMessageSeconds: 60,
    escalationLevel: 0,
    isShock: false,
    ...overrides,
  };
}

function sumMoodVector(m: Record<MoodCategory, number>): number {
  return (
    m[MoodCategory.POSITIVE] +
    m[MoodCategory.IRRITABLE] +
    m[MoodCategory.ANXIOUS] +
    m[MoodCategory.MELANCHOLIC] +
    m[MoodCategory.ALERT] +
    m[MoodCategory.AVERSIVE] +
    m[MoodCategory.NEUTRAL]
  );
}

function assertFiniteOutput(result: ReturnType<typeof updateMoodState>) {
  expect(Number.isFinite(result.outputs.moodDominance)).toBe(true);
  expect(Number.isFinite(result.outputs.moodConfidence)).toBe(true);
  expect(result.outputs.moodDominance).toBeGreaterThanOrEqual(0);
  expect(result.outputs.moodDominance).toBeLessThanOrEqual(1);
  expect(result.outputs.moodConfidence).toBeGreaterThanOrEqual(0);
  expect(result.outputs.moodConfidence).toBeLessThanOrEqual(1);
  for (const key of Object.values(MoodCategory)) {
    const value = result.outputs.moodVector[key];
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  }
  expect(sumMoodVector(result.outputs.moodVector)).toBeCloseTo(1, 6);
}

describe("mood-engine v0", () => {
  test("neutral start with zero inputs => NEUTRAL and low dominance", () => {
    const state = createMoodState();
    const result = updateMoodState(state, baseInput());

    assertFiniteOutput(result);
    expect(result.outputs.moodCategory).toBe(MoodCategory.NEUTRAL);
    expect(result.outputs.moodDominance).toBeLessThan(0.2);
  });

  test("sustained joy signal accumulates to POSITIVE", () => {
    let state = createMoodState();
    for (let i = 0; i < 120; i += 1) {
      const result = updateMoodState(
        state,
        baseInput({
          familyWeights: familyVector({
            [EmotionFamily.JOY]: 1,
          }),
          pressureVector: familyVector({
            [EmotionFamily.JOY]: 10,
          }),
          deltaMessageSeconds: 1800,
        })
      );
      state = result.state;
    }

    const final = updateMoodState(
      state,
      baseInput({
        familyWeights: familyVector({
          [EmotionFamily.JOY]: 1,
        }),
        pressureVector: familyVector({
          [EmotionFamily.JOY]: 10,
        }),
        deltaMessageSeconds: 1800,
      })
    );
    assertFiniteOutput(final);
    expect(final.outputs.moodCategory).toBe(MoodCategory.POSITIVE);
  });

  test("flap resistance on weak alternating signals", () => {
    let state = createMoodState();
    const seen: MoodCategory[] = [];

    for (let i = 0; i < 80; i += 1) {
      const joyTurn = i % 2 === 0;
      const result = updateMoodState(
        state,
        baseInput({
          familyWeights: familyVector({
            [joyTurn ? EmotionFamily.JOY : EmotionFamily.ANGER]: 0.2,
          }),
          pressureVector: familyVector({
            [joyTurn ? EmotionFamily.JOY : EmotionFamily.ANGER]: 0.6,
          }),
          deltaMessageSeconds: 30,
        })
      );
      state = result.state;
      seen.push(result.outputs.moodCategory);
    }

    const unique = new Set(seen);
    expect(unique.size).toBeLessThanOrEqual(2);
  });

  test("forced switch from POSITIVE to IRRITABLE under strong sustained anger", () => {
    let state = createMoodState();
    for (let i = 0; i < 80; i += 1) {
      state = updateMoodState(
        state,
        baseInput({
          familyWeights: familyVector({ [EmotionFamily.JOY]: 1 }),
          pressureVector: familyVector({ [EmotionFamily.JOY]: 10 }),
          deltaMessageSeconds: 1800,
        })
      ).state;
    }

    let latest = updateMoodState(
      state,
      baseInput({
        familyWeights: familyVector({ [EmotionFamily.ANGER]: 1 }),
        pressureVector: familyVector({ [EmotionFamily.ANGER]: 10 }),
        deltaMessageSeconds: 1800,
      })
    );
    for (let i = 0; i < 120 && latest.outputs.moodCategory !== MoodCategory.IRRITABLE; i += 1) {
      latest = updateMoodState(
        latest.state,
        baseInput({
          familyWeights: familyVector({ [EmotionFamily.ANGER]: 1 }),
          pressureVector: familyVector({ [EmotionFamily.ANGER]: 10 }),
          deltaMessageSeconds: 1800,
        })
      );
    }

    assertFiniteOutput(latest);
    expect(latest.outputs.moodCategory).toBe(MoodCategory.IRRITABLE);
  });

  test("cooldown blocks immediate switch back without force dominance", () => {
    let state = createMoodState({
      moodCategory: MoodCategory.POSITIVE,
      prevMoodCategory: MoodCategory.POSITIVE,
    });

    let switched = updateMoodState(
      state,
      baseInput({
        familyWeights: familyVector({ [EmotionFamily.ANGER]: 1 }),
        pressureVector: familyVector({ [EmotionFamily.ANGER]: 10 }),
        deltaMessageSeconds: 1800,
      })
    );
    for (let i = 0; i < 120 && switched.outputs.moodCategory !== MoodCategory.IRRITABLE; i += 1) {
      switched = updateMoodState(
        switched.state,
        baseInput({
          familyWeights: familyVector({ [EmotionFamily.ANGER]: 1 }),
          pressureVector: familyVector({ [EmotionFamily.ANGER]: 10 }),
          deltaMessageSeconds: 1800,
        })
      );
    }

    const briefOpposite = updateMoodState(
      switched.state,
      baseInput({
        familyWeights: familyVector({ [EmotionFamily.JOY]: 0.65 }),
        pressureVector: familyVector({ [EmotionFamily.JOY]: 6.5 }),
        deltaMessageSeconds: 30,
      })
    );

    assertFiniteOutput(briefOpposite);
    expect(briefOpposite.outputs.moodCategory).toBe(MoodCategory.IRRITABLE);
  });

  test("finite guards handle NaN/Infinity/negative delta safely", () => {
    const state = createMoodState();
    const result = updateMoodState(
      state,
      baseInput({
        familyWeights: familyVector({
          [EmotionFamily.JOY]: Number.NaN,
          [EmotionFamily.ANGER]: Number.POSITIVE_INFINITY,
        }),
        pressureVector: familyVector({
          [EmotionFamily.JOY]: Number.NEGATIVE_INFINITY,
          [EmotionFamily.ANGER]: Number.POSITIVE_INFINITY,
        }),
        deltaMessageSeconds: -100,
      })
    );

    assertFiniteOutput(result);
    expect(Object.values(MoodCategory)).toContain(result.outputs.moodCategory);
    for (const f of FAMILIES) {
      expect(Number.isFinite(result.state.moodEMA[f])).toBe(true);
    }
  });
});
