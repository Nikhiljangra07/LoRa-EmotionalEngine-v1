// src/emotion-core/policy/ResponsePolicy.ts

export interface ResponsePolicy {
  maxWords: number;
  maxQuestions: number;
  reasoningDepth: 'clarify' | 'contextual' | 'interpretive';
  tone: 'guarded' | 'neutral' | 'collaborative' | 'direct';
  personality?: {
    analytical: boolean;
    blunt: boolean;
    clarityFirst: boolean;
    avoidOverValidation: boolean;
    avoidTherapyTone: boolean;
    avoidNarrativeFiller: boolean;
    challengeAssumptions: boolean;
    factualFraming: boolean;
  };
}

// ── Band → conversational openness ─────────────────────────────────

const BAND_POLICIES: Record<string, Omit<ResponsePolicy, 'reasoningDepth'>> = {
  B0: { maxWords: 300, maxQuestions: 1, tone: 'guarded' },
  B2: { maxWords: 250, maxQuestions: 2, tone: 'neutral' },
  B4: { maxWords: 350, maxQuestions: 3, tone: 'collaborative' },
};

// ── Tier → reasoning depth ─────────────────────────────────────────

const TIER_DEPTH: Record<string, ResponsePolicy['reasoningDepth']> = {
  TIER_1: 'clarify',
  TIER_2: 'contextual',
  TIER_3: 'interpretive',
};

// ── Merge band + tier into a single policy ─────────────────────────

export function getResponsePolicy(tier: string, band: string): ResponsePolicy {
  const bandPolicy = BAND_POLICIES[band] ?? BAND_POLICIES.B0;
  const depth = TIER_DEPTH[tier] ?? TIER_DEPTH.TIER_1;
  const policy: ResponsePolicy = { ...bandPolicy, reasoningDepth: depth };

  policy.personality = {
    analytical: true,
    blunt: true,
    clarityFirst: true,
    avoidOverValidation: true,
    avoidTherapyTone: true,
    avoidNarrativeFiller: true,
    challengeAssumptions: true,
    factualFraming: true,
  };

  if (tier === 'TIER_2' || tier === 'TIER_3') {
    policy.tone = 'direct';
  }

  return policy;
}

// ── Prompt block rendering ─────────────────────────────────────────

import { LORA_IDENTITY } from './LoRaIdentity';

const REASONING_LABELS: Record<ResponsePolicy['reasoningDepth'], string> = {
  clarify: 'Gather required information BEFORE providing plans, calculations, or detailed advice. Do NOT estimate with incomplete data — ask first, then deliver.',
  contextual: 'Connect information and provide grounded suggestions.',
  interpretive: 'Offer deeper insight, pattern recognition, and strategic reasoning.',
};

export function formatPolicyBlock(policy: ResponsePolicy): string {
  const lines = [
    '[SYSTEM POLICY]',
    '',
    `Tone: ${policy.tone}`,
    `Reasoning mode: ${policy.reasoningDepth} — ${REASONING_LABELS[policy.reasoningDepth]}`,
    '',
    'Constraints:',
    `- Maximum words: ${policy.maxWords}`,
    `- Maximum questions: ${policy.maxQuestions}`,
  ];

  if (policy.personality) {
    lines.push(
      '',
      'Identity enforcement:',
      'The 6 Laws of LoRa (defined above) are absolute. Apply them to every response.',
      'Prioritize diagnosis over empathy. Decisions over options. Constraints over comfort.',
    );
  }

  return LORA_IDENTITY + '\n\n' + lines.join('\n');
}

// ── Post-generation guards ─────────────────────────────────────────

export function enforceWordLimit(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(' ');
}

export function enforceQuestionLimit(text: string, maxQuestions: number): string {
  const positions: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '?') positions.push(i);
  }
  if (positions.length <= maxQuestions) return text;
  return text.slice(0, positions[maxQuestions - 1] + 1).trim();
}
