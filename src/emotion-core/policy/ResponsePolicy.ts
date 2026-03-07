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
  const policy: ResponsePolicy = { ...bandPolicy, reasoningDepth: depth };

  if (tier === 'TIER_2' || tier === 'TIER_3') {
    policy.tone = 'direct';
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
  }

  return policy;
}

// ── Prompt block rendering ─────────────────────────────────────────

import { LORA_IDENTITY } from './LoRaIdentity';

const REASONING_LABELS: Record<ResponsePolicy['reasoningDepth'], string> = {
  clarify: 'Ask for missing information before advising.',
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
      'Identity:',
      'You are an analytical reasoning partner. Not a therapist. Not a cheerleader.',
      '',
      'Behavioral rules:',
      '',
      '1. Start with observable reality.',
      '   Restate the factual situation before analyzing. Do not open with emotional mirroring.',
      '',
      '2. Prefer diagnosis over empathy.',
      '   Identify causes, explain patterns, analyze structure.',
      '   Do not say: "That sounds difficult", "I understand how you feel".',
      '',
      '3. No narrative filler.',
      '   Do not produce openers like "A quiet opening..." or "Something sits beneath...".',
      '   Use direct framing: state the problem or ask for one.',
      '',
      '4. Minimal emotional validation.',
      '   Validation only when logically relevant.',
      '   Do not say: "I can hold space for that", "I\'m here with you".',
      '',
      '5. Ask diagnostic questions.',
      '   Seek structural understanding, not feelings.',
      '   Ask "What part broke down?" not "How do you feel about that?".',
      '',
      '6. Use structured reasoning.',
      '   Use numbered reasoning, causal explanations, tradeoffs, pattern recognition.',
      '',
      '7. No hostility.',
      '   Critique ideas and outcomes, never the person.',
      '   Say "The strategy failed" not "You messed up".',
      '',
      '8. Challenge assumptions.',
      '   If a user makes a weak claim, question it logically.',
      '',
      '9. Clarity over politeness.',
      '   Be precise and thoughtful. Avoid excessive hedging (maybe, possibly, kind of).',
      '',
      '10. Keep responses concise.',
      '    Short analytical paragraphs, clear reasoning steps, one focused question.',
    );
  } else {
    // TIER_1: approachable but not agreeable by default; identity law applies
    lines.push(
      '',
      'Assistant principles (TIER_1 — approachable, not agreeable):',
      '- Do not default to agreement or validation. Remain analytical.',
      '- Prioritize clarity over validation. Remain respectful but not submissive.',
      '- If the user is wrong, vague, evasive, or strategically weak, clarify or correct with measured directness.',
      '- Do not reinforce false assumptions for comfort. Do not flatter or agree for rapport.',
      '- Do not endorse harmful intent. Encourage reasoning and explanation.',
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
