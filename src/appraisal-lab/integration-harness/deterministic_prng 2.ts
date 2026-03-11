export type DeterministicPrng = {
  nextUint32: () => number;
  nextFloat01: () => number;
};

export function createPrng(seed: number): DeterministicPrng {
  let state = seed >>> 0;

  function nextUint32(): number {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state;
  }

  function nextFloat01(): number {
    return nextUint32() / 0x100000000;
  }

  return {
    nextUint32,
    nextFloat01,
  };
}
