// src/emotion-core/prompt/__tests__/etvPolicyPrompt.test.ts

import { PromptTemplateBuilder } from '../PromptTemplateBuilder';
import { mapETVPolicyToPrompt, renderConstraintOverlay } from '../etvPolicyPromptMap';
import type { EmotionalState } from '../../types/analysis.types';
import type { ETVState } from '../../types/etv.types';
import type { ETVPolicy } from '../../etv/types';
import { featureFlags } from '../../config/featureFlags';

jest.mock('../../config/featureFlags', () => ({
  featureFlags: {
    strictGuidanceModeEnabled: false,
    etvPolicyPromptEnabled: false,
    etvPolicyPromptShadowEnabled: false,
    etvV1Enabled: false,
  },
}));

jest.mock('../../logging/DecisionLogger', () => ({
  DecisionLogger: {
    logPromptProfileDiff: jest.fn(),
  },
}));

import { DecisionLogger } from '../../logging/DecisionLogger';

const mutableFlags = featureFlags as Record<string, boolean>;

function makeEmotionalState(
  arousal: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW',
  valence: 'NEUTRAL' | 'POSITIVE' | 'NEGATIVE' = 'NEUTRAL',
): EmotionalState {
  return { dominant: 'NEUTRAL', arousal, valence, confidence: 1 };
}

function makeETVState(value: number): ETVState {
  return { value, sessionEIVs: [], messageCount: 0, lastUpdated: 0 };
}

function makePolicyBand0(): ETVPolicy {
  return {
    etvMean: 0.375,
    etvVar: 0.06,
    band: 'BAND_0',
    maxInitiative: 0.15,
    maxDepth: 0.20,
    assertiveness: 0.10,
    personalizationStrength: 0.10,
    clarificationBias: 0.70,
    maxResponseTokens: 120,
  };
}

function makePolicyBand2(): ETVPolicy {
  return {
    etvMean: 0.60,
    etvVar: 0.02,
    band: 'BAND_2',
    maxInitiative: 0.50,
    maxDepth: 0.55,
    assertiveness: 0.40,
    personalizationStrength: 0.45,
    clarificationBias: 0.40,
    maxResponseTokens: 320,
  };
}

function makePolicyBand4(): ETVPolicy {
  return {
    etvMean: 0.85,
    etvVar: 0.005,
    band: 'BAND_4',
    maxInitiative: 0.75,
    maxDepth: 0.80,
    assertiveness: 0.60,
    personalizationStrength: 0.70,
    clarificationBias: 0.20,
    maxResponseTokens: 460,
  };
}

describe('etvPolicyPromptMap — unit tests', () => {
  describe('mapETVPolicyToPrompt', () => {
    it('maps BAND_0 to PROFESSIONAL', () => {
      const mapping = mapETVPolicyToPrompt(makePolicyBand0());
      expect(mapping.relationshipStyle).toBe('PROFESSIONAL');
      expect(mapping.guidanceHint).toMatch(/conservative/i);
    });

    it('maps BAND_2 to FRIENDLY', () => {
      const mapping = mapETVPolicyToPrompt(makePolicyBand2());
      expect(mapping.relationshipStyle).toBe('FRIENDLY');
    });

    it('maps BAND_4 to FRIENDLY (tone hardened, no CASUAL)', () => {
      const mapping = mapETVPolicyToPrompt(makePolicyBand4());
      expect(mapping.relationshipStyle).toBe('FRIENDLY');
    });

    it('constraints reflect policy values', () => {
      const p = makePolicyBand0();
      const mapping = mapETVPolicyToPrompt(p);
      expect(mapping.constraints.maxInitiative).toBe(p.maxInitiative);
      expect(mapping.constraints.maxDepth).toBe(p.maxDepth);
      expect(mapping.constraints.maxResponseTokens).toBe(p.maxResponseTokens);
      expect(mapping.constraints.band).toBe('BAND_0');
    });
  });

  describe('renderConstraintOverlay', () => {
    it('BAND_0 produces conservative overlay', () => {
      const mapping = mapETVPolicyToPrompt(makePolicyBand0());
      const overlay = renderConstraintOverlay(mapping);
      expect(overlay).toContain('ETV_POLICY_CONSTRAINTS');
      expect(overlay).toMatch(/initiative.*low/i);
      expect(overlay).toMatch(/depth.*shallow/i);
      expect(overlay).toMatch(/clarifying questions/i);
      expect(overlay).toMatch(/gentle/i);
      expect(overlay).toMatch(/no.*intimacy/i);
    });

    it('BAND_4 allows more engagement but stays bounded', () => {
      const mapping = mapETVPolicyToPrompt(makePolicyBand4());
      const overlay = renderConstraintOverlay(mapping);
      expect(overlay).toContain('ETV_POLICY_CONSTRAINTS');
      expect(overlay).toMatch(/initiative.*standard/i);
      expect(overlay).toMatch(/depth.*full/i);
      expect(overlay).toMatch(/confident but respectful/i);
      expect(overlay).toMatch(/no.*intimacy/i);
    });

    it('never contains raw float values', () => {
      const allBands = [makePolicyBand0(), makePolicyBand2(), makePolicyBand4()];
      for (const p of allBands) {
        const overlay = renderConstraintOverlay(mapETVPolicyToPrompt(p));
        expect(overlay).not.toMatch(/\b0\.\d+\b/);
      }
    });
  });
});

