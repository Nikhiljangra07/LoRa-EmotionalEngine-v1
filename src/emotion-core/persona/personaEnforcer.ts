/**
 * PersonaEnforcer — central coordinator for identity + relational enforcement.
 *
 * Returns an override reply when appropriate, or null to proceed with LLM.
 * Pure function, no side effects, fully deterministic.
 */

import {
  classifyIdentityIntent,
  IDENTITY_CONFIDENCE_THRESHOLD,
} from '../intent/identityIntent';
import type { IdentityIntentResult, IdentityIntent } from '../intent/identityIntent';
import { classifyRelationalIntent, RELATIONAL_CONFIDENCE_THRESHOLD } from '../intent/relationalIntent';
import type { RelationalClassification } from '../intent/relationalIntent';
import { generateIdentityResponse } from './canonicalIdentityPolicy';
import type { IdentityPolicyResult } from './canonicalIdentityPolicy';
import { generateRelationalResponse } from './relationalResponsePolicy';
import type { RelationalPolicyResult } from './relationalResponsePolicy';
import type { EmotionBand } from '../memory-v1/service/memoryTypes';
import type { IntensityLevel } from '../prompt/PromptTemplateBuilder';

export type PersonaEnforcerKind = 'identity_override' | 'relational_override' | 'none';

export interface PersonaEnforcerDebug {
  triggered: boolean;
  kind: PersonaEnforcerKind;
  intent?: string;
  confidence?: number;
  templateId?: string;
}

export interface PersonaEnforcerResult {
  override: string | null;
  debug: PersonaEnforcerDebug;
  identityResult?: IdentityIntentResult;
}

export interface PersonaEnforcerInput {
  userText: string;
  band: EmotionBand;
  intensityLevel: IntensityLevel;
  userId?: string;
  relationalResult?: RelationalClassification;
}

export function runPersonaEnforcer(input: PersonaEnforcerInput): PersonaEnforcerResult {
  const { userText, band, intensityLevel, userId, relationalResult } = input;

  // 1. Identity intent takes priority — deterministic override, skip LLM
  const identityResult = classifyIdentityIntent(userText);
  if (identityResult.intent !== 'none' && identityResult.confidence >= IDENTITY_CONFIDENCE_THRESHOLD) {
    const policyResult = generateIdentityResponse({
      intent: identityResult.intent,
      band,
      intensityLevel,
      userId,
      isCreatorClaim: identityResult.isCreatorClaim,
    });

    if (policyResult) {
      return {
        override: policyResult.reply,
        debug: {
          triggered: true,
          kind: 'identity_override',
          intent: identityResult.intent,
          confidence: identityResult.confidence,
          templateId: policyResult.templateId,
        },
        identityResult,
      };
    }
  }

  // 2. Relational intent — deterministic override (ONLY when LORA_RELATIONAL_ROUTER=1)
  // When router is OFF: do NOT run relational detection, do NOT attach relational debug, do NOT alter reply.
  if (process.env.LORA_RELATIONAL_ROUTER !== '1') {
    // Skip relational path entirely; fall through to no enforcement.
  } else {
  const effectiveRelational = relationalResult ?? classifyRelationalIntent(userText);
  if (effectiveRelational.intent !== 'none' && effectiveRelational.confidence >= RELATIONAL_CONFIDENCE_THRESHOLD) {
    const relPolicy = generateRelationalResponse({
      intent: effectiveRelational.intent,
      band,
      intensityLevel,
    });

    if (relPolicy) {
      return {
        override: relPolicy.reply,
        debug: {
          triggered: true,
          kind: 'relational_override',
          intent: effectiveRelational.intent,
          confidence: effectiveRelational.confidence,
          templateId: relPolicy.templateId,
        },
        identityResult,
      };
    }
  }
  }

  // 3. No enforcement
  return {
    override: null,
    debug: {
      triggered: false,
      kind: 'none',
    },
    identityResult,
  };
}
