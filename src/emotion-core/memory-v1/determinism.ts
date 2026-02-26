export function deterministicSort<T>(items: T[], key: keyof T): T[] {
  const indexed = items.map((item, i) => ({ item, i }));
  indexed.sort((a, b) => {
    const va = a.item[key];
    const vb = b.item[key];
    if (va < vb) return -1;
    if (va > vb) return 1;
    return a.i - b.i;
  });
  return indexed.map((e) => e.item);
}

export function roundForSerialization(vec: number[], decimals: number): number[] {
  return vec.map((v) => Number(v.toFixed(decimals)));
}
