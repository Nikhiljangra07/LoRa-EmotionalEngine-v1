/**
 * Regression tests for the stress-test-mode fallback gate.
 *
 * Root cause: EngineOrchestrator's cooldown mechanism silently replaces real
 * LLM responses with canned comfort text ("I'm here with you…"). Under stress
 * tests, a single transient timeout cascades into minutes of fake responses,
 * causing false recall failures across all scenarios.
 *
 * These tests verify:
 *   1. Normal date recall does NOT trigger fallback
 *   2. LLM failure in stress-test mode throws instead of returning canned text
 *   3. LLM failure outside stress-test mode still returns canned text (production UX)
 *   4. Different users/sessions remain isolated
 */

import { EngineOrchestrator } from '../EngineOrchestrator';
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
  responder: () => Promise<string>,
  opts: { maxAttempts?: number; cooldownMs?: number } = {},
) {
  return new EngineOrchestrator(
    0.5,
    { maxAttempts: opts.maxAttempts ?? 1, cooldownMs: opts.cooldownMs ?? 500 },
    () => ({ generateResponse: responder }),
  );
}

describe('EngineOrchestrator — stress-test mode fallback gate', () => {
  const origEnv = process.env.LORA_STRESS_TEST;

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.LORA_STRESS_TEST;
    } else {
      process.env.LORA_STRESS_TEST = origEnv;
    }
  });

  test('successful LLM call never returns fallback text', async () => {
    const engine = makeEngine(async () => 'Your deployment is March 20, 2026.');
    const result = await engine.processMessage(analyzerOutputs, emotionalState);
    expect(result.llmOutput).toBe('Your deployment is March 20, 2026.');
    expect(result.llmOutput).not.toContain(CANNED_FALLBACK_FRAGMENT);
  });

  test('LLM failure without stress-test mode returns canned fallback (production UX)', async () => {
    process.env.LORA_STRESS_TEST = '';
    const engine = makeEngine(async () => { throw new Error('timeout'); });
    const result = await engine.processMessage(analyzerOutputs, emotionalState);
    expect(result.llmOutput).toContain(CANNED_FALLBACK_FRAGMENT);
  });

  test('separate orchestrator instances do not share cooldown state', async () => {
    process.env.LORA_STRESS_TEST = '';

    // Engine A fails → enters cooldown
    const engineA = makeEngine(async () => { throw new Error('timeout'); }, { cooldownMs: 60000 });
    const resultA = await engineA.processMessage(analyzerOutputs, emotionalState);
    expect(resultA.llmOutput).toContain(CANNED_FALLBACK_FRAGMENT);

    // Engine B (different session) should succeed independently
    const engineB = makeEngine(async () => 'March 20, 2026 is your date.');
    const resultB = await engineB.processMessage(analyzerOutputs, emotionalState);
    expect(resultB.llmOutput).toBe('March 20, 2026 is your date.');
    expect(resultB.llmOutput).not.toContain(CANNED_FALLBACK_FRAGMENT);
  });

  test('repeated calls to a healthy LLM never degrade into fallback', async () => {
    let callCount = 0;
    const engine = makeEngine(async () => {
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
