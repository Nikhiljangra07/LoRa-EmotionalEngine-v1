/**
 * SessionId correctness tests:
 * - New session increments counter.
 * - Id format matches expected prefix.
 * - Different userId produces different prefix.
 */

import type { AnalyzerOutputs } from '../../processors/EIVComponentAssembler';
import type { EmotionalState } from '../../types/analysis.types';

const mockFlags = {
  appraisalBridgeEnabled: false,
  appraisalBridgeModeEnabled: false,
  appraisalPacingHintEnabled: false,
  strictGuidanceModeEnabled: false,
  driftMonitorEnabled: false,
  validationIntensityEnabled: false,
  adaptiveOverrideCooldownEnabled: false,
  appraisalToneHintEnabled: false,
  interventionValidationHintEnabled: false,
  interventionPacingHintEnabled: false,
  interventionToneHintEnabled: false,
  interventionActionHintEnabled: false,
  interventionInterruptHintEnabled: false,
  interventionStepHintEnabled: false,
  interventionQuestionBudgetEnabled: false,
  hintResolverEnabled: false,
  hintStickinessEnabled: false,
  guidanceDwellLockEnabled: false,
  hintSemanticGuardEnabled: false,
  etvV1Enabled: true,
};

jest.mock('../../config/featureFlags', () => ({
  featureFlags: mockFlags,
}));

jest.mock('../../debug/debugGate', () => ({
  debugEnabled: false,
  decisionLogEnabled: false,
}));

jest.mock('../../../debug/sessionTrace', () => ({
  writeSessionTrace: jest.fn(),
}));

import { EngineOrchestrator } from '../../engines/EngineOrchestrator';
import { DecisionLogger } from '../../logging/DecisionLogger';

const defaultOutputs: AnalyzerOutputs = {
  expressionStrength: { score: 0.4, confidence: 0.7 },
  valence: { score: 0.1, confidence: 0.6 },
  arousal: { score: 0.3, confidence: 0.6 },
};

const neutralState: EmotionalState = {
  dominant: 'NEUTRAL',
  arousal: 'MEDIUM',
  valence: 'NEUTRAL',
  confidence: 0.7,
};

describe('deterministic sessionId generation', () => {
  beforeEach(() => {
    jest.spyOn(DecisionLogger, 'logSessionEnd').mockImplementation(() => {});
    jest.spyOn(DecisionLogger, 'logETVUpdateV1').mockImplementation(() => {});
    mockFlags.etvV1Enabled = true;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('two sequential sessions produce different sessionIds', async () => {
    const engine = new EngineOrchestrator(0.5);

    await engine.processMessage(defaultOutputs, neutralState);
    const id1 = (engine as any).currentSessionId as string;
    engine.endSession();

    await engine.processMessage(defaultOutputs, neutralState);
    const id2 = (engine as any).currentSessionId as string;
    engine.endSession();

    expect(id1).not.toBe(id2);
  });

  test('sessionId starts with sess-{userId}', async () => {
    const engine = new EngineOrchestrator(0.5, {}, undefined as any, { userId: 'testuser' });

    await engine.processMessage(defaultOutputs, neutralState);
    const id = (engine as any).currentSessionId as string;

    expect(id).toMatch(/^sess-testuser-/);
  });

  test('default userId produces sess-anonymous- prefix', async () => {
    const engine = new EngineOrchestrator(0.5);

    await engine.processMessage(defaultOutputs, neutralState);
    const id = (engine as any).currentSessionId as string;

    expect(id).toMatch(/^sess-anonymous-/);
  });

  test('different userId produces different prefix', async () => {
    const engineA = new EngineOrchestrator(0.5, {}, undefined as any, { userId: 'alice' });
    const engineB = new EngineOrchestrator(0.5, {}, undefined as any, { userId: 'bob' });

    await engineA.processMessage(defaultOutputs, neutralState);
    await engineB.processMessage(defaultOutputs, neutralState);

    const idA = (engineA as any).currentSessionId as string;
    const idB = (engineB as any).currentSessionId as string;

    expect(idA).toMatch(/^sess-alice-/);
    expect(idB).toMatch(/^sess-bob-/);
    expect(idA).not.toBe(idB);
  });

  test('session counter increments across sessions', async () => {
    const engine = new EngineOrchestrator(0.5);

    await engine.processMessage(defaultOutputs, neutralState);
    const id1 = (engine as any).currentSessionId as string;
    engine.endSession();

    await engine.processMessage(defaultOutputs, neutralState);
    const id2 = (engine as any).currentSessionId as string;

    // Extract counter suffix
    const counter1 = parseInt(id1.split('-').pop()!, 10);
    const counter2 = parseInt(id2.split('-').pop()!, 10);
    expect(counter2).toBe(counter1 + 1);
  });
});
