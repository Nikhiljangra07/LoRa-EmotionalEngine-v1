import {
  MAX_POST_WINDOW_SECONDS,
  POST_WINDOW_SECONDS,
  createPostClarityState,
  updatePostClarityState,
} from "..";

describe("post-clarity-engine", () => {
  test("no trigger: calm inputs keep agency near zero and post mode inactive", () => {
    const state = createPostClarityState();
    const result = updatePostClarityState(state, {
      collapseEvent: false,
      collapseDirection: "NONE",
      escalationLevel: 1,
      escalationScore: 0.2,
      pressure: 1.5,
      pressureSlope: -0.01,
      valence: 0.6,
      deltaMessageSeconds: 30,
    });

    expect(result.outputs.agencyDeficit).toBeCloseTo(0, 12);
    expect(result.outputs.postModeActive).toBe(false);
    expect(result.state.relapseCount).toBe(0);
  });

  test("single collapse: trigger enters post mode with no relapse", () => {
    const state = createPostClarityState();
    const result = updatePostClarityState(state, {
      collapseEvent: true,
      collapseDirection: "OUTWARD",
      escalationLevel: 3,
      escalationScore: 1,
      pressure: 12,
      pressureSlope: 0.15,
      valence: -1,
      deltaMessageSeconds: 5,
    });

    expect(result.outputs.agencyDeficit).toBeGreaterThan(0);
    expect(result.outputs.postModeActive).toBe(true);
    expect(result.state.relapseCount).toBe(0);
    expect(result.state.postModeUntilSeconds).toBe(POST_WINDOW_SECONDS);
  });

  test("relapse: second trigger inside window extends duration and increments relapse", () => {
    let state = createPostClarityState();
    const first = updatePostClarityState(state, {
      collapseEvent: true,
      collapseDirection: "INWARD",
      escalationLevel: 0,
      escalationScore: 0,
      pressure: 0,
      pressureSlope: 0,
      valence: -0.5,
      deltaMessageSeconds: 0,
    });
    state = first.state;

    const second = updatePostClarityState(state, {
      collapseEvent: false,
      collapseDirection: "UNKNOWN",
      escalationLevel: 1,
      escalationScore: 0.2,
      pressure: 12,
      pressureSlope: 0.01,
      valence: 0.1,
      deltaMessageSeconds: 60,
    });

    expect(second.outputs.isRelapse).toBe(true);
    expect(second.state.relapseCount).toBe(1);
    expect(second.state.postModeUntilSeconds).toBeGreaterThan(POST_WINDOW_SECONDS);
    expect(second.state.postModeUntilSeconds).toBeLessThanOrEqual(
      MAX_POST_WINDOW_SECONDS
    );
    expect(second.outputs.reasons).toContain("RELAPSE");
  });

  test("decay: long quiet interval decays agency deficit toward zero", () => {
    let state = createPostClarityState();
    const triggered = updatePostClarityState(state, {
      collapseEvent: true,
      collapseDirection: "OUTWARD",
      escalationLevel: 3,
      escalationScore: 1,
      pressure: 20,
      pressureSlope: 1,
      valence: -1,
      deltaMessageSeconds: 1,
    });
    state = triggered.state;

    const decayed = updatePostClarityState(state, {
      collapseEvent: false,
      collapseDirection: "NONE",
      escalationLevel: 0,
      escalationScore: 0,
      pressure: 0,
      pressureSlope: 0,
      valence: 0.5,
      deltaMessageSeconds: 43200,
    });

    expect(decayed.outputs.agencyDeficit).toBeLessThan(triggered.outputs.agencyDeficit);
    expect(decayed.outputs.agencyDeficit).toBeGreaterThanOrEqual(0);
  });

  test("finite guards: NaN and Infinity inputs stay finite and stable", () => {
    const state = createPostClarityState();
    const result = updatePostClarityState(state, {
      collapseEvent: false,
      collapseDirection: "UNKNOWN",
      escalationLevel: Number.NaN,
      escalationScore: Number.POSITIVE_INFINITY,
      pressure: Number.NaN,
      pressureSlope: Number.NEGATIVE_INFINITY,
      valence: Number.NaN,
      deltaMessageSeconds: Number.POSITIVE_INFINITY,
    });

    expect(Number.isFinite(result.outputs.agencyDeficit)).toBe(true);
    expect(Number.isFinite(result.state.agencyDeficit)).toBe(true);
    expect(Number.isFinite(result.state.postModeUntilSeconds)).toBe(true);
    expect(Number.isFinite(result.state.cooldownSeconds)).toBe(true);
    expect(Number.isFinite(result.state.relapseCount)).toBe(true);
    expect(Number.isFinite(result.state.n)).toBe(true);
  });
});
