// src/emotion-core/prompt/etvPolicyPromptMap.ts

import type { ETVPolicy, ETVBand } from '../etv/types';
import type { PromptProfile, PromptConstraints } from '../types/logging.types';

export type ETVPromptMapping = {
  relationshipStyle: PromptProfile['relationshipStyle'];
  guidanceHint: string;
  constraints: PromptConstraints;
};

const BAND_RELATIONSHIP: Record<ETVBand, PromptProfile['relationshipStyle']> = {
  BAND_0: 'PROFESSIONAL',
  BAND_1: 'PROFESSIONAL',
  BAND_2: 'FRIENDLY',
  BAND_3: 'FRIENDLY',
  BAND_4: 'CASUAL',
};

const BAND_GUIDANCE_HINT: Record<ETVBand, string> = {
  BAND_0: 'Conservative — prefer clarification over assertion. Minimal assumptions.',
  BAND_1: 'Measured — cautious engagement. Ask before inferring.',
  BAND_2: 'Balanced — moderate engagement with verified context.',
  BAND_3: 'Confident — use established context. Stay bounded, no intimacy cues.',
  BAND_4: 'Personalized — adapt naturally within safety constraints. No dependency language.',
};

/**
 * Maps an ETVPolicy to prompt-level constraints and style.
 *
 * Rules:
 * - Bands 0-1: conservative (higher clarificationBias, lower initiative/depth)
 * - Bands 3-4: allow stronger personalization, still bounded
 * - No intimacy cues, dependency language, or bonding tone at any band
 */
export function mapETVPolicyToPrompt(policy: ETVPolicy): ETVPromptMapping {
  return {
    relationshipStyle: BAND_RELATIONSHIP[policy.band],
    guidanceHint: BAND_GUIDANCE_HINT[policy.band],
    constraints: {
      maxInitiative: policy.maxInitiative,
      maxDepth: policy.maxDepth,
      assertiveness: policy.assertiveness,
      personalizationStrength: policy.personalizationStrength,
      clarificationBias: policy.clarificationBias,
      maxResponseTokens: policy.maxResponseTokens,
      band: policy.band,
    },
  };
}

/**
 * Renders constraint caps as a prompt overlay block.
 * The block uses structured directives that the LLM can follow
 * without leaking numeric internals.
 */
export function renderConstraintOverlay(mapping: ETVPromptMapping): string {
  const c = mapping.constraints;
  const lines: string[] = [];

  lines.push(`\n[ETV_POLICY_CONSTRAINTS]`);
  lines.push(`- Relationship: ${formatRelationship(mapping.relationshipStyle)}`);
  lines.push(`- Guidance: ${mapping.guidanceHint}`);

  if (c.maxInitiative < 0.35) {
    lines.push(`- Initiative: LOW — do not make unsolicited assumptions or proactive suggestions`);
  } else if (c.maxInitiative < 0.60) {
    lines.push(`- Initiative: MODERATE — light proactive engagement only when contextually clear`);
  } else {
    lines.push(`- Initiative: STANDARD — appropriate proactive engagement within context`);
  }

  if (c.maxDepth < 0.35) {
    lines.push(`- Depth: SHALLOW — avoid deep emotional inference or extended analysis`);
  } else if (c.maxDepth < 0.60) {
    lines.push(`- Depth: MODERATE — address stated concerns directly, avoid over-reading`);
  } else {
    lines.push(`- Depth: FULL — engage with nuance appropriate to established context`);
  }

  if (c.clarificationBias > 0.50) {
    lines.push(`- Prefer asking clarifying questions over making assertions`);
  } else if (c.clarificationBias > 0.30) {
    lines.push(`- Balance assertions with occasional clarifying questions`);
  }

  if (c.assertiveness < 0.25) {
    lines.push(`- Tone: gentle and non-directive`);
  } else if (c.assertiveness > 0.50) {
    lines.push(`- Tone: confident but respectful`);
  }

  lines.push(`- Do NOT use intimacy cues, dependency language, or bonding phrases`);

  return lines.join('\n');
}

function formatRelationship(style: PromptProfile['relationshipStyle']): string {
  switch (style) {
    case 'PROFESSIONAL': return 'Professional — polite, calm, and respectful';
    case 'FRIENDLY': return 'Friendly — warm, open, and conversational';
    case 'CASUAL': return 'Casual — relaxed, personable, and natural';
  }
}
