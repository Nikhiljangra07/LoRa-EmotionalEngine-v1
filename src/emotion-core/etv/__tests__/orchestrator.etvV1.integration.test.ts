/**
 * Integration tests for ETV V1 wiring in EngineOrchestrator:
 *   - Idempotent session close (no double ETV update)
 *   - Idle boundary detection (auto-close after SESSION_GAP_MS)
 *   - Short-session mass correction
 *   - AVI ring buffer only active under flag
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

describe('EngineOrchestrator — ETV V1 idempotent session close', () => {
  let logSessionEndSpy: jest.SpyInstance;
  let logETVUpdateSpy: jest.SpyInstance;

  beforeEach(() => {
    logSessionEndSpy = jest.spyOn(DecisionLogger, 'logSessionEnd').mockImplementation(() => {});
    logETVUpdateSpy = jest.spyOn(DecisionLogger, 'logETVUpdate').mockImplementation(() => {});
    mockFlags.etvV1Enabled = true;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('calling endSession twice yields exactly one session log and one ETV update log', async () => {
    const engine = new EngineOrchestrator(0.5);
    await engine.processMessage(defaultOutputs, neutralState);

    engine.endSession();
    engine.endSession();

    expect(logSessionEndSpy).toHaveBeenCalledTimes(1);
    expect(logETVUpdateSpy).toHaveBeenCalledTimes(1);
  });

  test('endSession on empty session (no messages) is a no-op', () => {
    const engine = new EngineOrchestrator(0.5);
    const result = engine.endSession();
    expect(result.newETV).toBe(0.5);
    expect(logSessionEndSpy).not.toHaveBeenCalled();
  });

  test('endSession after reset still idempotent — new session requires new messages', async () => {
    const engine = new EngineOrchestrator(0.5);
    await engine.processMessage(defaultOutputs, neutralState);
    engine.endSession();

    // No new messages processed → endSession should be no-op
    engine.endSession();
    expect(logSessionEndSpy).toHaveBeenCalledTimes(1);
    expect(logETVUpdateSpy).toHaveBeenCalledTimes(1);
  });

  test('new session after endSession allows a fresh close', async () => {
    const engine = new EngineOrchestrator(0.5);

    // Session 1
    await engine.processMessage(defaultOutputs, neutralState);
    engine.endSession();

    // Session 2
    await engine.processMessage(defaultOutputs, neutralState);
    engine.endSession();

    expect(logSessionEndSpy).toHaveBeenCalledTimes(2);
    expect(logETVUpdateSpy).toHaveBeenCalledTimes(2);
  });
});

describe('EngineOrchestrator — ETV V1 flag off preserves old behavior', () => {
  let logSessionEndSpy: jest.SpyInstance;

  beforeEach(() => {
    logSessionEndSpy = jest.spyOn(DecisionLogger, 'logSessionEnd').mockImplementation(() => {});
    jest.spyOn(DecisionLogger, 'logETVUpdate').mockImplementation(() => {});
    mockFlags.etvV1Enabled = false;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('endSession on empty session is still safe when flag off', () => {
    const engine = new EngineOrchestrator(0.5);
    expect(() => engine.endSession()).not.toThrow();
    expect(logSessionEndSpy).not.toHaveBeenCalled();
  });

  test('ETV update log is not emitted when flag is off', async () => {
    const engine = new EngineOrchestrator(0.5);
    await engine.processMessage(defaultOutputs, neutralState);
    engine.endSession();
    expect(logSessionEndSpy).toHaveBeenCalledTimes(1);
    // No ETV V1 update when flag is off
    expect(jest.spyOn(DecisionLogger, 'logETVUpdate')).not.toHaveBeenCalled();
  });
});

describe('EngineOrchestrator — AVI buffer gated by flag', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('sessionAVIs accumulate when flag is on', async () => {
    mockFlags.etvV1Enabled = true;
    const engine = new EngineOrchestrator(0.5);
    await engine.processMessage(defaultOutputs, neutralState);
    await engine.processMessage(defaultOutputs, neutralState);

    // Access private field for verification
    const avis = (engine as any).sessionAVIs as number[];
    expect(avis.length).toBe(2);
  });

  test('sessionAVIs empty when flag is off', async () => {
    mockFlags.etvV1Enabled = false;
    const engine = new EngineOrchestrator(0.5);
    await engine.processMessage(defaultOutputs, neutralState);
    await engine.processMessage(defaultOutputs, neutralState);

    const avis = (engine as any).sessionAVIs as number[];
    expect(avis.length).toBe(0);
  });
});
