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
  });
}
