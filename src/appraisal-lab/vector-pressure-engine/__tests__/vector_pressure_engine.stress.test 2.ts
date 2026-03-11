import {
  R_MAX,
  createVectorPressureState,
  updateVectorPressureState,
  type Family,
  type FamilyVector,
  type VectorPressureInput,
} from "..";

type SeedState = { value: number };

const FAMILIES: Family[] = ["JOY", "ANGER", "FEAR", "SADNESS", "SURPRISE", "DISGUST"];

function nextSeed(seed: SeedState): number {
  seed.value = (seed.value * 1664525 + 1013904223) >>> 0;
  return seed.value;
}

function seededRand(seed: SeedState): number {
  return nextSeed(seed) / 4294967296;
}

function vector(values: Partial<FamilyVector>): FamilyVector {
  return {
    JOY: values.JOY ?? 0,
    ANGER: values.ANGER ?? 0,
    FEAR: values.FEAR ?? 0,
    SADNESS: values.SADNESS ?? 0,
    SURPRISE: values.SURPRISE ?? 0,
    DISGUST: values.DISGUST ?? 0,
  };
}

function sampledWeights(seed: SeedState): FamilyVector {
  const raw = FAMILIES.map(() => seededRand(seed));
  const sum = raw.reduce((acc, n) => acc + n, 0);
  return vector({
    JOY: raw[0] / sum,
    ANGER: raw[1] / sum,
    FEAR: raw[2] / sum,
    SADNESS: raw[3] / sum,
    SURPRISE: raw[4] / sum,
    DISGUST: raw[5] / sum,
  });
}

function sampledInput(seed: SeedState, pressureByFamily: FamilyVector): VectorPressureInput {
  return {
    pressureAfterDecayByFamily: pressureByFamily,
    familyWeights: sampledWeights(seed),
    confidence: seededRand(seed) * 1.3 - 0.1,
    gain: seededRand(seed) * 2.2,
    deltaMessageSeconds: seededRand(seed) * 5,
  };
}

describe("vector-pressure-engine stress", () => {
  test("50k deterministic updates stay finite and bounded", () => {
    let state = createVectorPressureState();
    const seed: SeedState = { value: 0x12345678 };

    for (let i = 0; i < 50000; i += 1) {
      const input = sampledInput(seed, state.pressureByFamily);
      const result = updateVectorPressureState(state, input);
      state = result.state;

      for (const family of FAMILIES) {
        const pressure = result.output.pressureByFamily[family];
        const delta = result.output.deltaPressureByFamily[family];

        expect(Number.isNaN(pressure)).toBe(false);
        expect(Number.isFinite(pressure)).toBe(true);
        expect(pressure).toBeGreaterThanOrEqual(0);
        expect(pressure).toBeLessThanOrEqual(R_MAX);

        expect(Number.isNaN(delta)).toBe(false);
        expect(Number.isFinite(delta)).toBe(true);
      }

      expect(Number.isFinite(result.output.totalPressure)).toBe(true);
      expect(Number.isFinite(result.output.volatilityTotal)).toBe(true);
      expect(result.output.volatilityTotal).toBeGreaterThanOrEqual(0);
      expect(FAMILIES).toContain(result.output.dominantFamily);
    }
  });
});
