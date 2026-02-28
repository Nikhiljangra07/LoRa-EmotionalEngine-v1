import { GradientEscalationTracker } from '../gradientEscalation';

describe('GradientEscalationTracker', () => {
  let tracker: GradientEscalationTracker;

  beforeEach(() => {
    tracker = new GradientEscalationTracker();
  });

  test('starts at CALM', () => {
    expect(tracker.current).toBe('CALM');
  });

  test('LPI > 0.45 with level=0 promotes to TENSION on first step (with confirmation)', () => {
    const r1 = tracker.step(0, 0.5, 'STABLE');
    expect(r1.state).toBe('CALM');
    expect(r1.confirmedTurns).toBe(1);

    const r2 = tracker.step(0, 0.5, 'STABLE');
    expect(r2.state).toBe('TENSION');
    expect(r2.trend).toBe('UP');
  });

  test('LPI > 0.6 skips confirmation and escalates immediately', () => {
    const result = tracker.step(0, 0.65, 'STABLE');
    expect(result.state).toBe('TENSION');
    expect(result.trend).toBe('UP');
  });

  test('escalation level=2 maps to ESCALATED with confirmation', () => {
    tracker.step(2, 0, 'STABLE');
    const r2 = tracker.step(2, 0, 'STABLE');
    expect(r2.state).toBe('ESCALATED');
  });

  test('escalation level=3 maps to CRITICAL with confirmation', () => {
    tracker.step(3, 0, 'STABLE');
    const r2 = tracker.step(3, 0, 'STABLE');
    expect(r2.state).toBe('CRITICAL');
  });

  test('de-escalation requires 2 consecutive FALLING volatility turns', () => {
    tracker.step(2, 0.7, 'STABLE');
    expect(tracker.current).toBe('ESCALATED');

    tracker.step(0, 0, 'FALLING');
    expect(tracker.current).toBe('ESCALATED');

    tracker.step(0, 0, 'FALLING');
    expect(tracker.current).toBe('RISING');
  });

  test('de-escalation resets when volatility is not FALLING', () => {
    tracker.step(2, 0.7, 'STABLE');
    expect(tracker.current).toBe('ESCALATED');

    tracker.step(0, 0, 'FALLING');
    tracker.step(0, 0, 'RISING');
    tracker.step(0, 0, 'FALLING');
    expect(tracker.current).toBe('ESCALATED');
  });

  test('trend is FLAT when state does not change', () => {
    const r1 = tracker.step(0, 0, 'STABLE');
    expect(r1.trend).toBe('FLAT');
    const r2 = tracker.step(0, 0, 'STABLE');
    expect(r2.trend).toBe('FLAT');
  });

  test('trend is DOWN on de-escalation', () => {
    tracker.step(2, 0.7, 'STABLE');
    tracker.step(0, 0, 'FALLING');
    const result = tracker.step(0, 0, 'FALLING');
    expect(result.trend).toBe('DOWN');
  });

  test('numericLevel maps correctly', () => {
    expect(tracker.step(0, 0, 'STABLE').numericLevel).toBe(0);
    tracker.step(1, 0.7, 'STABLE');
    expect(tracker.current).toBe('RISING');
    expect(tracker.step(1, 0, 'STABLE').numericLevel).toBe(2);
  });

  test('reset returns to CALM', () => {
    tracker.step(2, 0.7, 'STABLE');
    tracker.reset();
    expect(tracker.current).toBe('CALM');
    const result = tracker.step(0, 0, 'STABLE');
    expect(result.state).toBe('CALM');
    expect(result.trend).toBe('FLAT');
  });

  test('multi-step gradient sequence', () => {
    const r1 = tracker.step(0, 0.5, 'STABLE');
    expect(r1.state).toBe('CALM');

    const r2 = tracker.step(0, 0.5, 'STABLE');
    expect(r2.state).toBe('TENSION');

    const r3 = tracker.step(1, 0, 'RISING');
    expect(r3.state).toBe('TENSION');

    const r4 = tracker.step(1, 0, 'RISING');
    expect(r4.state).toBe('RISING');

    const r5 = tracker.step(0, 0, 'FALLING');
    expect(r5.state).toBe('RISING');

    const r6 = tracker.step(0, 0, 'FALLING');
    expect(r6.state).toBe('TENSION');
    expect(r6.trend).toBe('DOWN');
  });
});
