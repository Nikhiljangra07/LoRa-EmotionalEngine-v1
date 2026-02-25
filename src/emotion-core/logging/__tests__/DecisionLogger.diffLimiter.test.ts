// src/emotion-core/logging/__tests__/DecisionLogger.diffLimiter.test.ts

jest.mock('../../debug/debugGate', () => ({
  decisionLogEnabled: true,
  debugEnabled: false,
}));

import { DecisionLogger, type PromptProfileDiffPayload } from '../DecisionLogger';

function makePayload(overrides: Partial<PromptProfileDiffPayload> = {}): PromptProfileDiffPayload {
  return {
    messageId: 'msg-1',
    userId: 'user-a',
    oldRelationshipStyle: 'Professional',
    newRelationshipStyle: 'Friendly',
    band: 'BAND_2',
    maxInitiative: 0.50,
    maxDepth: 0.55,
    assertiveness: 0.40,
    clarificationBias: 0.40,
    maxResponseTokens: 320,
    promptSignature: 'BAND_2:FRIENDLY:init=MOD:depth=MOD:assert=BALANCED:pers=MOD:clar=MOD:len=MEDIUM',
    ...overrides,
  };
}

describe('DecisionLogger.logPromptProfileDiff — rate limiting', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    DecisionLogger.resetDiffLimiter();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('logs the first call', () => {
    DecisionLogger.logPromptProfileDiff(makePayload());
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      '[LoRa::PromptProfileDiff]',
      expect.any(String),
    );
  });

  it('suppresses duplicate within cooldown for same key', () => {
    const payload = makePayload();
    DecisionLogger.logPromptProfileDiff(payload);
    DecisionLogger.logPromptProfileDiff(payload);
    DecisionLogger.logPromptProfileDiff(payload);
    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });

  it('logs again for a different user', () => {
    DecisionLogger.logPromptProfileDiff(makePayload({ userId: 'user-a' }));
    DecisionLogger.logPromptProfileDiff(makePayload({ userId: 'user-b' }));
    expect(consoleSpy).toHaveBeenCalledTimes(2);
  });

  it('logs again for a different band', () => {
    DecisionLogger.logPromptProfileDiff(makePayload({ band: 'BAND_0' }));
    DecisionLogger.logPromptProfileDiff(makePayload({ band: 'BAND_2' }));
    expect(consoleSpy).toHaveBeenCalledTimes(2);
  });

  it('logs again for a different old/new style pair', () => {
    DecisionLogger.logPromptProfileDiff(makePayload({
      oldRelationshipStyle: 'Professional',
      newRelationshipStyle: 'Friendly',
    }));
    DecisionLogger.logPromptProfileDiff(makePayload({
      oldRelationshipStyle: 'Friendly',
      newRelationshipStyle: 'Friendly',
    }));
    expect(consoleSpy).toHaveBeenCalledTimes(2);
  });

  it('logs again after cooldown expires', () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    DecisionLogger.logPromptProfileDiff(makePayload());
    expect(consoleSpy).toHaveBeenCalledTimes(1);

    (Date.now as jest.Mock).mockReturnValue(now + 1000);
    DecisionLogger.logPromptProfileDiff(makePayload());
    expect(consoleSpy).toHaveBeenCalledTimes(1);

    (Date.now as jest.Mock).mockReturnValue(now + 5 * 60 * 1000 + 1);
    DecisionLogger.logPromptProfileDiff(makePayload());
    expect(consoleSpy).toHaveBeenCalledTimes(2);

    (Date.now as jest.Mock).mockRestore();
  });

  it('different messageId same composite key still throttled', () => {
    DecisionLogger.logPromptProfileDiff(makePayload({ messageId: 'msg-1' }));
    DecisionLogger.logPromptProfileDiff(makePayload({ messageId: 'msg-2' }));
    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });

  it('resetDiffLimiter clears all entries', () => {
    DecisionLogger.logPromptProfileDiff(makePayload());
    expect(consoleSpy).toHaveBeenCalledTimes(1);

    DecisionLogger.resetDiffLimiter();

    DecisionLogger.logPromptProfileDiff(makePayload());
    expect(consoleSpy).toHaveBeenCalledTimes(2);
  });
});
