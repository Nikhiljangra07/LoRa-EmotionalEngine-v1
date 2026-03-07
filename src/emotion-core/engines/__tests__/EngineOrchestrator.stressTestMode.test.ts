/**
 * Regression tests for the stress-test-mode fallback gate.
 *
 * stressTestMode is a module-level constant in EngineOrchestrator, evaluated
 * once at import time. Tests that need it enabled MUST use jest.isolateModules
 * so the module is re-evaluated with the env var already set.
 */

import type { AnalyzerOutputs } from '../../processors/EIVComponentAssembler';
import type { EmotionalState } from '../../types/analysis.types';

const analyzerOutputs: AnalyzerOutputs = {
  expressionStrength: { score: 0.6, confidence: 0.7 },
  valence: { score: 0.1, confidence: 0.6 },
  arousal: { score: 0.5, confidence: 0.6 },
};

const emotionalState: EmotionalState = {
  dominant: 'NEUTRAL',
  arousal: 'MEDIUM',
  valence: 'NEUTRAL',
  confidence: 0.7,
};

const CANNED_FALLBACK_FRAGMENT = 'one step at a time';

function makeEngine(
  EngineOrchestrator: any,
  responder: () => Promise<string>,
  opts: { maxAttempts?: number; cooldownMs?: number } = {},
) {
  return new EngineOrchestrator(
    0.5,
    { maxAttempts: opts.maxAttempts ?? 1, cooldownMs: opts.cooldownMs ?? 500 },
    () => ({ generateResponse: responder }),
  );
}

describe('EngineOrchestrator — production mode (LORA_STRESS_TEST unset)', () => {
  let EngineOrchestrator: any;

  beforeAll(() => {
    delete process.env.LORA_STRESS_TEST;
  });

  beforeEach(() => {
    jest.resetModules();
  });

  function loadOrchestrator(): Promise<any> {
    return new Promise((resolve) => {
      jest.isolateModules(() => {
        const mod = require('../EngineOrchestrator');
        resolve(mod.EngineOrchestrator);
      });
    });
  }

  test('successful LLM call never returns fallback text', async () => {
    EngineOrchestrator = await loadOrchestrator();
    const engine = makeEngine(EngineOrchestrator, async () => 'Your deployment is March 20, 2026.');
    const result = await engine.processMessage(analyzerOutputs, emotionalState);
    expect(result.llmOutput).toBe('Your deployment is March 20, 2026.');
    expect(result.llmOutput).not.toContain(CANNED_FALLBACK_FRAGMENT);
  });

  test('LLM failure returns canned fallback (production UX preserved)', async () => {
    EngineOrchestrator = await loadOrchestrator();
    const engine = makeEngine(EngineOrchestrator, async () => { throw new Error('timeout'); });
    const result = await engine.processMessage(analyzerOutputs, emotionalState);
    expect(result.llmOutput).toContain(CANNED_FALLBACK_FRAGMENT);
  });

  test('separate orchestrator instances do not share cooldown state', async () => {
    EngineOrchestrator = await loadOrchestrator();

    const engineA = makeEngine(EngineOrchestrator, async () => { throw new Error('timeout'); }, { cooldownMs: 60000 });
    const resultA = await engineA.processMessage(analyzerOutputs, emotionalState);
    expect(resultA.llmOutput).toContain(CANNED_FALLBACK_FRAGMENT);

    const engineB = makeEngine(EngineOrchestrator, async () => 'March 20, 2026 is your date.');
    const resultB = await engineB.processMessage(analyzerOutputs, emotionalState);
    expect(resultB.llmOutput).toBe('March 20, 2026 is your date.');
    expect(resultB.llmOutput).not.toContain(CANNED_FALLBACK_FRAGMENT);
  });

  test('repeated calls to a healthy LLM never degrade into fallback', async () => {
    EngineOrchestrator = await loadOrchestrator();
    let callCount = 0;
    const engine = makeEngine(EngineOrchestrator, async () => {
      callCount++;
      return `Response ${callCount}`;
    });

    await engine.processMessage(analyzerOutputs, emotionalState);
    await engine.processMessage(analyzerOutputs, emotionalState);
    const result = await engine.processMessage(analyzerOutputs, emotionalState);
    expect(callCount).toBe(3);
    expect(result.llmOutput).not.toContain(CANNED_FALLBACK_FRAGMENT);
  });
});

describe('EngineOrchestrator — stress-test mode (LORA_STRESS_TEST=1)', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  function loadOrchestratorWithStressMode(): Promise<any> {
    return new Promise((resolve) => {
      process.env.LORA_STRESS_TEST = '1';
      jest.isolateModules(() => {
        const mod = require('../EngineOrchestrator');
        resolve(mod.EngineOrchestrator);
      });
    });
  }

  afterEach(() => {
    delete process.env.LORA_STRESS_TEST;
  });

  test('LLM failure throws instead of returning canned fallback', async () => {
    const EngineOrchestrator = await loadOrchestratorWithStressMode();
    const engine = makeEngine(EngineOrchestrator, async () => { throw new Error('provider timeout'); });

    await expect(
      engine.processMessage(analyzerOutputs, emotionalState),
    ).rejects.toThrow('LLM retries exhausted');
  });

  test('successful LLM call still works normally', async () => {
    const EngineOrchestrator = await loadOrchestratorWithStressMode();
    const engine = makeEngine(EngineOrchestrator, async () => 'March 20, 2026.');
    const result = await engine.processMessage(analyzerOutputs, emotionalState);
    expect(result.llmOutput).toBe('March 20, 2026.');
    expect(result.llmOutput).not.toContain(CANNED_FALLBACK_FRAGMENT);
  });

  test('cooldown is bypassed — second call after failure still attempts LLM', async () => {
    const EngineOrchestrator = await loadOrchestratorWithStressMode();
    let callCount = 0;
    const engine = makeEngine(EngineOrchestrator, async () => {
      callCount++;
      if (callCount === 1) throw new Error('transient failure');
      return 'Recovered response';
    }, { maxAttempts: 1 });

    await expect(engine.processMessage(analyzerOutputs, emotionalState)).rejects.toThrow();
    expect(callCount).toBe(1);

    const result = await engine.processMessage(analyzerOutputs, emotionalState);
    expect(callCount).toBe(2);
    expect(result.llmOutput).toBe('Recovered response');
    expect(result.llmOutput).not.toContain(CANNED_FALLBACK_FRAGMENT);
  });
});
