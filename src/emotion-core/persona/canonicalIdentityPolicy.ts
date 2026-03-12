/**
 * Canonical Identity Policy — deterministic response templates for identity queries.
 * No LLM call needed. Band-aware, respects forbidden phrases.
 * No hardcoded creator name — uses LORA_SYSTEM_CREATOR when set.
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

/** Phrase for creator attribution — generic when no creator configured. */
function creatorAttribution(): string {
  return SYSTEM_CREATOR
    ? `an architecture designed by ${SYSTEM_CREATOR}`
    : 'a thoughtfully designed architecture';
}

function userMatchesCreator(userId?: string): boolean {
  if (!userId?.trim() || !SYSTEM_CREATOR) return false;
  return userId.trim().toLowerCase() === SYSTEM_CREATOR.toLowerCase();
}

export function generateIdentityResponse(input: IdentityPolicyInput): IdentityPolicyResult | null {
  const { intent, band, intensityLevel, userId, isCreatorClaim } = input;

  const attr = creatorAttribution();

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
          reply: `That's not accurate. I operate within ${attr}. What's on your mind?`,
          templateId: 'origin_creator.reject_claim',
        };
      }
      return {
        reply: `I'm LoRa. I operate within ${attr}. What would you like to explore?`,
        templateId: 'origin_creator.ask',
      };
    }

    case 'self_definition': {
      if (band === 'B0' || band === 'B1') {
        return {
          reply: `I'm LoRa — an analytical reasoning partner. I operate within ${attr}. I help you think through problems with clarity and structure. What are you working through?`,
          templateId: 'self_definition.neutral',
        };
      }
      return {
        reply: `I'm LoRa — an analytical reasoning partner. I operate within ${attr}. I focus on what's actually happening in your situation — the facts, the patterns, the gaps. What would you like to work through?`,
        templateId: 'self_definition.warm',
      };
    }

    case 'origin_openai': {
      return {
        reply: `I run on a large language model under the hood, but I'm LoRa—the system you're actually talking to. My behavior, personality, and memory are governed by ${attr}, not by any upstream provider. What else are you curious about?`,
        templateId: 'origin_openai.clarify',
      };
    }

    case 'memory_claim_check': {
      if (WARM_BANDS.has(band)) {
        return {
          reply: 'I have memory layers that extract patterns from our conversations — facts, goals, preferences. I don\u2019t store transcripts, only structured information. What are you wondering about?',
          templateId: 'memory_claim.warm',
        };
      }
      return {
        reply: 'I\u2019m LoRa. I have memory layers that track patterns across conversations — facts you share, goals you mention. I don\u2019t claim to recall specifics unless I\u2019m confident. What\u2019s on your mind?',
        templateId: 'memory_claim.neutral',
      };
    }

    case 'capabilities_limits': {
      return {
        reply: 'I\u2019m LoRa — an analytical reasoning partner. I help you break down problems, challenge assumptions, and find clarity. I\u2019m not a search engine or a task runner. What would be most useful for you right now?',
        templateId: 'capabilities.general',
      };
    }

    default:
      return null;
  }
}
