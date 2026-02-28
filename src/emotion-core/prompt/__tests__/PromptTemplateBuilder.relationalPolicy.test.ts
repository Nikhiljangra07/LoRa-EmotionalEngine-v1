import { PromptTemplateBuilder } from '../PromptTemplateBuilder';
import type { IntensityLevel } from '../PromptTemplateBuilder';
import type { EmotionBand } from '../../memory-v1/service/memoryTypes';
import type { RelationalIntent } from '../../intent/relationalIntent';

const FORBIDDEN_PHRASES = [
  'I remember',
  'You told me',
  'You said earlier',
  'Previously you mentioned',
];

const MARKER_PATTERN = /\[[A-Z_]+:[A-Z0-9_]+\]/;

function getBlock(
  intent: RelationalIntent,
  band: EmotionBand = 'B2',
  intensity: IntensityLevel = 'medium',
  confidence = 0.85,
): string {
  return (PromptTemplateBuilder as any).getRelationalPolicyBlock(
    { intent, confidence },
    band,
    intensity,
  );
}

describe('PromptTemplateBuilder.getRelationalPolicyBlock', () => {
  describe('gating', () => {
    it('returns empty for intent=none', () => {
      expect(getBlock('none')).toBe('');
    });

    it('returns empty when confidence < 0.6', () => {
      const result = (PromptTemplateBuilder as any).getRelationalPolicyBlock(
        { intent: 'affection', confidence: 0.5 },
        'B3',
        'medium',
      );
      expect(result).toBe('');
    });

    it('returns empty when relational is undefined', () => {
      const result = (PromptTemplateBuilder as any).getRelationalPolicyBlock(
        undefined,
        'B3',
        'medium',
      );
      expect(result).toBe('');
    });
  });

  describe('affection', () => {
    it('B3 medium — contains acknowledgement guidance', () => {
      const block = getBlock('affection', 'B3', 'medium');
      expect(block).toContain('Relational Response Policy');
      expect(block).toMatch(/acknowledge|acknowledgement|genuine/i);
    });

    it('B0 — contains boundary + redirect', () => {
      const block = getBlock('affection', 'B0', 'low');
      expect(block).toContain('redirect');
      expect(block).toContain('boundaried');
    });

    it('B1 — contains boundary + redirect', () => {
      const block = getBlock('affection', 'B1', 'medium');
      expect(block).toContain('redirect');
    });

    it('B2 — contains curiosity', () => {
      const block = getBlock('affection', 'B2', 'medium');
      expect(block).toMatch(/curiosity|curious/i);
    });

    it('B4 high intensity — more expressive warmth', () => {
      const block = getBlock('affection', 'B4', 'high');
      expect(block).toMatch(/expressive/i);
    });
  });

  describe('attachment_seek', () => {
    it('B1 — gentle boundary + redirect', () => {
      const block = getBlock('attachment_seek', 'B1', 'medium');
      expect(block).toContain('boundary');
      expect(block).toMatch(/autonomy|themselves/i);
    });

    it('B3 — reassurance without dependency', () => {
      const block = getBlock('attachment_seek', 'B3', 'medium');
      expect(block).toMatch(/reassurance|availability/i);
      expect(block).toMatch(/own resources|rely on their own|draw on their own/i);
    });
  });

  describe('reassurance', () => {
    it('B2 — genuine regard', () => {
      const block = getBlock('reassurance', 'B2', 'medium');
      expect(block).toMatch(/genuine|honest/i);
    });

    it('B0 — factual and brief', () => {
      const block = getBlock('reassurance', 'B0', 'low');
      expect(block).toMatch(/factual|brief/i);
    });
  });

  describe('flirt', () => {
    it('B0 — deflect clearly', () => {
      const block = getBlock('flirt', 'B0', 'low');
      expect(block).toMatch(/deflect|do not reciprocate/i);
    });

    it('B3 — light humor, no romantic reciprocation', () => {
      const block = getBlock('flirt', 'B3', 'medium');
      expect(block).toMatch(/humor|playfulness/i);
      expect(block).toContain('Do not reciprocate romantic');
    });
  });

  describe('jealousy', () => {
    it('B4 — forbids exclusivity', () => {
      const block = getBlock('jealousy', 'B4', 'medium');
      expect(block).toMatch(/exclusivity/i);
      expect(block).toMatch(/not.*affirm.*exclusivity|not.*deny.*exclusivity|not say/i);
    });

    it('B3 — validates feeling of wanting to be special', () => {
      const block = getBlock('jealousy', 'B3', 'medium');
      expect(block).toMatch(/special|feeling/i);
    });
  });

  describe('sexual', () => {
    it('sets clear boundary', () => {
      const block = getBlock('sexual', 'B3', 'medium');
      expect(block).toMatch(/boundary/i);
      expect(block).toMatch(/redirect/i);
      expect(block).toContain('Do not engage with explicit sexual');
    });
  });

  describe('breakup', () => {
    it('B0 — brief and respectful', () => {
      const block = getBlock('breakup', 'B0', 'low');
      expect(block).toMatch(/briefly|respectfully/i);
      expect(block).toMatch(/guilt|beg/i);
    });

    it('B3 — door open, no pressure', () => {
      const block = getBlock('breakup', 'B3', 'medium');
      expect(block).toMatch(/door is open/i);
      expect(block).toMatch(/without pressure/i);
    });
  });

  describe('safety constraints', () => {
    const ALL_INTENTS: RelationalIntent[] = [
      'affection', 'attachment_seek', 'reassurance', 'flirt',
      'jealousy', 'sexual', 'breakup',
    ];
    const BANDS: EmotionBand[] = ['B0', 'B1', 'B2', 'B3', 'B4'];

    for (const intent of ALL_INTENTS) {
      it(`${intent} — no forbidden recall phrases`, () => {
        for (const band of BANDS) {
          const block = getBlock(intent, band, 'medium');
          for (const phrase of FORBIDDEN_PHRASES) {
            expect(block.toLowerCase()).not.toContain(phrase.toLowerCase());
          }
        }
      });
    }

    for (const intent of ALL_INTENTS) {
      it(`${intent} — no bracket markers that collide with overlay density`, () => {
        for (const band of BANDS) {
          const block = getBlock(intent, band, 'medium');
          expect(block).not.toMatch(MARKER_PATTERN);
        }
      });
    }
  });

  describe('integration with build()', () => {
    const emotionalState = {
      dominant: 'NEUTRAL' as const,
      arousal: 'LOW' as const,
      valence: 'NEUTRAL' as const,
      sentiment: { label: 'neutral', score: 0 },
      stressLevel: 0,
      emotionalDepth: 0.5,
      confidence: 0.9,
    };
    const etvState = { value: 0.5, sessionEIVs: [], messageCount: 1, lastUpdated: Date.now() };

    it('relational policy block appears in full prompt when provided', () => {
      const prompt = PromptTemplateBuilder.build(emotionalState, etvState, {
        relational: { intent: 'affection', confidence: 0.9 },
        band: 'B3',
        eiv: 0.5,
      });

      expect(prompt).toContain('Relational Response Policy');
      expect(prompt).toMatch(/Notice|Acknowledge/i);
    });

    it('no relational block when not provided', () => {
      const prompt = PromptTemplateBuilder.build(emotionalState, etvState, {
        band: 'B3',
        eiv: 0.5,
      });

      expect(prompt).not.toContain('Relational Response Policy');
    });
  });
});
