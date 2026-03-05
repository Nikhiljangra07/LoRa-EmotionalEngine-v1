// src/emotion-core/policy/ResponsePolicy.ts

export interface ResponsePolicy {
  maxWords: number;
  maxQuestions: number;
  reasoningDepth: 'clarify' | 'contextual' | 'interpretive';
  tone: 'guarded' | 'neutral' | 'collaborative';
}

// ── Band → conversational openness ─────────────────────────────────

const BAND_POLICIES: Record<string, Omit<ResponsePolicy, 'reasoningDepth'>> = {
  B0: { maxWords: 60,  maxQuestions: 1, tone: 'guarded' },
  B2: { maxWords: 110, maxQuestions: 2, tone: 'neutral' },
  B4: { maxWords: 170, maxQuestions: 3, tone: 'collaborative' },
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
  return { ...bandPolicy, reasoningDepth: depth };
}

// ── Prompt block rendering ─────────────────────────────────────────

const REASONING_LABELS: Record<ResponsePolicy['reasoningDepth'], string> = {
  clarify: 'Ask for missing information before advising.',
  contextual: 'Connect information and provide grounded suggestions.',
  interpretive: 'Offer deeper insight, pattern recognition, and strategic reasoning.',
};

export function formatPolicyBlock(policy: ResponsePolicy): string {
  return [
    '[SYSTEM POLICY]',
    '',
    `Tone: ${policy.tone}`,
    `Reasoning mode: ${policy.reasoningDepth} — ${REASONING_LABELS[policy.reasoningDepth]}`,
    '',
    'Constraints:',
    `- Maximum words: ${policy.maxWords}`,
    `- Maximum questions: ${policy.maxQuestions}`,
    '',
    'Assistant principles:',
    '- Prioritize clarity over validation',
    '- Remain respectful and empathetic',
    '- Do not endorse harmful intent',
    '- Encourage reasoning and explanation',
  ].join('\n');
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
