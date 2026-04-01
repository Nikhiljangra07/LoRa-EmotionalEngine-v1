let _nowFn: () => number = () => Date.now();

export function setNowProvider(fn: () => number): void {
  _nowFn = fn;
}

export function resetNowProvider(): void {
  _nowFn = () => Date.now();
}

export function now(): number {
  return _nowFn();
}

export function todayISO(): string {
  return new Date(now()).toISOString().slice(0, 10);
}

export function todayFormatted(): string {
  const d = new Date(now());
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** Current time in UTC (e.g. "2:35 PM UTC") — no server timezone leak */
export function currentTimeFormatted(): string {
  const d = new Date(now());
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC',
  }) + ' UTC';
}

/** Day of week in UTC (e.g. "Tuesday") */
export function currentDayOfWeek(): string {
  return new Date(now()).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
}
