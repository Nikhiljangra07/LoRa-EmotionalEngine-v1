import {
  MIN_WARMUP,
  Z_CRIT,
  createEscalationState,
  updateEscalationState,
} from "..";
import { EscalationLevel } from "../types";

function step(
  state: ReturnType<typeof createEscalationState>,
  slope: number,
  volatility: number,
  isShock: boolean
) {
  return updateEscalationState(state, {
    slope,
    volatility,
    isShock,
  });
}

describe("escalation-engine scenarios", () => {
  test("warmup freeze", () => {
    let state = createEscalationState();
    for (let i = 0; i < MIN_WARMUP - 1; i += 1) {
      const result = step(state, 10, 10, true);
      state = result.state;
      expect(result.outputs.flags.warmedUp).toBe(false);
      expect(result.outputs.level).toBe(EscalationLevel.CALM);
      expect(result.outputs.r).toBe(0);
      expect(result.outputs.score).toBe(0);
      expect(result.outputs.reasons).toEqual([]);
    }
  });

  test("calm stable never escalates", () => {
    let state = createEscalationState();
    let outputs = step(state, 0, 0, false).outputs;

    for (let i = 0; i < 80; i += 1) {
      const result = step(state, 0.1, 0.1, false);
      state = result.state;
      outputs = result.outputs;
    }

    expect(outputs.level).toBe(EscalationLevel.CALM);
    expect(outputs.flags.enteredCritical).toBe(false);
  });

  test("gradual rise enters RISING only after persistence", () => {
    let state = createEscalationState();
    for (let i = 0; i < MIN_WARMUP; i += 1) {
      // Mildly varying baseline avoids MAD-floor singular jumps.
      state = step(state, i % 2 === 0 ? 0.1 : 0.2, 0.1, false).state;
    }

    const firstRise = step(state, 0.35, 0.1, false);
    state = firstRise.state;
    expect(firstRise.outputs.level).toBe(EscalationLevel.CALM);

    const secondRise = step(state, 0.4, 0.1, false);
    state = secondRise.state;
    expect(secondRise.outputs.level).toBe(EscalationLevel.CALM);

    const thirdRise = step(state, 0.5, 0.1, false);
    state = thirdRise.state;
    expect(thirdRise.outputs.level).toBe(EscalationLevel.CALM);

    const fourthRise = step(state, 0.6, 0.1, false);
    expect(fourthRise.outputs.level).toBe(EscalationLevel.RISING);
    expect(fourthRise.outputs.reasons).toContain("PERSISTENT");
  });

  test("volatility-only spike triggers RISING/ESCALATED depending on risk", () => {
    let state = createEscalationState();
    const baselineVol = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 5, 4, 6, 3];
    for (let i = 0; i < baselineVol.length; i += 1) {
      state = step(state, 0.1, baselineVol[i], false).state;
    }

    let third = step(state, 0.1, 8, false);
    state = third.state;
    const volatilityPattern = [9, 10, 11, 12, 13, 14, 15, 16, 18];
    for (const vol of volatilityPattern) {
      third = step(state, 0.1, vol, false);
      state = third.state;
    }

    expect(
      [EscalationLevel.RISING, EscalationLevel.ESCALATED].includes(
        third.outputs.level
      )
    ).toBe(true);
    expect(third.outputs.reasons).toContain("VOL_HIGH");
  });

  test("shock can jump to ESCALATED; CRITICAL only when r>=Z_CRIT", () => {
    let state = createEscalationState();
    for (let i = 0; i < MIN_WARMUP; i += 1) {
      state = step(state, 0, 0, false).state;
    }

    const shockStep = step(state, 0, 0, true);
    state = shockStep.state;
    expect(shockStep.outputs.level).toBe(EscalationLevel.ESCALATED);
    expect(shockStep.outputs.reasons).toContain("SHOCK");
    expect(shockStep.outputs.r).toBeLessThan(Z_CRIT);

    const criticalStep = step(state, 1000, 1000, true);
    expect(criticalStep.outputs.r).toBeGreaterThanOrEqual(Z_CRIT);
    expect(criticalStep.outputs.level).toBe(EscalationLevel.CRITICAL);
    expect(criticalStep.outputs.flags.enteredCritical).toBe(true);
  });

  test("recovery steps down gradually with no ping-pong", () => {
    let state = createEscalationState();
    for (let i = 0; i < MIN_WARMUP; i += 1) {
      state = step(state, 0, 0, false).state;
    }

    state = step(state, 500, 500, true).state;
    expect(state.level).toBe(EscalationLevel.CRITICAL);

    const levels: EscalationLevel[] = [];
    for (let i = 0; i < 20; i += 1) {
      const result = step(state, 0, 0, false);
      state = result.state;
      levels.push(result.outputs.level);
    }

    const firstEscalated = levels.indexOf(EscalationLevel.ESCALATED);
    const firstRising = levels.indexOf(EscalationLevel.RISING);
    const firstCalm = levels.indexOf(EscalationLevel.CALM);

    expect(firstEscalated).toBeGreaterThanOrEqual(0);
    expect(firstRising).toBeGreaterThan(firstEscalated);
    expect(firstCalm).toBeGreaterThan(firstRising);

    for (let i = 1; i < levels.length; i += 1) {
      const diff = Math.abs(levels[i] - levels[i - 1]);
      expect(diff).toBeLessThanOrEqual(1);
    }
  });
});
