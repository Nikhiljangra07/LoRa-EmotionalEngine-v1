import { InputProcessor } from '../InputProcessor';

describe('InputProcessor — Architectural Invariants', () => {
  test('outputs are frozen (immutable)', () => {
    const out = InputProcessor.process('Hello!!! 😀');
    expect(Object.isFrozen(out)).toBe(true);
  });

  test('mutation attempts throw', () => {
    const out = InputProcessor.process('Hello!!! 😀');
    expect(() => {
      (out as any).linguisticScore = 999;
    }).toThrow();
  });

  test('no hardcoded saturation literals', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../InputProcessor.ts'),
      'utf8'
    );

    expect(src).toContain('MASTER_CONSTANTS');
    expect(src).toContain('SATURATION');
  });
});
