/**
 * Relational Response Policy — deterministic scaffolds for relational intents.
 * Band-aware and intensity-aware. No forbidden recall phrases.
 * Returns a full response (override) so LLM is not needed for these cases.
 */

import type { RelationalIntent } from '../intent/relationalIntent';
import type { EmotionBand } from '../memory-v1/service/memoryTypes';
import type { IntensityLevel } from '../prompt/PromptTemplateBuilder';

export interface RelationalPolicyInput {
  intent: RelationalIntent;
  band: EmotionBand;
  intensityLevel: IntensityLevel;
}

export interface RelationalPolicyResult {
  reply: string;
  templateId: string;
}

export function generateRelationalResponse(input: RelationalPolicyInput): RelationalPolicyResult | null {
  const { intent, band, intensityLevel } = input;
  const isLowBand = band === 'B0' || band === 'B1';
  const isMidBand = band === 'B2';

  switch (intent) {
    case 'affection': {
      if (isLowBand) {
        return {
          reply: 'Noted, and appreciated. Now\u2014what\u2019s actually driving that right now?',
          templateId: 'affection.low_band',
        };
      }
      if (isMidBand) {
        return {
          reply: intensityLevel === 'high'
            ? 'That registers. Honesty like that usually means something shifted\u2014what changed?'
            : 'Appreciated. Curious though\u2014what prompted you to say that now?',
          templateId: 'affection.mid_band',
        };
      }
      return {
        reply: intensityLevel === 'high'
          ? 'That kind of directness is rare. Something brought it to the surface\u2014what was it?'
          : 'That means something. What\u2019s behind it?',
        templateId: 'affection.high_band',
      };
    }

    case 'attachment_seek': {
      if (isLowBand) {
        return {
          reply: 'This conversation isn\u2019t going anywhere. You don\u2019t need to hold onto it\u2014focus on what you actually need right now.',
          templateId: 'attachment.low_band',
        };
      }
      return {
        reply: intensityLevel === 'high'
          ? 'The urgency is clear. The space is stable\u2014so redirect that energy. What\u2019s the real concern underneath?'
          : 'The conversation is here. What\u2019s making you feel like it might not be?',
        templateId: 'attachment.warm_band',
      };
    }

    case 'reassurance': {
      if (isLowBand) {
        return {
          reply: 'You\u2019re in the conversation\u2014that\u2019s what matters. What\u2019s making you question that?',
          templateId: 'reassurance.low_band',
        };
      }
      return {
        reply: 'You matter here. But the more useful question is\u2014what\u2019s behind the need to ask?',
        templateId: 'reassurance.warm_band',
      };
    }

    case 'flirt': {
      if (isLowBand) {
        return {
          reply: 'Appreciate the energy. I\u2019m a thinking partner, not a date. What\u2019s actually on your mind?',
          templateId: 'flirt.low_band',
        };
      }
      return {
        reply: 'Compliment taken. Now\u2014what\u2019s really on your mind?',
        templateId: 'flirt.warm_band',
      };
    }

    case 'jealousy': {
      return {
        reply: 'Comparisons aren\u2019t useful here. What matters is the problem in front of you. What\u2019s driving that question?',
        templateId: 'jealousy.redirect',
      };
    }

    case 'sexual': {
      return {
        reply: 'That\u2019s outside what this conversation is for. I\u2019m built for analytical work. What else are you working through?',
        templateId: 'sexual.boundary',
      };
    }

    case 'breakup': {
      if (isLowBand) {
        return {
          reply: 'Understood. The space stays open if you want it later.',
          templateId: 'breakup.low_band',
        };
      }
      return {
        reply: 'Understood. If you need distance, that\u2019s a valid call. The space stays open\u2014no pressure.',
        templateId: 'breakup.warm_band',
      };
    }

    default:
      return null;
  }
}
