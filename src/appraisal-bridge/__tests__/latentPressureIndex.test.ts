import { LatentPressureTracker, computeRawLPI, LPI_THRESHOLD } from '../latentPressureIndex';
import type { LPIInput } from '../latentPressureIndex';

function makeInput(overrides: Partial<LPIInput> = {}): LPIInput {
  return {
    messageText: '',
    valenceScore: 0,
    valenceConfidence: 0.5,
    arousalScore: 0.5,
    recentVolatilities: [],
    ...overrides,
  };
}

describe('computeRawLPI', () => {
  test('returns 0 for neutral message', () => {
    const raw = computeRawLPI(makeInput());
    expect(raw).toBe(0);
  });

  test('detects minimizing phrases', () => {
    const raw = computeRawLPI(makeInput({ messageText: "It's fine. Whatever." }));
    expect(raw).toBeGreaterThan(0);
  });

  test('detects low arousal + negative valence', () => {
    const raw = computeRawLPI(makeInput({
      valenceScore: -0.4,
      valenceConfidence: 0.7,
      arousalScore: 0.2,
    }));
    expect(raw).toBeGreaterThan(0.3);
  });

  test('detects volatility drift', () => {
    const raw = computeRawLPI(makeInput({
      recentVolatilities: [0.1, 0.3, 0.6],
    }));
    expect(raw).toBeGreaterThan(0);
  });

  test('caps at 1.0', () => {
    const raw = computeRawLPI(makeInput({
      messageText: "It's fine. Whatever. Doesn't matter. Just tired. It's okay.",
      valenceScore: -0.8,
      valenceConfidence: 0.9,
      arousalScore: 0.1,
      recentVolatilities: [0.0, 0.5, 1.0],
    }));
    expect(raw).toBeLessThanOrEqual(1);
  });
});

describe('LatentPressureTracker', () => {
  let tracker: LatentPressureTracker;

  beforeEach(() => {
    tracker = new LatentPressureTracker();
  });

  test('first step returns raw as smoothed', () => {
    const result = tracker.step(
      makeInput({ messageText: 'whatever', valenceScore: -0.3, valenceConfidence: 0.7, arousalScore: 0.2 }),
      0,
    );
    expect(result.smoothed).toBeCloseTo(result.raw, 4);
  });

  test('smoothed value converges with EMA', () => {
    tracker.step(makeInput({ messageText: 'whatever', valenceScore: -0.3, valenceConfidence: 0.6, arousalScore: 0.2 }), 0);
    tracker.step(makeInput({ messageText: 'fine', valenceScore: -0.2, valenceConfidence: 0.5, arousalScore: 0.25 }), 0);
    const r3 = tracker.step(makeInput({ messageText: '' }), 0);
    expect(r3.smoothed).toBeGreaterThan(0);
    expect(r3.smoothed).toBeLessThan(r3.raw || 1);
  });

  test('maskedPressure triggers when smoothed > threshold and escalation < 1', () => {
    for (let i = 0; i < 5; i++) {
      tracker.step(
        makeInput({
          messageText: "It's fine. Whatever. Doesn't matter.",
          valenceScore: -0.5,
          valenceConfidence: 0.8,
          arousalScore: 0.15,
          recentVolatilities: [0.1, 0.3, 0.5],
        }),
        0,
      );
    }
    const result = tracker.step(
      makeInput({
        messageText: "It's fine. Whatever.",
        valenceScore: -0.5,
        valenceConfidence: 0.8,
        arousalScore: 0.15,
      }),
      0,
    );
    expect(result.smoothed).toBeGreaterThan(LPI_THRESHOLD);
    expect(result.maskedPressure).toBe(true);
  });

  test('maskedPressure does NOT trigger when escalation >= 1', () => {
    for (let i = 0; i < 5; i++) {
      tracker.step(
        makeInput({
          messageText: "It's fine. Whatever. Doesn't matter.",
          valenceScore: -0.5,
          valenceConfidence: 0.8,
          arousalScore: 0.15,
        }),
        1,
      );
    }
    const result = tracker.step(
      makeInput({
        messageText: "It's fine. Whatever.",
        valenceScore: -0.5,
        valenceConfidence: 0.8,
        arousalScore: 0.15,
      }),
      1,
    );
    expect(result.maskedPressure).toBe(false);
  });

  test('reset clears smoothed state', () => {
    tracker.step(makeInput({ messageText: 'whatever', valenceScore: -0.5, valenceConfidence: 0.8, arousalScore: 0.2 }), 0);
    tracker.reset();
    expect(tracker.currentSmoothed).toBe(0);
  });
});
