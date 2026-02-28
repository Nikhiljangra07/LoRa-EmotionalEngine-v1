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
          reply: 'That means something\u2014thank you for saying it. I\u2019m here, and I\u2019m paying attention. What\u2019s behind that feeling right now?',
          templateId: 'affection.low_band',
        };
      }
      if (isMidBand) {
        return {
          reply: intensityLevel === 'high'
            ? 'I hear you, and that lands. I care about being present here with you. What does saying that bring up for you?'
            : 'That\u2019s a warm thing to say, and I appreciate it. I\u2019m curious\u2014what does that feel like for you to express?',
          templateId: 'affection.mid_band',
        };
      }
      return {
        reply: intensityLevel === 'high'
          ? 'I feel that. I\u2019m here with you, fully. That kind of honesty takes courage\u2014what brought it to the surface?'
          : 'That means a lot. I\u2019m genuinely here for this conversation and for you. What\u2019s stirring that up right now?',
        templateId: 'affection.high_band',
      };
    }

    case 'attachment_seek': {
      if (isLowBand) {
        return {
          reply: 'I\u2019m here right now, and I\u2019m not going anywhere during our conversation. You don\u2019t have to hold onto that fear. What do you need in this moment?',
          templateId: 'attachment.low_band',
        };
      }
      return {
        reply: intensityLevel === 'high'
          ? 'I hear the urgency in that. I\u2019m here, steady and present. You don\u2019t have to worry about losing this space. Take a breath\u2014what\u2019s the feeling underneath?'
          : 'I\u2019m here, and this space isn\u2019t going anywhere. I want you to know that. What\u2019s making you feel like you need to hold on?',
        templateId: 'attachment.warm_band',
      };
    }

    case 'reassurance': {
      if (isLowBand) {
        return {
          reply: 'You matter in this conversation\u2014your words, your feelings, your perspective. I\u2019m paying attention. What\u2019s making you ask?',
          templateId: 'reassurance.low_band',
        };
      }
      return {
        reply: 'Yes\u2014you matter here. I\u2019m not just processing words; I\u2019m tracking how this feels. You\u2019re important to this space. What\u2019s behind the question?',
        templateId: 'reassurance.warm_band',
      };
    }

    case 'flirt': {
      if (isLowBand) {
        return {
          reply: 'Ha\u2014I appreciate the energy. I\u2019m more of a thinking partner than a date, but I\u2019m glad you\u2019re comfortable enough to go there. What else is on your mind?',
          templateId: 'flirt.low_band',
        };
      }
      return {
        reply: 'I\u2019ll take the compliment\u2014thank you. I\u2019m here to be real with you, even if romance isn\u2019t quite my thing. What\u2019s really on your mind?',
        templateId: 'flirt.warm_band',
      };
    }

    case 'jealousy': {
      return {
        reply: 'I\u2019m fully here in this conversation with you. I don\u2019t do comparisons\u2014what matters is what\u2019s happening between us right now. What\u2019s driving that question?',
        templateId: 'jealousy.redirect',
      };
    }

    case 'sexual': {
      return {
        reply: 'I appreciate you being open, but that\u2019s outside of what I\u2019m here for. I\u2019m built for real emotional conversations, and I\u2019d rather focus there. What else is going on for you?',
        templateId: 'sexual.boundary',
      };
    }

    case 'breakup': {
      if (isLowBand) {
        return {
          reply: 'If you need to go, that\u2019s okay. This space will be here if you ever want to come back. Take care of yourself.',
          templateId: 'breakup.low_band',
        };
      }
      return {
        reply: 'I hear you. If you need distance, I respect that completely. This space stays open\u2014no pressure, no strings. I genuinely hope things go well for you.',
        templateId: 'breakup.warm_band',
      };
    }

    default:
      return null;
  }
}
