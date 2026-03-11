import {
  P_CRIT,
  CollapseDirection,
  MoodCategory,
  createCollapseState,
  updateCollapseState,
  type CollapseInputs,
} from "..";

function baseInput(overrides: Partial<CollapseInputs> = {}): CollapseInputs {
  return {
    escalationLevel: 0,
    escalationScore: 0,
    pressure: 0,
    pressureSlope: 0,
    moodCategory: MoodCategory.NEUTRAL,
    gain: 1,
    deltaMessageSeconds: 60,
    silenceFlag: false,
    burstFlag: false,
    negValenceHint: 0,
    ...overrides,
  };
}

function assertFinite(result: ReturnType<typeof updateCollapseState>): void {
  expect(Number.isFinite(result.outputs.collapseSeverity)).toBe(true);
  expect(result.outputs.collapseSeverity).toBeGreaterThanOrEqual(0);
  expect(result.outputs.collapseSeverity).toBeLessThanOrEqual(1);
  expect(Number.isFinite(result.state.cooldownSeconds)).toBe(true);
  expect(Number.isFinite(result.state.lastEventAtN)).toBe(true);
  expect(Number.isFinite(result.state.n)).toBe(true);
}

describe("collapse-engine v0", () => {
  test("no trigger calm", () => {
    const state = createCollapseState();
    const result = updateCollapseState(
      state,
      baseInput({
        escalationLevel: 0,
        escalationScore: 0.2,
        pressure: 2,
        pressureSlope: 0.01,
      })
    );

    assertFinite(result);
    expect(result.outputs.collapseEvent).toBe(false);
    expect(result.outputs.collapseDirection).toBe(CollapseDirection.NONE);
    expect(result.outputs.collapseSeverity).toBe(0);
  });

  test("critical escalation trigger", () => {
    const state = createCollapseState();
    const result = updateCollapseState(
      state,
      baseInput({
        escalationLevel: 3,
        escalationScore: 0.95,
      })
    );

    assertFinite(result);
    expect(result.outputs.collapseEvent).toBe(true);
    expect(result.outputs.collapseSeverity).toBeGreaterThanOrEqual(0.6);
    expect(result.outputs.reasons).toContain("TRIG_ESC_CRIT");
  });

  test("pressure trigger", () => {
    const state = createCollapseState();
    const result = updateCollapseState(
      state,
      baseInput({
        pressure: P_CRIT,
        pressureSlope: 0.05,
      })
    );

    assertFinite(result);
    expect(result.outputs.collapseEvent).toBe(true);
    expect(result.outputs.reasons).toContain("TRIG_PRESSURE_CRIT");
  });

  test("cooldown prevents repeated events without emergency override", () => {
    const initial = createCollapseState();
    const first = updateCollapseState(
      initial,
      baseInput({
        escalationLevel: 3,
        escalationScore: 0.95,
      })
    );
    const second = updateCollapseState(
      first.state,
      baseInput({
        escalationLevel: 3,
        escalationScore: 0.95,
        deltaMessageSeconds: 30,
      })
    );

    assertFinite(second);
    expect(first.outputs.collapseEvent).toBe(true);
    expect(second.outputs.collapseEvent).toBe(false);
    expect(second.outputs.reasons).toContain("COOLDOWN_BLOCK");
  });

  test("direction outward", () => {
    const state = createCollapseState();
    const result = updateCollapseState(
      state,
      baseInput({
        escalationLevel: 3,
        escalationScore: 0.99,
        gain: 1.2,
        burstFlag: true,
        moodCategory: MoodCategory.IRRITABLE,
        pressure: 0.85 * P_CRIT,
        pressureSlope: 0.08,
        negValenceHint: -0.7,
      })
    );

    assertFinite(result);
    expect(result.outputs.collapseEvent).toBe(true);
    expect(result.outputs.collapseDirection).toBe(CollapseDirection.OUTWARD);
  });

  test("direction inward", () => {
    const state = createCollapseState();
    const result = updateCollapseState(
      state,
      baseInput({
        escalationLevel: 3,
        escalationScore: 0.99,
        gain: 0.8,
        silenceFlag: true,
        deltaMessageSeconds: 320,
        moodCategory: MoodCategory.MELANCHOLIC,
        pressure: 0.8 * P_CRIT,
        pressureSlope: -0.02,
      })
    );

    assertFinite(result);
    expect(result.outputs.collapseEvent).toBe(true);
    expect(result.outputs.collapseDirection).toBe(CollapseDirection.INWARD);
  });

  test("finite guards with NaN/Infinity", () => {
    const state = createCollapseState();
    const result = updateCollapseState(
      state,
      baseInput({
        escalationLevel: Number.NaN,
        escalationScore: Number.POSITIVE_INFINITY,
        pressure: Number.NEGATIVE_INFINITY,
        pressureSlope: Number.NaN,
        gain: Number.POSITIVE_INFINITY,
        deltaMessageSeconds: Number.NEGATIVE_INFINITY,
        negValenceHint: Number.NaN,
      })
    );

    assertFinite(result);
    expect(typeof result.outputs.collapseEvent).toBe("boolean");
    expect(Object.values(CollapseDirection)).toContain(result.outputs.collapseDirection);
  });
});
