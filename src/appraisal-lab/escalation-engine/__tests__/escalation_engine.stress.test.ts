import { createEscalationState, updateEscalationState } from "..";
import { EscalationLevel } from "../types";

function lcgNext(seed: number): number {
  return (seed * 48271) % 2147483647;
}

describe("escalation-engine stress", () => {
  test("30-day deterministic simulation stays stable", () => {
    let state = createEscalationState();
    let seed = 135791357;
    let saturatedCount = 0;

    for (let i = 0; i < 259200; i += 1) {
      seed = lcgNext(seed);
      const unit = seed / 2147483647;
      const slope = (unit - 0.4) * 12;
      const volatility = ((i % 17) * 0.07 + unit * 0.3) * 10;
      const isShock = i % 101 === 0;

      const result = updateEscalationState(state, {
        slope,
        volatility,
        isShock,
      });
      state = result.state;
      if (result.outputs.score === 1) {
        saturatedCount += 1;
      }

      if (i % 1000 === 0) {
        if (!Number.isFinite(result.outputs.r)) {
          throw new Error("r must be finite");
        }
        if (!Number.isFinite(result.outputs.score)) {
          throw new Error("score must be finite");
        }
        if (result.outputs.score < 0 || result.outputs.score > 1) {
          throw new Error("score must stay in [0, 1]");
        }
        if (
          ![
            EscalationLevel.CALM,
            EscalationLevel.RISING,
            EscalationLevel.ESCALATED,
            EscalationLevel.CRITICAL,
          ].includes(result.outputs.level)
        ) {
          throw new Error("invalid escalation level");
        }
      }
    }

    const saturationRate = saturatedCount / 259200;
    expect(saturationRate).toBeLessThanOrEqual(0.01);
  });

  test("extreme values and MAD collapse remain finite", () => {
    let state = createEscalationState();

    // MAD collapse setup: repeated identical values.
    for (let i = 0; i < 50; i += 1) {
      state = updateEscalationState(state, {
        slope: 0,
        volatility: 0,
        isShock: false,
      }).state;
    }

    const extremeInputs = [
      { slope: 1e12, volatility: 1e12, isShock: true },
      { slope: -1e12, volatility: -1e12, isShock: false },
      { slope: 1e-12, volatility: 1e-12, isShock: false },
      { slope: -1e-12, volatility: -1e-12, isShock: true },
    ];

    for (const input of extremeInputs) {
      const result = updateEscalationState(state, input);
      state = result.state;
      expect(Number.isFinite(result.outputs.r)).toBe(true);
      expect(Number.isFinite(result.outputs.score)).toBe(true);
      expect(result.outputs.score).toBeGreaterThanOrEqual(0);
      expect(result.outputs.score).toBeLessThanOrEqual(1);
    }
  });

  test("determinism: same sequence produces identical outputs", () => {
    const sequence = [];
    let seed = 975319753;
    for (let i = 0; i < 2000; i += 1) {
      seed = lcgNext(seed);
      const unit = seed / 2147483647;
      sequence.push({
        slope: (unit - 0.5) * 15,
        volatility: ((i % 11) * 0.1 + unit * 0.2) * 8,
        isShock: i % 37 === 0,
      });
    }

    let stateA = createEscalationState();
    let stateB = createEscalationState();
    const outA: Array<[EscalationLevel, number, number, string, boolean, boolean, boolean]> = [];
    const outB: Array<[EscalationLevel, number, number, string, boolean, boolean, boolean]> = [];

    for (const input of sequence) {
      const a = updateEscalationState(stateA, input);
      stateA = a.state;
      outA.push([
        a.outputs.level,
        a.outputs.r,
        a.outputs.score,
        a.outputs.reasons.join("|"),
        a.outputs.flags.warmedUp,
        a.outputs.flags.isFlapping,
        a.outputs.flags.enteredCritical,
      ]);
    }

    for (const input of sequence) {
      const b = updateEscalationState(stateB, input);
      stateB = b.state;
      outB.push([
        b.outputs.level,
        b.outputs.r,
        b.outputs.score,
        b.outputs.reasons.join("|"),
        b.outputs.flags.warmedUp,
        b.outputs.flags.isFlapping,
        b.outputs.flags.enteredCritical,
      ]);
    }

    expect(outA).toEqual(outB);
  });
});
