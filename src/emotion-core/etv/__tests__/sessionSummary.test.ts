import { buildSessionSummary } from '../sessionSummary';

describe('buildSessionSummary', () => {
  const base = {
    sessionId: 'sess-1',
    userId: 'u1',
    startedAt: 1000,
    endedAt: 2000,
    messageCount: 5,
    hasViolation: false,
  };

  test('computes correct means and maxes from buffers', () => {
    const s = buildSessionSummary({
      ...base,
      eivBuffer: [0.2, 0.4, 0.6, 0.8],
      aviBuffer: [0.1, 0.3, 0.5],
    });
    expect(s.eivMean).toBeCloseTo(0.5, 8);
    expect(s.eivMax).toBe(0.8);
    expect(s.aviMean).toBeCloseTo(0.3, 8);
    expect(s.aviMax).toBe(0.5);
  });

  test('empty EIV buffer → eivMean=0, eivMax=0', () => {
    const s = buildSessionSummary({
      ...base,
      eivBuffer: [],
      aviBuffer: [0.1],
    });
    expect(s.eivMean).toBe(0);
    expect(s.eivMax).toBe(0);
  });

  test('empty AVI buffer → aviMean=0, aviMax=0', () => {
    const s = buildSessionSummary({
      ...base,
      eivBuffer: [0.5],
      aviBuffer: [],
    });
    expect(s.aviMean).toBe(0);
    expect(s.aviMax).toBe(0);
  });

  test('both buffers empty → all zeros', () => {
    const s = buildSessionSummary({
      ...base,
      eivBuffer: [],
      aviBuffer: [],
    });
    expect(s.eivMean).toBe(0);
    expect(s.eivMax).toBe(0);
    expect(s.aviMean).toBe(0);
    expect(s.aviMax).toBe(0);
  });

  test('single-element buffers', () => {
    const s = buildSessionSummary({
      ...base,
      eivBuffer: [0.75],
      aviBuffer: [0.33],
    });
    expect(s.eivMean).toBe(0.75);
    expect(s.eivMax).toBe(0.75);
    expect(s.aviMean).toBe(0.33);
    expect(s.aviMax).toBe(0.33);
  });

  test('passes through scalar fields unchanged', () => {
    const s = buildSessionSummary({
      ...base,
      eivBuffer: [0.5],
      aviBuffer: [0.1],
    });
    expect(s.sessionId).toBe('sess-1');
    expect(s.userId).toBe('u1');
    expect(s.startedAt).toBe(1000);
    expect(s.endedAt).toBe(2000);
    expect(s.messageCount).toBe(5);
    expect(s.hasViolation).toBe(false);
  });

  test('hasViolation=true propagates', () => {
    const s = buildSessionSummary({
      ...base,
      hasViolation: true,
      eivBuffer: [0.5],
      aviBuffer: [0.1],
    });
    expect(s.hasViolation).toBe(true);
  });
});