describe('PromptTemplateBuilder — ETV Policy integration', () => {
  beforeEach(() => {
    mutableFlags.etvPolicyPromptEnabled = false;
    mutableFlags.etvPolicyPromptShadowEnabled = false;
    (DecisionLogger.logPromptProfileDiff as jest.Mock).mockClear();
  });

  describe('when both flags OFF', () => {
    it('output is identical whether etvPolicy is provided or not', () => {
      const emo = makeEmotionalState();
      const etv = makeETVState(0.3);

      const withoutPolicy = PromptTemplateBuilder.build(emo, etv);
      const withPolicy = PromptTemplateBuilder.build(emo, etv, {
        etvPolicy: makePolicyBand2(),
      });

      expect(withPolicy).toBe(withoutPolicy);
    });

    it('does not include constraint overlay', () => {
      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(0.3),
        { etvPolicy: makePolicyBand0() },
      );
      expect(prompt).not.toContain('ETV_POLICY_CONSTRAINTS');
    });

    it('does not log PromptProfileDiff', () => {
      PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(0.3),
        { etvPolicy: makePolicyBand0() },
      );
      expect(DecisionLogger.logPromptProfileDiff).not.toHaveBeenCalled();
    });
  });

  describe('when flag ON and etvPolicy present', () => {
    beforeEach(() => {
      mutableFlags.etvPolicyPromptEnabled = true;
    });

    it('band 0 yields conservative constraints', () => {
      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(0.3),
        { etvPolicy: makePolicyBand0() },
      );
      expect(prompt).toContain('ETV_POLICY_CONSTRAINTS');
      expect(prompt).toMatch(/initiative.*low/i);
      expect(prompt).toMatch(/depth.*shallow/i);
      expect(prompt).toMatch(/clarifying questions/i);
    });

    it('band 4 yields higher caps but is still bounded', () => {
      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(0.7),
        { etvPolicy: makePolicyBand4() },
      );
      expect(prompt).toContain('ETV_POLICY_CONSTRAINTS');
      expect(prompt).toMatch(/initiative.*standard/i);
      expect(prompt).toMatch(/depth.*full/i);
      expect(prompt).toMatch(/no.*intimacy/i);
    });

    it('band 0 relationship style is Professional', () => {
      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(0.3),
        { etvPolicy: makePolicyBand0() },
      );
      expect(prompt).toMatch(/professional/i);
    });

    it('band 4 relationship style is Friendly (tone hardened)', () => {
      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(0.7),
        { etvPolicy: makePolicyBand4() },
      );
      expect(prompt).toMatch(/friendly/i);
      expect(prompt).not.toMatch(/casual/i);
    });

    it('assertiveness < 1 even at band 4', () => {
      const p = makePolicyBand4();
      expect(p.assertiveness).toBeLessThan(1);
    });

    it('maxResponseTokens is capped even at band 4', () => {
      const p = makePolicyBand4();
      expect(p.maxResponseTokens).toBeLessThanOrEqual(520);
    });
  });

  describe('fallback when etvPolicy undefined', () => {
    it('behaves exactly like legacy even if flag ON', () => {
      mutableFlags.etvPolicyPromptEnabled = true;
      const emo = makeEmotionalState();
      const etv = makeETVState(0.3);

      const legacyPrompt = (() => {
        mutableFlags.etvPolicyPromptEnabled = false;
        return PromptTemplateBuilder.build(emo, etv);
      })();
      mutableFlags.etvPolicyPromptEnabled = true;
      const fallbackPrompt = PromptTemplateBuilder.build(emo, etv);

      expect(fallbackPrompt).toBe(legacyPrompt);
    });

    it('does not include constraint overlay', () => {
      mutableFlags.etvPolicyPromptEnabled = true;
      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(0.3),
      );
      expect(prompt).not.toContain('ETV_POLICY_CONSTRAINTS');
    });
  });

  describe('no numeric leak in prompt output', () => {
    it('flag ON + band 0 has no raw floats', () => {
      mutableFlags.etvPolicyPromptEnabled = true;
      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(0.3),
        { etvPolicy: makePolicyBand0() },
      );
      expect(prompt).not.toMatch(/\b0\.\d+\b/);
    });

    it('flag ON + band 4 has no raw floats', () => {
      mutableFlags.etvPolicyPromptEnabled = true;
      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(0.7),
        { etvPolicy: makePolicyBand4() },
      );
      expect(prompt).not.toMatch(/\b0\.\d+\b/);
    });
  });

  describe('shadow mode (SHADOW ON, POLICY_PROMPT OFF)', () => {
    beforeEach(() => {
      mutableFlags.etvPolicyPromptEnabled = false;
      mutableFlags.etvPolicyPromptShadowEnabled = true;
    });

    it('returns legacy output (no overlay)', () => {
      const emo = makeEmotionalState();
      const etv = makeETVState(0.3);

      const legacyPrompt = (() => {
        mutableFlags.etvPolicyPromptShadowEnabled = false;
        const p = PromptTemplateBuilder.build(emo, etv);
        mutableFlags.etvPolicyPromptShadowEnabled = true;
        return p;
      })();

      const shadowPrompt = PromptTemplateBuilder.build(emo, etv, {
        etvPolicy: makePolicyBand2(),
      });

      expect(shadowPrompt).toBe(legacyPrompt);
      expect(shadowPrompt).not.toContain('ETV_POLICY_CONSTRAINTS');
    });

    it('logs PromptProfileDiff even though output is legacy', () => {
      PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(0.3),
        { etvPolicy: makePolicyBand0(), messageId: 'msg-1', userId: 'user-a' },
      );
      expect(DecisionLogger.logPromptProfileDiff).toHaveBeenCalledTimes(1);
      expect(DecisionLogger.logPromptProfileDiff).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: 'msg-1',
          userId: 'user-a',
          band: 'BAND_0',
        }),
      );
    });

    it('does not log diff when etvPolicy is undefined', () => {
      PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(0.3),
      );
      expect(DecisionLogger.logPromptProfileDiff).not.toHaveBeenCalled();
    });

    it('diff payload includes old and new relationship styles', () => {
      PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(0.3),
        { etvPolicy: makePolicyBand2() },
      );
      const payload = (DecisionLogger.logPromptProfileDiff as jest.Mock).mock.calls[0][0];
      expect(payload.oldRelationshipStyle).toMatch(/professional/i);
      expect(payload.newRelationshipStyle).toMatch(/friendly/i);
    });
  });

  describe('shadow + serve (both flags ON)', () => {
    beforeEach(() => {
      mutableFlags.etvPolicyPromptEnabled = true;
      mutableFlags.etvPolicyPromptShadowEnabled = true;
    });

    it('returns new output with overlay', () => {
      const prompt = PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(0.3),
        { etvPolicy: makePolicyBand0() },
      );
      expect(prompt).toContain('ETV_POLICY_CONSTRAINTS');
    });

    it('logs diff once (not duplicated)', () => {
      PromptTemplateBuilder.build(
        makeEmotionalState(),
        makeETVState(0.3),
        { etvPolicy: makePolicyBand0() },
      );
      expect(DecisionLogger.logPromptProfileDiff).toHaveBeenCalledTimes(1);
    });
  });

  describe('tone hardening — no CASUAL at any band', () => {
    beforeEach(() => {
      mutableFlags.etvPolicyPromptEnabled = true;
    });

    it('BAND_4 maps to FRIENDLY, not CASUAL', () => {
      const mapping = mapETVPolicyToPrompt(makePolicyBand4());
      expect(mapping.relationshipStyle).toBe('FRIENDLY');
      expect(mapping.relationshipStyle).not.toBe('CASUAL');
    });

    it('no band produces CASUAL', () => {
      const bands = ['BAND_0', 'BAND_1', 'BAND_2', 'BAND_3', 'BAND_4'] as const;
      for (const band of bands) {
        const policy = { ...makePolicyBand0(), band };
        const mapping = mapETVPolicyToPrompt(policy);
        expect(mapping.relationshipStyle).not.toBe('CASUAL');
      }
    });

    it('overlay never contains "casual"', () => {
      const bands = ['BAND_0', 'BAND_1', 'BAND_2', 'BAND_3', 'BAND_4'] as const;
      for (const band of bands) {
        const policy = { ...makePolicyBand0(), band };
        const overlay = renderConstraintOverlay(mapETVPolicyToPrompt(policy));
        expect(overlay.toLowerCase()).not.toContain('casual');
      }
    });
  });
});
