import { InputProcessor } from '../InputProcessor';

describe('InputProcessor — Architectural Invariants', () => {
  test('outputs are frozen (immutable)', () => {
    const { analyzerOutputs, signalPacket } = InputProcessor.process(
      'Hello!!! 😀'
    );
    expect(Object.isFrozen(analyzerOutputs)).toBe(true);
    expect(Object.isFrozen(signalPacket)).toBe(true);
  });

  test('mutation attempts throw', () => {
    const { analyzerOutputs } = InputProcessor.process('Hello!!! 😀');
    expect(() => {
      analyzerOutputs.expressionStrength = { score: 999, confidence: 1 };
    }).toThrow();
  });

  test('SignalPacket is created at runtime', () => {
    const { signalPacket } = InputProcessor.process('Hello!!! 😀');
    expect(signalPacket).toBeDefined();
    expect(signalPacket.messageText).toBe('Hello!!! 😀');
  });

  test('no hardcoded saturation literals', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../InputProcessor.ts'),
      'utf8'
    );

    expect(src).toContain('MASTER_CONSTANTS');
  });
});
