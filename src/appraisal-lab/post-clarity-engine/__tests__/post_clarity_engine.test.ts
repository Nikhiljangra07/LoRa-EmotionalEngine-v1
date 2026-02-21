import {
  MAX_POST_WINDOW_SECONDS,
  POST_WINDOW_SECONDS,
  createPostClarityState,
  updatePostClarityState,
} from "..";
import { SPIRAL_THRESHOLD } from "../constants";

describe("post-clarity-engine", () => {
  test("calm inputs keep spiral at zero and recovery path UNKNOWN", () => {
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
    expect(result.state.spiralScore).toBe(0);
    expect(result.outputs.recoveryPath).toBe("UNKNOWN");
  });

  test("post mode with high repetition and high gain eventually enters SPIRAL", () => {
    let state = createPostClarityState();
    const first = updatePostClarityState(state, {
      collapseEvent: true,
      collapseDirection: "OUTWARD",
      escalationLevel: 3,
      escalationScore: 1,
      pressure: 12,
      pressureSlope: 0.15,
      valence: -1,
      deltaMessageSeconds: 5,
      repetitionScore: 0.2,
      gain: 1,
    });
    state = first.state;

    let latest = first;
    for (let i = 0; i < 3; i += 1) {
      latest = updatePostClarityState(state, {
        collapseEvent: false,
        collapseDirection: "OUTWARD",
        escalationLevel: 1,
        escalationScore: 0.1,
        pressure: 12.5,
        pressureSlope: 0.2,
        valence: -0.2,
        deltaMessageSeconds: 10,
        repetitionScore: 1,
        gain: 1.5,
      });
      state = latest.state;
      if (latest.outputs.recoveryPath === "SPIRAL") {
        break;
      }
    }

    expect(latest.outputs.postModeActive).toBe(true);
    expect(latest.state.spiralScore).toBeGreaterThan(0);
    expect(latest.outputs.recoveryPath).toBe("SPIRAL");
    expect(latest.outputs.reasons).toContain("SPIRAL_ACTIVE");
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

  test("spiral decays below threshold and recovery path returns UNKNOWN", () => {
    const seededState = {
      ...createPostClarityState(),
      postModeUntilSeconds: 2000,
      spiralScore: 0.9,
    };
    const decayed = updatePostClarityState(seededState, {
      collapseEvent: false,
      collapseDirection: "NONE",
      escalationLevel: 0,
      escalationScore: 0,
      pressure: 0,
      pressureSlope: 0,
      valence: 0.5,
      deltaMessageSeconds: 600,
      repetitionScore: 0,
      gain: 1,
    });

    expect(decayed.state.spiralScore).toBeLessThan(SPIRAL_THRESHOLD);
    expect(decayed.state.postModeUntilSeconds).toBeGreaterThan(0);
    expect(decayed.outputs.recoveryPath).toBe("UNKNOWN");
  });

  test("spiral is only active while post mode is active", () => {
    const seededState = {
      ...createPostClarityState(),
      postModeUntilSeconds: 0,
      spiralScore: 0.95,
    };
    const result = updatePostClarityState(seededState, {
      collapseEvent: false,
      collapseDirection: "NONE",
      escalationLevel: 0,
      escalationScore: 0,
      pressure: 0,
      pressureSlope: 0.1,
      valence: 0,
      deltaMessageSeconds: 0,
      repetitionScore: 1,
      gain: 2,
    });

    expect(result.state.spiralScore).toBeGreaterThanOrEqual(SPIRAL_THRESHOLD);
    expect(result.state.postModeUntilSeconds).toBe(0);
    expect(result.outputs.recoveryPath).toBe("UNKNOWN");
  });

  test("finite guards: NaN repetition and gain keep state finite", () => {
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
      repetitionScore: Number.NaN,
      gain: Number.NaN,
    });

    expect(Number.isFinite(result.outputs.agencyDeficit)).toBe(true);
    expect(Number.isFinite(result.state.agencyDeficit)).toBe(true);
    expect(Number.isFinite(result.state.postModeUntilSeconds)).toBe(true);
    expect(Number.isFinite(result.state.cooldownSeconds)).toBe(true);
    expect(Number.isFinite(result.state.relapseCount)).toBe(true);
    expect(Number.isFinite(result.state.n)).toBe(true);
    expect(Number.isFinite(result.state.spiralScore)).toBe(true);
    expect(result.outputs.recoveryPath).toBe("UNKNOWN");
  });
});
