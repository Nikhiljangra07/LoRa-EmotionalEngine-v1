import {
  buildResponseShapeContract,
  BANNED_PHRASES,
} from '../ResponseShapeContract';
import type { ResponseShapeInput } from '../ResponseShapeContract';

function makeInput(overrides: Partial<ResponseShapeInput> = {}): ResponseShapeInput {
  return {
    band: 'B0',
    guidanceMode: 'CALM_NEUTRAL',
    narrative: {
      phase: 'opening',
      strategy: 'validation',
      theme: null,
      trajectory: 'stable',
    },
    intensityLevel: 'medium',
    ...overrides,
  };
}

describe('buildResponseShapeContract', () => {
  describe('structural requirements', () => {
    it('always includes the 3-part structure requirement', () => {
      const result = buildResponseShapeContract(makeInput());
      expect(result.blockText).toContain('PRESENCE');
      expect(result.blockText).toContain('MOMENTUM');
      expect(result.blockText).toContain('QUESTION');
      expect(result.blockText).toContain('3 parts');
    });

    it('always includes the banned phrase list', () => {
      const result = buildResponseShapeContract(makeInput());
      expect(result.blockText).toContain('HARD BAN');
      for (const phrase of BANNED_PHRASES) {
        expect(result.blockText).toContain(phrase);
      }
    });

    it('returns a non-empty contractId', () => {
      const result = buildResponseShapeContract(makeInput());
      expect(result.contractId).toBeTruthy();
      expect(result.contractId).toContain('rsc.');
    });

    it('contractId encodes strategy, band, intensity', () => {
      const result = buildResponseShapeContract(makeInput({
        band: 'B3',
        narrative: { phase: 'probing', strategy: 'synthesis', theme: 'work', trajectory: 'rising' },
        intensityLevel: 'high',
      }));
      expect(result.contractId).toBe('rsc.synthesis.B3.high');
    });
  });

  describe('strategy-specific contracts', () => {
    it('validation contract contains naming emotion + choice between angles', () => {
      const result = buildResponseShapeContract(makeInput({
        narrative: { phase: 'opening', strategy: 'validation', theme: null, trajectory: 'stable' },
      }));
      expect(result.blockText).toContain('Strategy: VALIDATION');
      expect(result.blockText).toContain('Name the emotion');
      expect(result.blockText).toContain('choice between two');
    });

    it('exploration contract contains spotlighting + lens/frame', () => {
      const result = buildResponseShapeContract(makeInput({
        narrative: { phase: 'probing', strategy: 'exploration', theme: 'work', trajectory: 'stable' },
      }));
      expect(result.blockText).toContain('Strategy: EXPLORATION');
      expect(result.blockText).toContain('spotlight');
      expect(result.blockText).toContain('lens');
    });

    it('synthesis contract contains summarize + structure', () => {
      const result = buildResponseShapeContract(makeInput({
        narrative: { phase: 'probing', strategy: 'synthesis', theme: 'work', trajectory: 'rising' },
      }));
      expect(result.blockText).toContain('Strategy: SYNTHESIS');
      expect(result.blockText).toContain('Summarize');
      expect(result.blockText).toContain('structure');
    });

    it('grounding contract contains stabilize + micro-step', () => {
      const result = buildResponseShapeContract(makeInput({
        narrative: { phase: 'clarifying', strategy: 'grounding', theme: null, trajectory: 'rising' },
      }));
      expect(result.blockText).toContain('Strategy: GROUNDING');
      expect(result.blockText).toContain('Stabilize');
      expect(result.blockText).toContain('micro-step');
    });

    it('reframing contract contains alternative interpretation', () => {
      const result = buildResponseShapeContract(makeInput({
        narrative: { phase: 'deepening', strategy: 'reframing', theme: 'mistake', trajectory: 'stable' },
      }));
      expect(result.blockText).toContain('Strategy: REFRAMING');
      expect(result.blockText).toContain('alternative interpretation');
    });

    it('clarification contract contains two interpretations + forced choice', () => {
      const result = buildResponseShapeContract(makeInput({
        narrative: { phase: 'clarifying', strategy: 'clarification', theme: null, trajectory: 'stable' },
      }));
      expect(result.blockText).toContain('Strategy: CLARIFICATION');
      expect(result.blockText).toContain('two possible interpretations');
      expect(result.blockText).toContain('Force a choice');
    });

    it('planning contract contains two-step sequence + commit', () => {
      const result = buildResponseShapeContract(makeInput({
        narrative: { phase: 'deepening', strategy: 'planning', theme: 'work', trajectory: 'decreasing' },
      }));
      expect(result.blockText).toContain('Strategy: PLANNING');
      expect(result.blockText).toContain('two-step');
      expect(result.blockText).toContain('commit');
    });

    it('different strategies produce different contracts', () => {
      const synthesis = buildResponseShapeContract(makeInput({
        narrative: { phase: 'probing', strategy: 'synthesis', theme: 'work', trajectory: 'rising' },
      }));
      const grounding = buildResponseShapeContract(makeInput({
        narrative: { phase: 'clarifying', strategy: 'grounding', theme: null, trajectory: 'rising' },
      }));
      expect(synthesis.blockText).not.toBe(grounding.blockText);
      expect(synthesis.contractId).not.toBe(grounding.contractId);
    });
  });

  describe('theme awareness', () => {
    it('includes theme in validation contract when present', () => {
      const result = buildResponseShapeContract(makeInput({
        narrative: { phase: 'opening', strategy: 'validation', theme: 'work', trajectory: 'stable' },
      }));
      expect(result.blockText).toContain('about work');
    });

    it('omits theme reference when theme is null', () => {
      const result = buildResponseShapeContract(makeInput({
        narrative: { phase: 'opening', strategy: 'validation', theme: null, trajectory: 'stable' },
      }));
      expect(result.blockText).not.toContain('about null');
    });
  });

  describe('band calibration', () => {
    it('B0 gets restrained warmth', () => {
      const result = buildResponseShapeContract(makeInput({ band: 'B0' }));
      expect(result.blockText).toContain('restrained');
    });

    it('B4 gets full emotional depth', () => {
      const result = buildResponseShapeContract(makeInput({ band: 'B4' }));
      expect(result.blockText).toContain('Fully present');
    });
  });

  describe('intensity overlay', () => {
    it('high intensity gets grounding instruction', () => {
      const result = buildResponseShapeContract(makeInput({ intensityLevel: 'high' }));
      expect(result.blockText).toContain('short and grounded');
    });

    it('low intensity gets calm instruction', () => {
      const result = buildResponseShapeContract(makeInput({ intensityLevel: 'low' }));
      expect(result.blockText).toContain('match the calm');
    });

    it('medium intensity has no explicit intensity overlay', () => {
      const result = buildResponseShapeContract(makeInput({ intensityLevel: 'medium' }));
      expect(result.blockText).not.toContain('Intensity is high');
      expect(result.blockText).not.toContain('Intensity is low');
    });
  });

  describe('safety', () => {
    it('blockText itself never contains any banned phrase verbatim outside the ban list', () => {
      const strategies = ['validation', 'exploration', 'synthesis', 'grounding', 'reframing', 'clarification', 'planning'] as const;
      for (const strategy of strategies) {
        const result = buildResponseShapeContract(makeInput({
          narrative: { phase: 'probing', strategy, theme: 'work', trajectory: 'stable' },
        }));
        const banSection = result.blockText.split('HARD BAN')[1] ?? '';
        const nonBanSection = result.blockText.split('HARD BAN')[0] ?? '';
        for (const phrase of BANNED_PHRASES) {
          expect(nonBanSection.toLowerCase()).not.toContain(phrase.toLowerCase());
        }
      }
    });

    it('unknown strategy falls back to validation', () => {
      const result = buildResponseShapeContract(makeInput({
        narrative: { phase: 'opening', strategy: 'unknown_strategy' as any, theme: null, trajectory: 'stable' },
      }));
      expect(result.blockText).toContain('Strategy: VALIDATION');
    });
  });
});
