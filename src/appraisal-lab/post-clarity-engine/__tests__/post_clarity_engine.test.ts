import { createPostClarityState, updatePostClarityState } from "..";
import {
  SPIRAL_THRESHOLD,
  SUBSTITUTE_MUTEX_MARGIN,
  SUBSTITUTE_THRESHOLD,
} from "../constants";

describe("post-clarity-engine", () => {
  test("A) substitute stays off when calm and post mode is inactive", () => {
    const seededState = {
      ...createPostClarityState(),
      postModeUntilSeconds: 0,
    };
    const result = updatePostClarityState(seededState, {
      collapseEvent: false,
      collapseDirection: "NONE",
      escalationLevel: 1,
      escalationScore: 0.1,
      pressure: 0.5,
      pressureSlope: -0.01,
      valence: 0.2,
      deltaMessageSeconds: 10,
      repetitionScore: 0,
      gain: 1,
      validationSeekingScore: 1,
      topicShiftScore: 1,
      positiveReframeScore: 0.7,
    });

    expect(result.state.postModeUntilSeconds).toBe(0);
    expect(result.state.spiralScore).toBeGreaterThanOrEqual(0);
    expect(result.state.substituteScore).toBeGreaterThan(0);
    expect(result.outputs.recoveryPath).toBe("UNKNOWN");
  });

  test("B) substitute triggers in post mode under sustained seek/shift evidence", () => {
    let state = createPostClarityState();
    const entered = updatePostClarityState(state, {
      collapseEvent: true,
      collapseDirection: "OUTWARD",
      escalationLevel: 0,
      escalationScore: 0,
      pressure: 0,
      pressureSlope: 0,
      valence: 0,
      deltaMessageSeconds: 1,
      repetitionScore: 0,
      gain: 1,
    });
    state = entered.state;

    let latest = entered;
    for (let i = 0; i < 4; i += 1) {
      latest = updatePostClarityState(state, {
        collapseEvent: false,
        collapseDirection: "NONE",
        escalationLevel: 0,
        escalationScore: 0,
        pressure: 0,
        pressureSlope: 0,
        valence: 0.2,
        deltaMessageSeconds: 10,
        repetitionScore: 0,
        gain: 1,
        validationSeekingScore: 0.95,
        topicShiftScore: 0.9,
        positiveReframeScore: 0.3,
      });
      state = latest.state;
      if (latest.outputs.recoveryPath === "SUBSTITUTE") {
        break;
      }
    }

    expect(latest.outputs.postModeActive).toBe(true);
    expect(latest.state.substituteScore).toBeGreaterThanOrEqual(SUBSTITUTE_THRESHOLD);
    expect(latest.outputs.recoveryPath).toBe("SUBSTITUTE");
    expect(latest.outputs.reasons).toContain("SUBSTITUTE_ACTIVE");
  });

  test("C) spiral beats substitute when stronger by mutex margin", () => {
    const seededState = {
      ...createPostClarityState(),
      postModeUntilSeconds: 1200,
      spiralScore: 0.9,
      substituteScore: 0.9 - SUBSTITUTE_MUTEX_MARGIN - 0.01,
    };

    const result = updatePostClarityState(seededState, {
      collapseEvent: false,
      collapseDirection: "NONE",
      escalationLevel: 0,
      escalationScore: 0,
      pressure: 0,
      pressureSlope: 0,
      valence: 0,
      deltaMessageSeconds: 0,
      repetitionScore: 0,
      gain: 1,
      validationSeekingScore: 0,
      topicShiftScore: 0,
      positiveReframeScore: 0,
    });

    expect(result.state.spiralScore).toBeGreaterThanOrEqual(SPIRAL_THRESHOLD);
    expect(result.state.substituteScore).toBeGreaterThanOrEqual(SUBSTITUTE_THRESHOLD);
    expect(result.outputs.recoveryPath).toBe("SPIRAL");
    expect(result.outputs.reasons).toContain("SPIRAL_ACTIVE");
  });

  test("D) tie ambiguity returns UNKNOWN with RECOVERY_AMBIGUOUS reason", () => {
    const seededState = {
      ...createPostClarityState(),
      postModeUntilSeconds: 1500,
      spiralScore: 0.74,
      substituteScore: 0.69,
    };
    const result = updatePostClarityState(seededState, {
      collapseEvent: false,
      collapseDirection: "NONE",
      escalationLevel: 0,
      escalationScore: 0,
      pressure: 0,
      pressureSlope: 0,
      valence: 0,
      deltaMessageSeconds: 0,
      repetitionScore: 0,
      gain: 1,
      validationSeekingScore: 0,
      topicShiftScore: 0,
      positiveReframeScore: 0,
    });

    expect(result.state.spiralScore).toBeGreaterThanOrEqual(SPIRAL_THRESHOLD);
    expect(result.state.substituteScore).toBeGreaterThanOrEqual(SUBSTITUTE_THRESHOLD);
    expect(result.outputs.recoveryPath).toBe("UNKNOWN");
    expect(result.outputs.reasons).toContain("RECOVERY_AMBIGUOUS");
  });

  test("E) substitute decays below threshold and path returns UNKNOWN", () => {
    const seededState = {
      ...createPostClarityState(),
      postModeUntilSeconds: 2000,
      substituteScore: 0.9,
    };
    const decayed = updatePostClarityState(seededState, {
      collapseEvent: false,
      collapseDirection: "NONE",
      escalationLevel: 0,
      escalationScore: 0,
      pressure: 0,
      pressureSlope: 0,
      valence: 0,
      deltaMessageSeconds: 1200,
      repetitionScore: 0,
      gain: 1,
      validationSeekingScore: 0,
      topicShiftScore: 0,
      positiveReframeScore: 0,
    });

    expect(decayed.state.postModeUntilSeconds).toBeGreaterThan(0);
    expect(decayed.state.substituteScore).toBeLessThan(SUBSTITUTE_THRESHOLD);
    expect(decayed.outputs.recoveryPath).toBe("UNKNOWN");
  });

  test("F) natural spiral activation from repetition + rising pressure", () => {
    let state = createPostClarityState();
    const entered = updatePostClarityState(state, {
      collapseEvent: true,
      collapseDirection: "OUTWARD",
      escalationLevel: 0,
      escalationScore: 0,
      pressure: 0,
      pressureSlope: 0,
      valence: 0,
      deltaMessageSeconds: 1,
      gain: 1,
    });
    state = entered.state;

    let latest = entered;
    for (let i = 0; i < 6; i += 1) {
      latest = updatePostClarityState(state, {
        collapseEvent: false,
        collapseDirection: "NONE",
        escalationLevel: 2,
        escalationScore: 0.6,
        pressure: 10,
        pressureSlope: 0.15,
        valence: -0.2,
        deltaMessageSeconds: 5,
        repetitionScore: 0.95,
        gain: 1,
        validationSeekingScore: 0,
        topicShiftScore: 0,
        positiveReframeScore: 0,
      });
      state = latest.state;
      if (latest.state.spiralScore >= SPIRAL_THRESHOLD) {
        break;
      }
    }

    expect(latest.state.spiralScore).toBeGreaterThanOrEqual(SPIRAL_THRESHOLD);
    expect(latest.outputs.recoveryPath).toBe("SPIRAL");
    expect(latest.outputs.reasons).toContain("SPIRAL_ACTIVE");
    expect(
      latest.state.substituteScore < latest.state.spiralScore ||
        latest.state.spiralScore >=
          latest.state.substituteScore + SUBSTITUTE_MUTEX_MARGIN
    ).toBe(true);
  });

  test("G) spiral decays below threshold with long delta", () => {
    const seededState = {
      ...createPostClarityState(),
      postModeUntilSeconds: 2000,
      spiralScore: 0.9,
    };

    const result = updatePostClarityState(seededState, {
      collapseEvent: false,
      collapseDirection: "NONE",
      escalationLevel: 0,
      escalationScore: 0,
      pressure: 0,
      pressureSlope: 0,
      valence: 0,
      deltaMessageSeconds: 1200,
      repetitionScore: 0,
      gain: 1,
    });

    expect(result.state.spiralScore).toBeLessThan(SPIRAL_THRESHOLD);
    expect(result.outputs.recoveryPath).toBe("UNKNOWN");
  });

  test("H) postMode expiry fully disables substitute activation", () => {
    const seededState = {
      ...createPostClarityState(),
      postModeUntilSeconds: 1,
      substituteScore: 0.9,
    };

    const result = updatePostClarityState(seededState, {
      collapseEvent: false,
      collapseDirection: "NONE",
      escalationLevel: 0,
      escalationScore: 0,
      pressure: 0,
      pressureSlope: 0,
      valence: 0,
      deltaMessageSeconds: 10,
      repetitionScore: 0,
      gain: 1,
      validationSeekingScore: 1,
      topicShiftScore: 1,
      positiveReframeScore: 1,
    });

    expect(result.state.postModeUntilSeconds).toBe(0);
    expect(result.outputs.postModeActive).toBe(false);
    expect(result.outputs.recoveryPath).toBe("UNKNOWN");
  });

  test("finite guards: NaN substitute inputs keep state finite", () => {
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
      validationSeekingScore: Number.NaN,
      topicShiftScore: Number.NaN,
      positiveReframeScore: Number.NaN,
    });

    expect(Number.isFinite(result.outputs.agencyDeficit)).toBe(true);
    expect(Number.isFinite(result.state.agencyDeficit)).toBe(true);
    expect(Number.isFinite(result.state.postModeUntilSeconds)).toBe(true);
    expect(Number.isFinite(result.state.cooldownSeconds)).toBe(true);
    expect(Number.isFinite(result.state.relapseCount)).toBe(true);
    expect(Number.isFinite(result.state.n)).toBe(true);
    expect(Number.isFinite(result.state.spiralScore)).toBe(true);
    expect(Number.isFinite(result.state.substituteScore)).toBe(true);
    expect(result.outputs.recoveryPath).toBe("UNKNOWN");
  });
});
