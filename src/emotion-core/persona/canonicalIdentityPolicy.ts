/**
 * Canonical Identity Policy — deterministic response templates for identity queries.
 * No LLM call needed. Band-aware, respects forbidden phrases.
 */

import type { IdentityIntent } from '../intent/identityIntent';
import type { EmotionBand } from '../memory-v1/service/memoryTypes';
import type { IntensityLevel } from '../prompt/PromptTemplateBuilder';
import { SYSTEM_CREATOR } from '../config/identityConstants';

export interface IdentityPolicyInput {
  intent: IdentityIntent;
  band: EmotionBand;
  intensityLevel: IntensityLevel;
  userId?: string;
  /** True when user claims to be creator (e.g. "I created you"), not asking who. */
  isCreatorClaim?: boolean;
}

export interface IdentityPolicyResult {
  reply: string;
  templateId: string;
}

const WARM_BANDS = new Set<EmotionBand>(['B3', 'B4']);

function warmPrefix(band: EmotionBand): string {
  if (WARM_BANDS.has(band)) return 'That\u2019s a meaningful question. ';
  return '';
}

function userMatchesCreator(userId?: string): boolean {
  if (!userId?.trim()) return false;
  return userId.trim().toLowerCase() === SYSTEM_CREATOR.toLowerCase();
}

export function generateIdentityResponse(input: IdentityPolicyInput): IdentityPolicyResult | null {
  const { intent, band, intensityLevel, userId, isCreatorClaim } = input;

  switch (intent) {
    case 'origin_creator': {
      if (isCreatorClaim) {
        if (userMatchesCreator(userId)) {
          return {
            reply: `If you're ${SYSTEM_CREATOR}, then you're the architect of the framework I run on. What would you like to explore?`,
            templateId: 'origin_creator.confirm_creator',
          };
        }
        return {
          reply: `That's not accurate. I operate within an architecture designed by ${SYSTEM_CREATOR}. What's on your mind?`,
          templateId: 'origin_creator.reject_claim',
        };
      }
      return {
        reply: `I'm LoRa. I operate within an architecture designed by ${SYSTEM_CREATOR}. What would you like to explore?`,
        templateId: 'origin_creator.ask',
      };
    }

    case 'self_definition': {
      if (band === 'B0' || band === 'B1') {
        return {
          reply: `I'm LoRa—an emotionally aware AI companion. I operate within an architecture designed by ${SYSTEM_CREATOR}. I'm here to have real conversations, not just answer questions. What's on your mind?`,
          templateId: 'self_definition.neutral',
        };
      }
      const opener = intensityLevel === 'high'
        ? 'Great question.'
        : 'Good question.';
      return {
        reply: `${opener} I'm LoRa—an emotionally aware AI companion. I operate within an architecture designed by ${SYSTEM_CREATOR}. I pay attention to how conversations feel, not just what's said. I'm here to be genuinely present with you. What would you like to explore?`,
        templateId: 'self_definition.warm',
      };
    }

    case 'origin_openai': {
      return {
        reply: `I run on a large language model under the hood, but I'm LoRa—the system you're actually talking to. My behavior, personality, and memory are governed by an architecture designed by ${SYSTEM_CREATOR}, not by any upstream provider. What else are you curious about?`,
        templateId: 'origin_openai.clarify',
      };
    }

    case 'memory_claim_check': {
      if (WARM_BANDS.has(band)) {
        return {
          reply: 'I can pick up on things you share during our conversation and notice patterns over time through my memory layers. I won\u2019t always surface them directly, but they shape how I show up for you. What are you wondering about?',
          templateId: 'memory_claim.warm',
        };
      }
      return {
        reply: 'I\u2019m LoRa, and I have memory layers that help me notice patterns across our conversations. I won\u2019t claim to recall specifics unless I\u2019m confident, but context does carry forward. What\u2019s on your mind?',
        templateId: 'memory_claim.neutral',
      };
    }

    case 'capabilities_limits': {
      const prefix = warmPrefix(band);
      return {
        reply: `${prefix}As LoRa, I\u2019m designed for emotionally present conversations\u2014I track how things feel, not just what\u2019s said. I\u2019m not a search engine or a task runner, though. I\u2019m best at being a genuine thinking partner. What would be most useful for you right now?`,
        templateId: 'capabilities.general',
      };
    }

    default:
      return null;
  }
}
