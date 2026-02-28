import { VolatilityDirectionTracker, DIRECTION_THRESHOLD } from '../volatilityDirection';

describe('VolatilityDirectionTracker', () => {
  let tracker: VolatilityDirectionTracker;

  beforeEach(() => {
    tracker = new VolatilityDirectionTracker();
  });

  test('first step returns STABLE (no previous)', () => {
    const result = tracker.step(0.15);
    expect(result.trend).toBe('STABLE');
    expect(result.delta).toBe(0);
  });

  test('rising AVI produces RISING trend', () => {
    tracker.step(0.1);
    const result = tracker.step(0.2);
    expect(result.trend).toBe('RISING');
    expect(result.delta).toBeCloseTo(0.1, 4);
  });

  test('falling AVI produces FALLING trend', () => {
    tracker.step(0.3);
    const result = tracker.step(0.1);
    expect(result.trend).toBe('FALLING');
    expect(result.delta).toBeCloseTo(-0.2, 4);
  });

  test('small change within threshold produces STABLE', () => {
    tracker.step(0.1);
    const result = tracker.step(0.1 + DIRECTION_THRESHOLD * 0.5);
    expect(result.trend).toBe('STABLE');
  });

  test('exact threshold boundary is STABLE', () => {
    tracker.step(0.0);
    const result = tracker.step(DIRECTION_THRESHOLD);
    expect(result.trend).toBe('STABLE');
  });

  test('just over threshold is RISING', () => {
    tracker.step(0.1);
    const result = tracker.step(0.1 + DIRECTION_THRESHOLD + 0.001);
    expect(result.trend).toBe('RISING');
  });

  test('reset clears previous AVI', () => {
    tracker.step(0.5);
    tracker.reset();
    const result = tracker.step(0.1);
    expect(result.trend).toBe('STABLE');
    expect(result.previous).toBe(0.1);
  });

  test('tracks multi-step sequence correctly', () => {
    tracker.step(0.1);
    expect(tracker.step(0.3).trend).toBe('RISING');
    expect(tracker.step(0.3).trend).toBe('STABLE');
    expect(tracker.step(0.1).trend).toBe('FALLING');
    expect(tracker.step(0.11).trend).toBe('STABLE');
  });
});
