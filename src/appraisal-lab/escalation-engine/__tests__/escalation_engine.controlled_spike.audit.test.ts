import {
  MIN_WARMUP,
  createEscalationState,
  updateEscalationState,
} from "..";
import { EscalationLevel } from "../types";

type AuditRow = {
  slope: number;
  volatility: number;
  isShock: boolean;
  gain: number;
  deltaMessageSeconds: number;
};

function runRow(
  state: ReturnType<typeof createEscalationState>,
  row: AuditRow
) {
  return updateEscalationState(state, {
    slope: row.slope,
    volatility: row.volatility,
    isShock: row.isShock,
    gain: row.gain,
    deltaMessageSeconds: row.deltaMessageSeconds,
  });
}

describe("controlled spike replay audit", () => {
  test("baseline calm, controlled shock, and true critical replay", () => {
    // Scenario A: Baseline calm
    let state = createEscalationState();
    let maxBaselineScore = 0;
    for (let i = 0; i < 40; i += 1) {
      const out = runRow(state, {
        slope: 0.01,
        volatility: 0.01,
        isShock: false,
        gain: 1,
        deltaMessageSeconds: 90,
      });
      state = out.state;
      expect(Number.isFinite(out.outputs.score)).toBe(true);
      maxBaselineScore = Math.max(maxBaselineScore, out.outputs.score);
    }
    const baselineFinalLevel = state.level;
    expect(baselineFinalLevel).toBe(EscalationLevel.CALM);
    expect(maxBaselineScore).toBeLessThan(0.3);

    // Scenario B: Single shock, modest stats
    state = createEscalationState();
    for (let i = 0; i < MIN_WARMUP + 20; i += 1) {
      const slopeCycle = [0.049, 0.05, 0.051];
      state = runRow(state, {
        slope: slopeCycle[i % slopeCycle.length],
        volatility: 0.01,
        isShock: false,
        gain: 1,
        deltaMessageSeconds: 90,
      }).state;
    }

    const controlledShock = runRow(state, {
      slope: 0.05,
      volatility: 0.01,
      isShock: true,
      gain: 1,
      deltaMessageSeconds: 90,
    });
    expect(controlledShock.outputs.reasons).toContain("SHOCK");
    expect(controlledShock.outputs.score).toBeLessThan(0.98);
    expect(controlledShock.outputs.level).not.toBe(EscalationLevel.CRITICAL);
    const controlledShockMax = controlledShock.outputs.score;
    const hitCriticalControlled =
      controlledShock.outputs.level === EscalationLevel.CRITICAL;

    // Scenario C: True critical
    state = createEscalationState();
    for (let i = 0; i < MIN_WARMUP + 10; i += 1) {
      state = runRow(state, {
        slope: 0.01,
        volatility: 0.01,
        isShock: false,
        gain: 1,
        deltaMessageSeconds: 90,
      }).state;
    }

    let maxTrueCriticalScore = 0;
    const burstRows: AuditRow[] = [
      { slope: 10, volatility: 10, isShock: true, gain: 1, deltaMessageSeconds: 2 },
      { slope: 10, volatility: 10, isShock: false, gain: 1, deltaMessageSeconds: 2 },
      { slope: 10, volatility: 10, isShock: false, gain: 1, deltaMessageSeconds: 2 },
    ];

    for (const row of burstRows) {
      const out = runRow(state, row);
      state = out.state;
      maxTrueCriticalScore = Math.max(maxTrueCriticalScore, out.outputs.score);
      expect(Number.isFinite(out.outputs.score)).toBe(true);
    }
    const trueCriticalSaturated = maxTrueCriticalScore >= 0.99;
    expect(trueCriticalSaturated).toBe(true);

    const report = {
      baseline: { finalLevel: baselineFinalLevel, maxScore: maxBaselineScore },
      controlledShock: {
        maxScore: controlledShockMax,
        hitCritical: hitCriticalControlled,
      },
      trueCritical: {
        maxScore: maxTrueCriticalScore,
        saturated: trueCriticalSaturated,
      },
    };

    console.log(JSON.stringify(report));
  });
});
