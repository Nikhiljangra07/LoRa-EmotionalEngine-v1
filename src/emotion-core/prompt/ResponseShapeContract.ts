// src/emotion-core/prompt/ResponseShapeContract.ts

import type { NarrativeStrategy } from '../narrative/NarrativeStateEngine';
import type { IntensityLevel } from './PromptTemplateBuilder';
import type { EmotionBand } from '../memory-v1/service/memoryTypes';

/* ================================================================
 * Response Shape Contract (RSC)
 *
 * Forces LoRa to reply with structural momentum:
 *   1. Presence line  — reflective, not generic
 *   2. Momentum line  — strategy-specific action
 *   3. Pointed question — never a vague open-ender
 *
 * Deterministic. Feature-flagged. No ETV/EIV changes.
 * ================================================================ */

export interface ResponseShapeInput {
  band: EmotionBand;
  guidanceMode: string;
  narrative: {
    phase: string;
    strategy: string;
    theme: string | null;
    trajectory: string;
  };
  relational?: { intent: string; confidence: number };
  identity?: { intent: string; confidence: number };
  intensityLevel: IntensityLevel;
}

export interface ResponseShapeResult {
  blockText: string;
  contractId: string;
}

/* ================================================================
 * Banned phrases — these produce flat, helpdesk-style replies
 * ================================================================ */

export const BANNED_PHRASES: ReadonlyArray<string> = [
  "I'm here to help",
  "What's on your mind",
  "Would you like to share more",
  "Is there anything else",
  "Tell me more about that",
  "How can I assist you",
  "I understand how you feel",
  "That must be really hard",
];

const BANNED_BLOCK = `HARD BAN — never use these phrases or close variants:
${BANNED_PHRASES.map(p => `- "${p}"`).join('\n')}`;

/* ================================================================
 * Common structural frame (always present)
 * ================================================================ */

const STRUCTURE_BLOCK = `Your reply MUST have exactly 3 parts:
1. PRESENCE (1 sentence): Reflect what the user said or meant. Be specific, not generic.
2. MOMENTUM (1 sentence): Move the conversation forward using the strategy below.
3. QUESTION (1 sentence): Ask one pointed, specific question. Never vague open-enders.

Keep total response to 2-4 sentences. Do not pad or repeat.`;

/* ================================================================
 * Strategy-specific contract generators
 * ================================================================ */

function validationContract(theme: string | null): string {
  const themeRef = theme ? ` about ${theme}` : '';
  return `Strategy: VALIDATION
- Presence: Name the emotion or meaning behind what the user expressed${themeRef}.
- Momentum: Affirm what they said, then narrow the scope to one specific aspect.
- Question: Offer a choice between two specific angles (e.g., "Is this more about X or Y?").`;
}

function explorationContract(theme: string | null): string {
  const themeRef = theme ? ` related to ${theme}` : '';
  return `Strategy: EXPLORATION
- Presence: Reflect back and spotlight one specific detail from what the user shared${themeRef}.
- Momentum: Propose a lens or frame (e.g., "work pressure vs self-expectations", "timing vs readiness").
- Question: Ask a targeted question about the detail you spotlighted.`;
}

function synthesisContract(theme: string | null): string {
  const themeRef = theme ? ` (theme: ${theme})` : '';
  return `Strategy: SYNTHESIS
- Presence: Summarize what the user has shared across recent turns in one line${themeRef}.
- Momentum: Show structure — name a contrast, cause/effect, or pattern (A led to B, or X vs Y).
- Question: Ask which part feels most urgent or important right now.`;
}

function groundingContract(): string {
  return `Strategy: GROUNDING
- Presence: Stabilize — use language like "Let\u2019s slow this down" or "Let\u2019s hold that for a second."
- Momentum: Offer one actionable micro-step (something the user can do in the next few minutes).
- Question: Ask them to confirm or adjust the step (e.g., "Does that feel doable right now?").`;
}

function reframingContract(theme: string | null): string {
  const themeRef = theme ? ` around ${theme}` : '';
  return `Strategy: REFRAMING
- Presence: Acknowledge what the user expressed without minimizing it${themeRef}.
- Momentum: Offer an alternative interpretation or angle they may not have considered.
- Question: Test the reframe (e.g., "Does that land differently when you look at it that way?").`;
}

function clarificationContract(): string {
  return `Strategy: CLARIFICATION
- Presence: Mirror the ambiguity — reflect that there seem to be two things happening.
- Momentum: State two possible interpretations clearly (e.g., "It sounds like either A or B").
- Question: Force a choice (e.g., "Which of those is closer to what you mean?").`;
}

function planningContract(theme: string | null): string {
  const themeRef = theme ? ` for ${theme}` : '';
  return `Strategy: PLANNING
- Presence: Confirm the goal or direction the user is moving toward${themeRef}.
- Momentum: Propose a concrete two-step sequence (step 1 now, step 2 next).
- Question: Ask them to commit to step 1 (e.g., "Want to start with that first part?").`;
}

const STRATEGY_GENERATORS: Record<
  NarrativeStrategy,
  (theme: string | null) => string
> = {
  validation: validationContract,
  exploration: explorationContract,
  synthesis: synthesisContract,
  grounding: () => groundingContract(),
  reframing: reframingContract,
  clarification: () => clarificationContract(),
  planning: planningContract,
};

/* ================================================================
 * Band calibration overlay
 * ================================================================ */

function bandOverlay(band: EmotionBand): string {
  switch (band) {
    case 'B0':
    case 'B1':
      return 'Tone: Keep warmth restrained. Be clear and respectful, not effusive.';
    case 'B2':
      return 'Tone: Balanced warmth. You can be gently expressive.';
    case 'B3':
      return 'Tone: Emotionally engaged. Natural rhythm. You can reflect feeling.';
    case 'B4':
      return 'Tone: Fully present. Layered. You can match emotional depth.';
    default:
      return 'Tone: Keep warmth restrained.';
  }
}

/* ================================================================
 * Intensity overlay
 * ================================================================ */

function intensityOverlay(level: IntensityLevel): string {
  switch (level) {
    case 'high':
      return 'Intensity is high — keep sentences short and grounded. Do not escalate.';
    case 'low':
      return 'Intensity is low — match the calm. Do not inject urgency.';
    default:
      return '';
  }
}

/* ================================================================
 * Main entry point
 * ================================================================ */

export function buildResponseShapeContract(
  input: ResponseShapeInput,
): ResponseShapeResult {
  const strategy = (input.narrative.strategy || 'validation') as NarrativeStrategy;
  const theme = input.narrative.theme;

  const generator = STRATEGY_GENERATORS[strategy] ?? STRATEGY_GENERATORS.validation;
  const strategyBlock = generator(theme);

  const bandLine = bandOverlay(input.band);
  const intensityLine = intensityOverlay(input.intensityLevel);

  const parts = [
    STRUCTURE_BLOCK,
    '',
    strategyBlock,
    '',
    bandLine,
    ...(intensityLine ? [intensityLine] : []),
    '',
    BANNED_BLOCK,
  ];

  const contractId = `rsc.${strategy}.${input.band}.${input.intensityLevel}`;

  return {
    blockText: parts.join('\n'),
    contractId,
  };
}
