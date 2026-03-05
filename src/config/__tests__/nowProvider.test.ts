import { setNowProvider, resetNowProvider, now, todayISO, todayFormatted } from '../nowProvider';

afterEach(() => {
  resetNowProvider();
});

describe('nowProvider', () => {
  it('defaults to real clock', () => {
    const before = Date.now();
    const result = now();
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });

  it('can be overridden for testing', () => {
    const fixedMs = new Date('2026-03-05T12:00:00Z').getTime();
    setNowProvider(() => fixedMs);
    expect(now()).toBe(fixedMs);
    expect(todayISO()).toBe('2026-03-05');
  });

  it('todayFormatted matches mocked date', () => {
    const fixedMs = new Date('2026-03-05T12:00:00Z').getTime();
    setNowProvider(() => fixedMs);
    expect(todayFormatted()).toContain('March');
    expect(todayFormatted()).toContain('5');
    expect(todayFormatted()).toContain('2026');
  });

  it('resetNowProvider restores default', () => {
    setNowProvider(() => 0);
    expect(todayISO()).toBe('1970-01-01');
    resetNowProvider();
    const result = todayISO();
    expect(result).not.toBe('1970-01-01');
  });

  it('date math: days until March 13, 2026 from March 5', () => {
    const mar5 = new Date('2026-03-05T00:00:00Z').getTime();
    const mar13 = new Date('2026-03-13T00:00:00Z').getTime();
    setNowProvider(() => mar5);

    const diffMs = mar13 - now();
    const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
    expect(diffDays).toBe(8);
  });
});
