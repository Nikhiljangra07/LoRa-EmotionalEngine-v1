import { HARNESS_EPS, MAX_STEPS_STRESS } from "../constants";
import { runReplay } from "../replay_runner";
import { buildStressScenario, getReplayScenarios } from "../replay_scenarios";

function getScenario(name: string) {
  const scenario = getReplayScenarios().find((s) => s.name === name);
  if (!scenario) {
    throw new Error(`Missing scenario: ${name}`);
  }
  return scenario;
}

function levelChangeCount(levels: number[]): number {
  let changes = 0;
  for (let i = 1; i < levels.length; i += 1) {
    if (levels[i] !== levels[i - 1]) {
      changes += 1;
    }
  }
  return changes;
}

function assertFiniteInvariants(result: ReturnType<typeof runReplay>): void {
  for (const step of result.steps) {
    expect(Number.isFinite(step.time.pressureAfterDecay)).toBe(true);
    expect(Number.isFinite(step.time.gain)).toBe(true);
    expect(Number.isFinite(step.pressure.outputs.pressure)).toBe(true);
    expect(Number.isFinite(step.pressure.outputs.slope)).toBe(true);
    expect(Number.isFinite(step.pressure.outputs.volatility)).toBe(true);
    expect(Number.isFinite(step.escalation.outputs.escalationScore)).toBe(true);
    expect(Number.isFinite(step.postClarity.outputs.agencyDeficit)).toBe(true);
    expect(step.pressure.outputs.pressure).toBeGreaterThanOrEqual(0);
    expect(step.escalation.outputs.escalationScore).toBeGreaterThanOrEqual(0);
    expect(step.escalation.outputs.escalationScore).toBeLessThanOrEqual(1);
    expect(step.postClarity.outputs.agencyDeficit).toBeGreaterThanOrEqual(0);
    expect(step.postClarity.outputs.agencyDeficit).toBeLessThanOrEqual(1);
  }
}

