import { PromptTemplateBuilder } from '../PromptTemplateBuilder';
import type { EmotionalState } from '../../types/analysis.types';
import type { ETVState } from '../../types/etv.types';

const defaultState: EmotionalState = {
  dominant: 'NEUTRAL',
  arousal: 'LOW',
  valence: 'NEUTRAL',
  confidence: 0.7,
};

const defaultETV: ETVState = {
  value: 0.5,
  sessionEIVs: [],
  messageCount: 1,
  lastUpdated: Date.now(),
};

describe('PromptTemplateBuilder — Tier Policy', () => {
  describe('tier OFF (no tierContext)', () => {
    it('does not include RELATIONAL_TIER_POLICY block', () => {
      const prompt = PromptTemplateBuilder.build(defaultState, defaultETV, {
        guidanceMode: 'CALM_NEUTRAL',
      });
      expect(prompt).not.toContain('RELATIONAL_TIER_POLICY');
      expect(prompt).not.toContain('RELATIONAL TRAJECTORY');
    });
  });

  describe('tier ON — TIER_1', () => {
    const tierContext = { tier: 'TIER_1' as const, description: 'Conservative', sessionCount: 1 };

    it('includes RELATIONAL TRAJECTORY context block', () => {
      const prompt = PromptTemplateBuilder.build(defaultState, defaultETV, {
        guidanceMode: 'CALM_NEUTRAL',
        tierContext,
      });
      expect(prompt).toContain('RELATIONAL TRAJECTORY');
      expect(prompt).toContain('TIER_1 (Conservative)');
      expect(prompt).toContain('Sessions observed: 1');
      expect(prompt).toContain('New relationship');
    });

    it('includes RELATIONAL_TIER_POLICY directive', () => {
      const prompt = PromptTemplateBuilder.build(defaultState, defaultETV, {
        guidanceMode: 'CALM_NEUTRAL',
        tierContext,
      });
      expect(prompt).toContain('[RELATIONAL_TIER_POLICY]');
      expect(prompt).toContain('concise');
      expect(prompt).toContain('Max one question');
      expect(prompt).toContain('unsolicited advice');
    });

    it('does not leak raw numerics in prompt', () => {
      const prompt = PromptTemplateBuilder.build(defaultState, defaultETV, {
        guidanceMode: 'CALM_NEUTRAL',
        tierContext,
      });
      const tierSection = prompt.slice(
        prompt.indexOf('RELATIONAL TRAJECTORY'),
        prompt.indexOf('RELATIONAL_TIER_POLICY') + 200,
      );
      expect(tierSection).not.toMatch(/0\.\d{2,}/);
    });
  });

  describe('tier ON — TIER_2', () => {
    const tierContext = { tier: 'TIER_2' as const, description: 'Balanced', sessionCount: 3 };

    it('includes TIER_2 context and policy', () => {
      const prompt = PromptTemplateBuilder.build(defaultState, defaultETV, {
        guidanceMode: 'CALM_NEUTRAL',
        tierContext,
      });
      expect(prompt).toContain('TIER_2 (Balanced)');
      expect(prompt).toContain('Sessions observed: 3');
      expect(prompt).toContain('[RELATIONAL_TIER_POLICY]');
      expect(prompt).toContain('Warmer tone');
    });
  });

  describe('tier ON — TIER_3', () => {
    const tierContext = { tier: 'TIER_3' as const, description: 'Direct', sessionCount: 6 };

    it('includes TIER_3 context and policy', () => {
      const prompt = PromptTemplateBuilder.build(defaultState, defaultETV, {
        guidanceMode: 'CALM_NEUTRAL',
        tierContext,
      });
      expect(prompt).toContain('TIER_3 (Direct)');
      expect(prompt).toContain('Sessions observed: 6');
      expect(prompt).toContain('[RELATIONAL_TIER_POLICY]');
      expect(prompt).toContain('Direct and structured');
      expect(prompt).toContain('Action-oriented');
    });
  });

  describe('onboarding in tier context (when LORA_TIER_MODEL=1)', () => {
    it('includes onboarding prefs in RELATIONAL TRAJECTORY when provided', () => {
      const prompt = PromptTemplateBuilder.build(defaultState, defaultETV, {
        guidanceMode: 'CALM_NEUTRAL',
        tierContext: {
          tier: 'TIER_1',
          description: 'Conservative',
          sessionCount: 1,
          onboarding: {
            name: 'Alex',
            preferredTone: 'direct',
            goalOrientation: 'growth',
          },
        },
      });
      expect(prompt).toContain('RELATIONAL TRAJECTORY');
      expect(prompt).toContain('User name: Alex');
      expect(prompt).toContain('Preferred tone: direct');
      expect(prompt).toContain('Goal: growth');
    });

    it('tier block without onboarding omits user prefs', () => {
      const prompt = PromptTemplateBuilder.build(defaultState, defaultETV, {
        guidanceMode: 'CALM_NEUTRAL',
        tierContext: { tier: 'TIER_1', description: 'Conservative', sessionCount: 1 },
      });
      expect(prompt).not.toContain('User name:');
    });
  });

  describe('no numeric leakage across all tiers', () => {
    it.each(['TIER_1', 'TIER_2', 'TIER_3'] as const)('%s has no float leakage in tier blocks', (tier) => {
      const prompt = PromptTemplateBuilder.build(defaultState, defaultETV, {
        guidanceMode: 'CALM_NEUTRAL',
        tierContext: { tier, description: 'test', sessionCount: 2 },
      });
      const start = prompt.indexOf('RELATIONAL TRAJECTORY');
      const end = prompt.indexOf('BAND CALIBRATION');
      if (start >= 0 && end >= 0) {
        const section = prompt.slice(start, end);
        expect(section).not.toMatch(/\b0\.\d{2,}\b/);
      }
    });
  });

  describe('no trust-based tier language in prompt (regression)', () => {
    const trustPhrases = [
      'Earn trust',
      'earning trust',
      'emerging trust',
      'established trust',
      'trust depth',
      'Tier progression tracks consistency',
      'not session count alone',
    ];

    it.each(['TIER_1', 'TIER_2', 'TIER_3'] as const)('%s tier blocks contain no trust-based language', (tier) => {
      const prompt = PromptTemplateBuilder.build(defaultState, defaultETV, {
        guidanceMode: 'CALM_NEUTRAL',
        tierContext: { tier, description: 'test', sessionCount: 3 },
      });
      const trajectoryStart = prompt.indexOf('RELATIONAL TRAJECTORY');
      const policyEnd = prompt.indexOf('BAND CALIBRATION');
      if (trajectoryStart >= 0 && policyEnd >= 0) {
        const tierSection = prompt.slice(trajectoryStart, policyEnd).toLowerCase();
        for (const phrase of trustPhrases) {
          expect(tierSection).not.toContain(phrase.toLowerCase());
        }
      }
    });

    it('RELATIONAL CONTEXT header does not use "Trust depth"', () => {
      const prompt = PromptTemplateBuilder.build(defaultState, defaultETV, {
        guidanceMode: 'CALM_NEUTRAL',
        tierContext: { tier: 'TIER_1', description: 'Conservative', sessionCount: 1 },
      });
      expect(prompt).not.toContain('Trust depth:');
      expect(prompt).toContain('Engagement depth:');
    });

    it('RESPONSE PRINCIPLES does not reference trust', () => {
      const prompt = PromptTemplateBuilder.build(defaultState, defaultETV, {
        guidanceMode: 'CALM_NEUTRAL',
        tierContext: { tier: 'TIER_1', description: 'Conservative', sessionCount: 1 },
      });
      const principlesStart = prompt.indexOf('RESPONSE PRINCIPLES');
      const principlesEnd = prompt.indexOf('BAND CALIBRATION');
      if (principlesStart >= 0 && principlesEnd >= 0) {
        const section = prompt.slice(principlesStart, principlesEnd);
        expect(section).not.toContain('match trust');
      }
    });
  });

  describe('tier policy differentiation', () => {
    it('TIER_2 prompt is warmer than TIER_1', () => {
      const t1 = PromptTemplateBuilder.build(defaultState, defaultETV, {
        guidanceMode: 'CALM_NEUTRAL',
        tierContext: { tier: 'TIER_1', description: 'Conservative', sessionCount: 1 },
      });
      const t2 = PromptTemplateBuilder.build(defaultState, defaultETV, {
        guidanceMode: 'CALM_NEUTRAL',
        tierContext: { tier: 'TIER_2', description: 'Balanced', sessionCount: 3 },
      });
      expect(t1).toContain('measured and clear');
      expect(t1).not.toContain('Warmer tone');
      expect(t2).toContain('Warmer tone');
      expect(t2).toContain('personalized');
    });

    it('TIER_3 prompt is more direct than TIER_2', () => {
      const t2 = PromptTemplateBuilder.build(defaultState, defaultETV, {
        guidanceMode: 'CALM_NEUTRAL',
        tierContext: { tier: 'TIER_2', description: 'Balanced', sessionCount: 3 },
      });
      const t3 = PromptTemplateBuilder.build(defaultState, defaultETV, {
        guidanceMode: 'CALM_NEUTRAL',
        tierContext: { tier: 'TIER_3', description: 'Direct', sessionCount: 6 },
      });
      expect(t3).toContain('Direct and structured');
      expect(t3).toContain('collegial tone');
      expect(t3).toContain('continuity');
      expect(t2).not.toContain('collegial tone');
    });
  });
});
