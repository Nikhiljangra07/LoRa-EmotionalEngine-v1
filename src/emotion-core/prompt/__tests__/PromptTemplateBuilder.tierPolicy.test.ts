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
      expect(prompt).toContain('Earn trust through clarity and restraint');
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
      expect(prompt).toContain('Balance reasoning with empathy');
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
      expect(prompt).toContain('Logic-forward');
      expect(prompt).toContain('Action-oriented');
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
});
