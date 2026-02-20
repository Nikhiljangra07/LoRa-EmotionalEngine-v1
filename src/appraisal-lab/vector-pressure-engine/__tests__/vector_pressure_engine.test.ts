import {
  createVectorPressureState,
  updateVectorPressureState,
  type FamilyVector,
  type VectorPressureInput,
} from "..";

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

function baseInput(overrides: Partial<VectorPressureInput> = {}): VectorPressureInput {
  return {
    pressureAfterDecayByFamily: vector({}),
    familyWeights: vector({
      JOY: 1 / 6,
      ANGER: 1 / 6,
      FEAR: 1 / 6,
      SADNESS: 1 / 6,
      SURPRISE: 1 / 6,
      DISGUST: 1 / 6,
    }),
    confidence: 0.5,
    gain: 1.0,
    deltaMessageSeconds: 1,
    ...overrides,
  };
}

describe("vector-pressure-engine", () => {
  test("low confidence with neutral weights yields tiny accumulation", () => {
    const state = createVectorPressureState();
    const result = updateVectorPressureState(
      state,
      baseInput({
        confidence: 0.05,
        gain: 1.0,
      })
    );

    expect(result.output.totalPressure).toBeLessThan(0.1);
    expect(result.output.isShock).toBe(false);
  });

  test("high confidence + JOY=0.8 grows JOY pressure fastest", () => {
    let state = createVectorPressureState();
    const weights = vector({
      JOY: 0.8,
      ANGER: 0.05,
      FEAR: 0.05,
      SADNESS: 0.04,
      SURPRISE: 0.03,
      DISGUST: 0.03,
    });

    for (let i = 0; i < 3; i += 1) {
      const result = updateVectorPressureState(
        state,
        baseInput({
          pressureAfterDecayByFamily: state.pressureByFamily,
          familyWeights: weights,
          confidence: 0.95,
          gain: 1.0,
        })
      );
      state = result.state;
    }

    const p = state.pressureByFamily;
    expect(p.JOY).toBeGreaterThan(p.ANGER);
    expect(p.JOY).toBeGreaterThan(p.FEAR);
    expect(p.JOY).toBeGreaterThan(p.SADNESS);
    expect(p.JOY).toBeGreaterThan(p.SURPRISE);
    expect(p.JOY).toBeGreaterThan(p.DISGUST);
  });

  test("sudden JOY->ANGER shift triggers shock and ANGER jump", () => {
    let state = createVectorPressureState();
    const joyDominant = vector({
      JOY: 0.85,
      ANGER: 0.05,
      FEAR: 0.03,
      SADNESS: 0.03,
      SURPRISE: 0.02,
      DISGUST: 0.02,
    });
    const angerDominant = vector({
      JOY: 0.05,
      ANGER: 0.85,
      FEAR: 0.03,
      SADNESS: 0.03,
      SURPRISE: 0.02,
      DISGUST: 0.02,
    });

    const first = updateVectorPressureState(
      state,
      baseInput({
        pressureAfterDecayByFamily: state.pressureByFamily,
        familyWeights: joyDominant,
        confidence: 0.9,
      })
    );
    state = first.state;

    const second = updateVectorPressureState(
      state,
      baseInput({
        pressureAfterDecayByFamily: state.pressureByFamily,
        familyWeights: angerDominant,
        confidence: 0.9,
      })
    );

    expect(second.output.isShock).toBe(true);
    expect(second.output.deltaPressureByFamily.ANGER).toBeGreaterThan(
      second.output.deltaPressureByFamily.JOY
    );
    expect(second.output.pressureByFamily.ANGER).toBeGreaterThan(first.output.pressureByFamily.ANGER);
  });

  test("gain 1.3 produces larger deltas than gain 1.0", () => {
    const state = createVectorPressureState();
    const input = baseInput({
      familyWeights: vector({
        JOY: 0.7,
        ANGER: 0.1,
        FEAR: 0.05,
        SADNESS: 0.05,
        SURPRISE: 0.05,
        DISGUST: 0.05,
      }),
      confidence: 0.8,
    });

    const lowGain = updateVectorPressureState(state, {
      ...input,
      gain: 1.0,
    });
    const highGain = updateVectorPressureState(state, {
      ...input,
      gain: 1.3,
    });

    expect(highGain.output.deltaPressureByFamily.JOY).toBeGreaterThan(
      lowGain.output.deltaPressureByFamily.JOY
    );
    expect(highGain.output.totalPressure).toBeGreaterThan(lowGain.output.totalPressure);
  });

  test("determinism: identical input sequence yields identical states", () => {
    const sequence: VectorPressureInput[] = [
      baseInput({
        confidence: 0.2,
        familyWeights: vector({
          JOY: 0.2,
          ANGER: 0.2,
          FEAR: 0.2,
          SADNESS: 0.2,
          SURPRISE: 0.1,
          DISGUST: 0.1,
        }),
      }),
      baseInput({
        confidence: 0.9,
        familyWeights: vector({
          JOY: 0.1,
          ANGER: 0.75,
          FEAR: 0.05,
          SADNESS: 0.04,
          SURPRISE: 0.03,
          DISGUST: 0.03,
        }),
      }),
      baseInput({
        confidence: 0.6,
        gain: 1.1,
        familyWeights: vector({
          JOY: 0.6,
          ANGER: 0.1,
          FEAR: 0.1,
          SADNESS: 0.1,
          SURPRISE: 0.05,
          DISGUST: 0.05,
        }),
      }),
    ];

    let stateA = createVectorPressureState();
    let stateB = createVectorPressureState();

    for (const step of sequence) {
      stateA = updateVectorPressureState(stateA, {
        ...step,
        pressureAfterDecayByFamily: stateA.pressureByFamily,
      }).state;
      stateB = updateVectorPressureState(stateB, {
        ...step,
        pressureAfterDecayByFamily: stateB.pressureByFamily,
      }).state;
    }

    expect(stateA).toEqual(stateB);
  });
});
