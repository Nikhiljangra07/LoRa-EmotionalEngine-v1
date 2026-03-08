import { createPostClarityState, updatePostClarityState } from "..";

function lcgNext(seed: number): number {
  return (seed * 48271) % 2147483647;
}

function runDeterministicSimulation(seedStart: number): {
  finalState: ReturnType<typeof createPostClarityState>;
  checksum: number;
  pathTrace: string;
} {
  let state = createPostClarityState();
  let seed = seedStart;
  let checksum = 0;
  let pathTrace = "";

  for (let i = 0; i < 50000; i += 1) {
    seed = lcgNext(seed);
    const r1 = seed / 2147483647;
    seed = lcgNext(seed);
    const r2 = seed / 2147483647;
    seed = lcgNext(seed);
    const r3 = seed / 2147483647;
    seed = lcgNext(seed);
    const r4 = seed / 2147483647;
    seed = lcgNext(seed);
    const r5 = seed / 2147483647;
    seed = lcgNext(seed);
    const r6 = seed / 2147483647;
    seed = lcgNext(seed);
    const r7 = seed / 2147483647;
    seed = lcgNext(seed);
    const r8 = seed / 2147483647;
    seed = lcgNext(seed);
    const r9 = seed / 2147483647;
    seed = lcgNext(seed);
    const r10 = seed / 2147483647;

    const result = updatePostClarityState(state, {
      collapseEvent: i % 97 === 0,
      collapseDirection: i % 2 === 0 ? "OUTWARD" : "INWARD",
      escalationLevel: Math.floor(r1 * 6) - 1, // intentionally outside range too
      escalationScore: r2 * 1.5 - 0.25, // includes values outside [0, 1]
      pressure: r3 * 20,
      pressureSlope: r4 * 0.5 - 0.2,
      valence: r5 * 2.4 - 1.2,
      deltaMessageSeconds: i % 10 === 0 ? 0 : (i % 13) + 0.25,
      repetitionScore: r6 * 1.4 - 0.2,
      gain: r7 * 2.5,
      validationSeekingScore: r8 * 1.5 - 0.25,
      topicShiftScore: r9 * 1.4 - 0.2,
      positiveReframeScore: r10 * 1.6 - 0.3,
    });
    state = result.state;

    expect(result.state.agencyDeficit).toBeGreaterThanOrEqual(0);
    expect(result.state.agencyDeficit).toBeLessThanOrEqual(1);
    expect(result.state.postModeUntilSeconds).toBeGreaterThanOrEqual(0);
    expect(result.state.spiralScore).toBeGreaterThanOrEqual(0);
    expect(result.state.spiralScore).toBeLessThanOrEqual(1);
    expect(result.state.substituteScore).toBeGreaterThanOrEqual(0);
    expect(result.state.substituteScore).toBeLessThanOrEqual(1);
    expect(Number.isFinite(result.state.agencyDeficit)).toBe(true);
    expect(Number.isFinite(result.state.postModeUntilSeconds)).toBe(true);
    expect(Number.isFinite(result.state.cooldownSeconds)).toBe(true);
    expect(Number.isFinite(result.state.spiralScore)).toBe(true);
    expect(Number.isFinite(result.state.substituteScore)).toBe(true);
    expect(Number.isFinite(result.outputs.agencyDeficit)).toBe(true);
    expect(["SPIRAL", "SUBSTITUTE", "UNKNOWN"]).toContain(
      result.outputs.recoveryPath
    );

    checksum += result.outputs.agencyDeficit * (i + 1);
    checksum += result.state.postModeUntilSeconds * 0.001;
    checksum += result.state.spiralScore * 0.01;
    checksum += result.state.substituteScore * 0.01;
    if (result.outputs.recoveryPath === "SPIRAL") {
      pathTrace += "S";
    } else if (result.outputs.recoveryPath === "SUBSTITUTE") {
      pathTrace += "T";
    } else {
      pathTrace += "U";
    }
  }

  return { finalState: state, checksum, pathTrace };
}

describe("post-clarity-engine stress", () => {
  test("50k deterministic loop preserves invariants and replay determinism", () => {
    const a = runDeterministicSimulation(123456789);
    const b = runDeterministicSimulation(123456789);

    expect(a.finalState).toEqual(b.finalState);
    expect(a.checksum).toBeCloseTo(b.checksum, 12);
    expect(a.pathTrace).toBe(b.pathTrace);
  });
});
