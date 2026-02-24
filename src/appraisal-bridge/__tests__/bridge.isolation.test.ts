import { AppraisalBridgeRunner } from '../AppraisalBridgeRunner';
import { makeSnapshot } from './helpers';

const STEPS = 20;

function runHighIntensity(runner: AppraisalBridgeRunner) {
  const results = [];
  for (let i = 0; i < STEPS; i++) {
    results.push(
      runner.step(
        makeSnapshot({
          messageIndex: i,
          timestampMs: 1_000_000 + i * 1_000,
          deltaMessageSeconds: 1,
          valenceScore: -0.8,
          arousalScore: 0.9,
          expressionStrength: 0.9,
          eivValue: 0.9,
          capsRatio: 0.5,
          punctuationHits: 4,
          repetitionScore: 0.6,
        })
      )
    );
  }
  return results;
}

function runCalm(runner: AppraisalBridgeRunner) {
  const results = [];
  for (let i = 0; i < STEPS; i++) {
    results.push(
      runner.step(
        makeSnapshot({
          messageIndex: i,
          timestampMs: 1_000_000 + i * 10_000,
          deltaMessageSeconds: 10,
          valenceScore: 0.1,
          arousalScore: 0.2,
          expressionStrength: 0.15,
          eivValue: 0.1,
          capsRatio: 0.02,
          punctuationHits: 0,
          repetitionScore: 0.05,
        })
      )
    );
  }
  return results;
}

describe('AppraisalBridgeRunner — state isolation', () => {
  test('two runners with different inputs produce divergent outputs', () => {
    const runnerA = new AppraisalBridgeRunner();
    const runnerB = new AppraisalBridgeRunner();

    const resultsA = runHighIntensity(runnerA);
    const resultsB = runCalm(runnerB);

    const lastA = resultsA[STEPS - 1];
    const lastB = resultsB[STEPS - 1];

    expect(lastA.pressure.scalar).not.toBeCloseTo(lastB.pressure.scalar, 1);
  });

  test('new runner does not inherit state from previous runners', () => {
    const runnerA = new AppraisalBridgeRunner();
    runHighIntensity(runnerA);

    const runnerC = new AppraisalBridgeRunner();
    const calmResults = runCalm(runnerC);

    const runnerD = new AppraisalBridgeRunner();
    const freshCalmResults = runCalm(runnerD);

    expect(calmResults[0].pressure.scalar).toBe(
      freshCalmResults[0].pressure.scalar
    );
    expect(calmResults[STEPS - 1].pressure.scalar).toBe(
      freshCalmResults[STEPS - 1].pressure.scalar
    );
  });

  test('reset() restores runner to initial state', () => {
    const runner = new AppraisalBridgeRunner();
    const beforeHigh = runCalm(runner);

    runner.reset();
    const afterReset = runCalm(runner);

    expect(beforeHigh[0].pressure.scalar).toBe(afterReset[0].pressure.scalar);
    expect(beforeHigh[STEPS - 1].pressure.scalar).toBe(
      afterReset[STEPS - 1].pressure.scalar
    );
  });
});