describe("integration harness strict replay", () => {
  test("Scenario A causal chain: escalation rise -> collapse -> post -> substitute", () => {
    const scenario = getScenario("Scenario A - collapse->post->substitute");
    const result = runReplay(scenario.events);

    expect(result.summary.collapseCount).toBe(1);
    expect(result.summary.firstCollapseIndex).not.toBeNull();
    const firstCollapseIndex = result.summary.firstCollapseIndex as number;

    const preWindow = result.steps.slice(0, firstCollapseIndex + 1);
    const preMaxLevel = Math.max(
      ...preWindow.map((s) => s.escalation.outputs.escalationLevel)
    );
    const preMaxScore = Math.max(
      ...preWindow.map((s) => s.escalation.outputs.escalationScore)
    );
    if (!(preMaxLevel >= 1 || preMaxScore >= 0.5)) {
      throw new Error(
        "Collapse occurred without escalation rise. Wiring/scenario invalid OR collapse is pressure-only; must be documented."
      );
    }

    const postWindow = result.steps.slice(
      firstCollapseIndex + 1,
      firstCollapseIndex + 4
    );
    const postModeSoon = postWindow.some((s) => s.postClarity.outputs.postModeActive);
    expect(postModeSoon).toBe(true);
    expect(result.summary.everSubstitute).toBe(true);

    for (const step of result.steps) {
      if (step.postClarity.outputs.recoveryPath === "SUBSTITUTE") {
        expect(step.postClarity.outputs.postModeActive).toBe(true);
      }

      // Chain wiring invariants: traced inputs reflect upstream outputs.
      expect(step.pressure.inputs.pressureAfterDecay).toBe(
        step.time.pressureAfterDecay
      );
      expect(step.pressure.inputs.gain).toBe(step.time.gain);
      expect(step.escalation.inputs.slope).toBe(step.pressure.outputs.slope);
      expect(step.escalation.inputs.volatility).toBe(
        step.pressure.outputs.volatility
      );
      expect(step.escalation.inputs.isShock).toBe(step.pressure.outputs.isShock);
      expect(step.collapse.inputs.escalationLevel).toBe(
        step.escalation.outputs.escalationLevel
      );
      expect(step.collapse.inputs.escalationScore).toBeCloseTo(
        step.escalation.outputs.escalationScore,
        12
      );
      expect(step.postClarity.inputs.collapseEvent).toBe(
        step.collapse.outputs.collapseEvent
      );
    }

    assertFiniteInvariants(result);
  });

  test("Scenario B anti-flap remains stable", () => {
    const scenario = getScenario("Scenario B - anti-flap baseline");
    const result = runReplay(scenario.events);

    expect(result.summary.collapseCount).toBe(0);
    const levels = result.steps.map((s) => s.escalation.outputs.escalationLevel);
    expect(levelChangeCount(levels)).toBeLessThanOrEqual(6);
    assertFiniteInvariants(result);
  });

  test("Scenario C stress invariants + deterministic replay", () => {
    const scenario = getScenario("Scenario C - seeded stress");

    expect(() => runReplay(scenario.events)).not.toThrow();
    const a = runReplay(scenario.events);
    const b = runReplay(scenario.events);

    expect(a.summary).toEqual(b.summary);
    expect(a.steps.length).toBe(b.steps.length);

    for (let i = 0; i < a.steps.length; i += 1) {
      expect(a.steps[i].tsSeconds).toBeCloseTo(b.steps[i].tsSeconds, 12);
      expect(a.steps[i].pressure.outputs.pressure).toBeCloseTo(
        b.steps[i].pressure.outputs.pressure,
        12
      );
      expect(a.steps[i].escalation.outputs.escalationScore).toBeCloseTo(
        b.steps[i].escalation.outputs.escalationScore,
        12
      );
      expect(a.steps[i].postClarity.outputs.agencyDeficit).toBeCloseTo(
        b.steps[i].postClarity.outputs.agencyDeficit,
        12
      );
      expect(
        Math.abs(
          a.steps[i].escalation.outputs.escalationScore -
            b.steps[i].escalation.outputs.escalationScore
        )
      ).toBeLessThanOrEqual(HARNESS_EPS);
    }

    assertFiniteInvariants(a);
  });

  test("micro: non-finite scenario inputs are sanitized and tagged", () => {
    const result = runReplay([
      {
        tsSeconds: Number.NaN,
        activation: Number.POSITIVE_INFINITY,
        valence: Number.NaN,
        arousal: Number.NaN,
        expressionStrength: Number.NaN,
        pattern: { repetitionScore: Number.NaN },
        substituteEvidence: {
          validationSeekingScore: Number.NaN,
          topicShiftScore: Number.NaN,
          positiveReframeScore: Number.NaN,
        },
      },
      {
        tsSeconds: 10,
        activation: 0.1,
        valence: 0,
        arousal: 0.5,
        expressionStrength: 0.5,
        pattern: {},
      },
    ]);

    expect(result.steps.length).toBe(2);
    expect(result.steps[0].harnessTags).toContain("HARNESS_SANITIZED_INPUT");
    assertFiniteInvariants(result);
  });

  test("throws on non-monotonic timestamps", () => {
    expect(() =>
      runReplay([
        {
          tsSeconds: 10,
          activation: 0.1,
          valence: 0,
          arousal: 0,
          expressionStrength: 0,
          pattern: {},
        },
        {
          tsSeconds: 5,
          activation: 0.1,
          valence: 0,
          arousal: 0,
          expressionStrength: 0,
          pattern: {},
        },
      ])
    ).toThrow(/monotonic/i);
  });

  test("sanitizes NaN and Infinity inputs at harness boundary", () => {
    const result = runReplay([
      {
        tsSeconds: 0,
        activation: Number.NaN,
        valence: Number.POSITIVE_INFINITY,
        arousal: Number.NEGATIVE_INFINITY,
        expressionStrength: Number.NaN,
        pattern: { repetitionScore: Number.NaN },
      },
      {
        tsSeconds: 1,
        activation: 0.1,
        valence: 0,
        arousal: 0.2,
        expressionStrength: 0.3,
        pattern: {},
      },
    ]);

    expect(result.steps.length).toBe(2);
    expect(result.steps[0].harnessTags).toContain("HARNESS_SANITIZED_INPUT");
    assertFiniteInvariants(result);
  });

  test("handles large deltaMessageSeconds session gap", () => {
    const result = runReplay([
      {
        tsSeconds: 0,
        activation: 0.2,
        valence: 0,
        arousal: 0.3,
        expressionStrength: 0.2,
        pattern: {},
      },
      {
        tsSeconds: 5000,
        activation: 0.1,
        valence: 0,
        arousal: 0.1,
        expressionStrength: 0.1,
        pattern: {},
      },
    ]);

    expect(result.summary.collapseCount).toBe(0);
    expect(result.steps[1].time.pressureAfterDecay).toBeLessThanOrEqual(
      result.steps[0].pressure.outputs.pressure
    );
    assertFiniteInvariants(result);
  });

  test("handles missing pattern object gracefully", () => {
    const result = runReplay([
      {
        tsSeconds: 0,
        activation: 0.15,
        valence: 0,
        arousal: 0.2,
        expressionStrength: 0.2,
      } as unknown as Parameters<typeof runReplay>[0][number],
      {
        tsSeconds: 10,
        activation: 0.1,
        valence: 0,
        arousal: 0.1,
        expressionStrength: 0.1,
        pattern: {},
      },
    ]);

    expect(result.steps[0].postClarity.inputs.repetitionScore).toBe(0);
    assertFiniteInvariants(result);
  });

  test("handles missing substituteEvidence object", () => {
    const result = runReplay([
      {
        tsSeconds: 0,
        activation: 0.9,
        valence: -0.2,
        arousal: 0.6,
        expressionStrength: 0.8,
        pattern: { repetitionScore: 0.1 },
      },
      {
        tsSeconds: 45,
        activation: -0.2,
        valence: -0.1,
        arousal: 0.2,
        expressionStrength: 0.2,
        pattern: { repetitionScore: 0.05 },
      },
    ]);

    expect(result.steps.every((s) => s.postClarity.inputs.validationSeekingScore === 0)).toBe(
      true
    );
    expect(result.steps.every((s) => s.postClarity.inputs.topicShiftScore === 0)).toBe(true);
    expect(
      result.steps.every((s) => s.postClarity.inputs.positiveReframeScore === 0)
    ).toBe(true);
    assertFiniteInvariants(result);
  });

  test("throws when stress scenario exceeds MAX_STEPS_STRESS", () => {
    expect(() => buildStressScenario(MAX_STEPS_STRESS + 1)).toThrow(
      /exceeded MAX_STEPS_STRESS/i
    );
  });
});
