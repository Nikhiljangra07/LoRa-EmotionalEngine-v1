/**
 * Verifies that with LORA_TIER_MODEL unset (flag OFF), the tier infrastructure
 * does not activate and the system behaves identically to before.
 */

describe('Tier model flag OFF safety', () => {
  it('featureFlags.tierModelEnabled defaults to false', () => {
    delete process.env.LORA_TIER_MODEL;
    jest.resetModules();
    const { featureFlags } = require('../../config/featureFlags');
    expect(featureFlags.tierModelEnabled).toBe(false);
  });

  it('EngineOrchestrator does not crash when flag is OFF', () => {
    delete process.env.LORA_TIER_MODEL;
    jest.resetModules();

    const { EngineOrchestrator } = require('../../../emotion-core/engines/EngineOrchestrator');
    const mockResponder = {
      generateResponse: jest.fn().mockResolvedValue('ok'),
    };
    const engine = new EngineOrchestrator(
      0.5,
      {},
      () => mockResponder,
    );
    expect(engine).toBeDefined();

    const result = engine.endSession();
    expect(result).toHaveProperty('newETV');
  });
});
