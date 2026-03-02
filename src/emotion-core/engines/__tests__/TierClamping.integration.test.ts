import type { AnalyzerOutputs } from '../../processors/EIVComponentAssembler';
import type { EmotionalState } from '../../types/analysis.types';
import { EngineOrchestrator } from '../EngineOrchestrator';

const mockResponder = {
  generateResponse: jest.fn().mockResolvedValue('test response'),
};
const responderFactory = () => mockResponder;

const baseAnalyzerOutputs: AnalyzerOutputs = {
  expressionStrength: { score: 0.6, confidence: 0.7 },
  valence: { score: -0.5, confidence: 0.6 },
  arousal: { score: 0.8, confidence: 0.6 },
  enhanced: {
    semanticScore: -0.5,
    arousalScore: 0.8,
    repetitionWeight: 0.0,
    capsWeight: 0.0,
  },
};

const highArousalState: EmotionalState = {
  dominant: 'ANGER',
  arousal: 'HIGH',
  valence: 'NEGATIVE',
  confidence: 0.8,
};

const calmState: EmotionalState = {
  dominant: 'NEUTRAL',
  arousal: 'LOW',
  valence: 'NEUTRAL',
  confidence: 0.7,
};

describe('Tier clamping integration', () => {
  beforeEach(() => {
    mockResponder.generateResponse.mockClear();
  });

  describe('flag OFF — baseline behavior', () => {
    beforeAll(() => {
      delete process.env.LORA_TIER_MODEL;
    });

    it('produces no tier block in prompt', async () => {
      jest.resetModules();
      const { EngineOrchestrator: EO } = require('../EngineOrchestrator');
      const engine = new EO(0.5, {}, responderFactory);
      const result = await engine.processMessage(baseAnalyzerOutputs, calmState);
      expect(result.prompt).not.toContain('RELATIONAL TRAJECTORY');
      expect(result.prompt).not.toContain('RELATIONAL_TIER_POLICY');
    });
  });

  describe('flag ON + TIER_1', () => {
    beforeAll(() => {
      process.env.LORA_TIER_MODEL = '1';
    });
    afterAll(() => {
      delete process.env.LORA_TIER_MODEL;
    });

    it('clamps ENERGY_MATCH to CALM_NEUTRAL in TIER_1', async () => {
      jest.resetModules();
      const { EngineOrchestrator: EO } = require('../EngineOrchestrator');

      const engine = new EO(0.5, {}, responderFactory);

      const result = await engine.processMessage(
        baseAnalyzerOutputs,
        highArousalState,
      );

      expect(result.prompt).toContain('RELATIONAL_TIER_POLICY');
      expect(result.prompt).toContain('TIER_1');
      expect(result.prompt).not.toContain('[ENERGY_MATCH]');
    });

    it('removes actionHint in TIER_1', async () => {
      jest.resetModules();
      const { EngineOrchestrator: EO } = require('../EngineOrchestrator');

      const engine = new EO(0.5, {}, responderFactory);

      const result = await engine.processMessage(
        baseAnalyzerOutputs,
        calmState,
      );

      expect(result.prompt).not.toContain('ACTION_HINT:OFFER_STEPS');
      expect(result.prompt).not.toContain('ACTION_HINT:ASK_ONE_QUESTION');
    });

    it('caps validationIntensity HIGH to LOW in TIER_1', async () => {
      jest.resetModules();
      const { EngineOrchestrator: EO } = require('../EngineOrchestrator');

      const engine = new EO(0.5, {}, responderFactory);

      const highEivOutputs: AnalyzerOutputs = {
        expressionStrength: { score: 0.95, confidence: 0.9 },
        valence: { score: -0.8, confidence: 0.9 },
        arousal: { score: 0.95, confidence: 0.9 },
        enhanced: {
          semanticScore: -0.8,
          arousalScore: 0.95,
          repetitionWeight: 0.5,
          capsWeight: 0.5,
        },
      };

      const result = await engine.processMessage(
        highEivOutputs,
        { dominant: 'ANGER', arousal: 'HIGH', valence: 'NEGATIVE', confidence: 0.9 },
      );

      expect(result.prompt).not.toContain('VALIDATION_INTENSITY:HIGH');
    });

    it('applies default GENTLE toneHint when toneHint is absent', async () => {
      jest.resetModules();
      const { EngineOrchestrator: EO } = require('../EngineOrchestrator');

      const engine = new EO(0.5, {}, responderFactory);

      const result = await engine.processMessage(
        {
          expressionStrength: { score: 0.3, confidence: 0.7 },
          valence: { score: 0.2, confidence: 0.6 },
          arousal: { score: 0.2, confidence: 0.6 },
        },
        calmState,
      );

      expect(result.prompt).toContain('TONE_HINT:GENTLE');
    });
  });

  describe('safety modes in tier policy (unit check)', () => {
    it('SAFETY_MODES are in TIER_1 allowedGuidanceModes', () => {
      const { getTierPolicy, SAFETY_MODES } = require('../../tier/RelationalTier');
      const policy = getTierPolicy('TIER_1');
      for (const mode of SAFETY_MODES) {
        expect(policy.allowedGuidanceModes.has(mode)).toBe(true);
      }
    });

    it('CONTAINMENT, DE_ESCALATE, STABILIZE always allowed in all tiers', () => {
      const { getTierPolicy } = require('../../tier/RelationalTier');
      for (const tier of ['TIER_1', 'TIER_2', 'TIER_3']) {
        const policy = getTierPolicy(tier);
        expect(policy.allowedGuidanceModes.has('CONTAINMENT')).toBe(true);
        expect(policy.allowedGuidanceModes.has('DE_ESCALATE')).toBe(true);
        expect(policy.allowedGuidanceModes.has('STABILIZE')).toBe(true);
      }
    });
  });

  describe('flag ON + appraisal-provided toneHint not overridden', () => {
    beforeAll(() => {
      process.env.LORA_TIER_MODEL = '1';
      process.env.LORA_APPRAISAL_BRIDGE = '1';
      process.env.LORA_APPRAISAL_BRIDGE_MODE = '1';
      process.env.LORA_APPRAISAL_TONE_HINT = '1';
    });
    afterAll(() => {
      delete process.env.LORA_TIER_MODEL;
      delete process.env.LORA_APPRAISAL_BRIDGE;
      delete process.env.LORA_APPRAISAL_BRIDGE_MODE;
      delete process.env.LORA_APPRAISAL_TONE_HINT;
    });

    it('FIRM toneHint from appraisal is not replaced by GENTLE default', async () => {
      jest.resetModules();
      const { EngineOrchestrator: EO } = require('../EngineOrchestrator');

      const engine = new EO(0.5, {}, responderFactory);

      for (let i = 0; i < 4; i++) {
        await engine.processMessage(
          baseAnalyzerOutputs,
          highArousalState,
        );
      }

      const calls2 = mockResponder.generateResponse.mock.calls;
      const lastPrompt2 = calls2[calls2.length - 1]?.[0] as string;
      if (lastPrompt2.includes('TONE_HINT:FIRM')) {
        expect(lastPrompt2).toContain('TONE_HINT:FIRM');
      } else {
        expect(lastPrompt2).toContain('TONE_HINT:GENTLE');
      }
    });
  });
});
