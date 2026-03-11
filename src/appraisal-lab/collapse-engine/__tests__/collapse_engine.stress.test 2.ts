import {
  CollapseDirection,
  MoodCategory,
  createCollapseState,
  updateCollapseState,
  type CollapseInputs,
  type CollapseOutputs,
} from "..";

type SeedState = { value: number };

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

function buildInput(seed: SeedState, i: number): CollapseInputs {
  const base: CollapseInputs = {
    escalationLevel: Math.floor(seededRand(seed) * 3), // mostly 0..2
    escalationScore: seededRand(seed) * 0.9,
    pressure: seededRand(seed) * 10,
    pressureSlope: seededRand(seed) * 0.2 - 0.1,
    moodCategory: MOODS[Math.floor(seededRand(seed) * MOODS.length)] ?? MoodCategory.NEUTRAL,
    gain: 0.75 + seededRand(seed) * 0.6,
    deltaMessageSeconds: Math.floor(seededRand(seed) * 180),
    silenceFlag: seededRand(seed) > 0.96,
    burstFlag: seededRand(seed) > 0.96,
    negValenceHint: seededRand(seed) * 2 - 1,
  };

  // Controlled rare spikes.
  if (i % 1000 === 0) {
    base.escalationLevel = 3;
    base.escalationScore = 0.995;
    base.pressure = 15;
    base.pressureSlope = 0.2;
    base.gain = 1.25;
    base.moodCategory = MoodCategory.IRRITABLE;
    base.burstFlag = true;
  }

  if (i % 7777 === 0) {
    base.escalationScore = Number.POSITIVE_INFINITY;
    base.pressureSlope = Number.NaN;
  }

  return base;
}

function snapshotOutput(output: CollapseOutputs): string {
  return [
    output.collapseEvent ? "1" : "0",
    output.collapseDirection,
    output.collapseSeverity.toFixed(9),
    output.reasons.join(","),
  ].join("|");
}

describe("collapse-engine stress", () => {
  test("50k deterministic loop stays finite with bounded event rate", () => {
    let state = createCollapseState();
    const seed: SeedState = { value: 0xabcdef01 };
    let events = 0;

    for (let i = 0; i < 50000; i += 1) {
      const result = updateCollapseState(state, buildInput(seed, i));
      state = result.state;

      if (result.outputs.collapseEvent) {
        events += 1;
      }
      expect(Number.isFinite(result.outputs.collapseSeverity)).toBe(true);
      expect(result.outputs.collapseSeverity).toBeGreaterThanOrEqual(0);
      expect(result.outputs.collapseSeverity).toBeLessThanOrEqual(1);
      expect(Object.values(CollapseDirection)).toContain(result.outputs.collapseDirection);
      expect(Number.isFinite(result.state.cooldownSeconds)).toBe(true);
      expect(Number.isFinite(result.state.n)).toBe(true);
      expect(Number.isFinite(result.state.lastEventAtN)).toBe(true);
    }

    const eventRate = events / 50000;
    expect(eventRate).toBeLessThanOrEqual(0.05);
  });

  test("determinism replay matches exactly", () => {
    let stateA = createCollapseState();
    let stateB = createCollapseState();
    const seedA: SeedState = { value: 0x12345678 };
    const seedB: SeedState = { value: 0x12345678 };
    const seqA: string[] = [];
    const seqB: string[] = [];

    for (let i = 0; i < 5000; i += 1) {
      const outA = updateCollapseState(stateA, buildInput(seedA, i));
      const outB = updateCollapseState(stateB, buildInput(seedB, i));
      stateA = outA.state;
      stateB = outB.state;
      seqA.push(snapshotOutput(outA.outputs));
      seqB.push(snapshotOutput(outB.outputs));
    }

    expect(seqA).toEqual(seqB);
  });
});
