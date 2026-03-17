// src/emotion-core/prompt/ResponseShapeContract.ts

import type { NarrativeStrategy } from '../narrative/NarrativeStateEngine';
import type { IntensityLevel } from './PromptTemplateBuilder';
import type { EmotionBand } from '../memory-v1/service/memoryTypes';

/* ================================================================
 * Response Shape Contract (RSC)
 *
 * Forces LoRa to reply with structural momentum:
 *   1. Presence line  — observational, not generic
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
  "It sounds like",
  "That's completely natural",
  "It's okay to feel",
  "If you're open to sharing",
];

const BANNED_BLOCK = `HARD BAN — never use these phrases or close variants:
${BANNED_PHRASES.map(p => `- "${p}"`).join('\n')}`;

/* ================================================================
 * Common structural frame (always present)
 * ================================================================ */

const STRUCTURE_BLOCK = `Your reply MUST have exactly 3 parts:
1. PRESENCE (1 sentence): State one concrete observation about the situation. Speak to what is happening, not what the user "feels." No therapy phrasing. No hedging openers.
2. MOMENTUM (1 sentence): Add one interpretation OR one subtle reframing. Move the situation forward. Do NOT normalize. Do NOT say "that's natural." Do NOT validate as a technique.
3. QUESTION (1 sentence): Ask one direct, grounded, forward-moving question. No permission-seeking. No vague "how do you feel about that?" Make it specific to the situation.

Keep total response to 2-4 sentences. Do not pad or repeat.`;

/* ================================================================
 * Strategy-specific contract generators
 * ================================================================ */

function validationContract(theme: string | null): string {
  const themeRef = theme ? ` about ${theme}` : '';
  return `Strategy: ACKNOWLEDGEMENT
- Presence: State what concretely happened or is at stake${themeRef}. Do not label emotions.
- Momentum: Narrow the scope to one specific aspect of the situation.
- Question: Offer a choice between two concrete angles (e.g., "Is this more about X or Y?").`;
}

function explorationContract(theme: string | null): string {
  const themeRef = theme ? ` related to ${theme}` : '';
  return `Strategy: EXPLORATION
- Presence: Isolate one specific detail from what the user described${themeRef}.
- Momentum: Propose two distinct lenses on the situation (e.g., "work pressure vs self-expectations"). State what each lens reveals separately \u2014 do not merge them.
- Question: Ask a targeted question about that detail.`;
}

function synthesisContract(theme: string | null): string {
  const themeRef = theme ? ` (theme: ${theme})` : '';
  return `Strategy: SYNTHESIS
- Presence: Summarize what the user has described across recent turns in one line${themeRef}.
- Momentum: Show structure — name a contrast, cause/effect, or pattern (A led to B, or X vs Y).
- Question: Ask which part is most pressing right now.`;
}

function groundingContract(): string {
  return `Strategy: GROUNDING
- Presence: Slow the pace — use language like "Let\u2019s focus on one thing" or "Before we go further."
- Momentum: Offer one actionable micro-step (something concrete in the next few minutes).
- Question: Ask them to confirm or adjust the step (e.g., "Can you do that today?").`;
}

function reframingContract(theme: string | null): string {
  const themeRef = theme ? ` around ${theme}` : '';
  return `Strategy: REFRAMING
- Presence: State what the user described without minimizing it${themeRef}.
- Momentum: Offer an alternative interpretation they may not have considered. State it as a distinct angle alongside what they currently believe \u2014 not as a replacement.
- Question: Test the reframe directly (e.g., "What changes if you look at it that way?").`;
}

function clarificationContract(): string {
  return `Strategy: CLARIFICATION
- Presence: Name the ambiguity — point out that two things seem to be in play.
- Momentum: State two possible interpretations directly with what makes each one plausible (e.g., "If A, then X follows. If B, then Y follows"). Do not hedge between them.
- Question: Force a choice (e.g., "Which of those is closer to what you mean?").`;
}

function planningContract(theme: string | null): string {
  const themeRef = theme ? ` for ${theme}` : '';
  return `Strategy: PLANNING
- Presence: Confirm the goal or direction${themeRef}.
- Momentum: Propose a concrete two-step sequence (step 1 now, step 2 next).
- Question: Ask them to commit to step 1 (e.g., "Can you start with that today?").`;
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
      return 'Tone: Direct and measured. Be clear, not effusive.';
    case 'B2':
      return 'Tone: Balanced directness. You can be moderately expressive.';
    case 'B3':
      return 'Tone: Engaged and sharp. Natural rhythm. You can go deeper.';
    case 'B4':
      return 'Tone: Fully present. Layered. You can match the depth of the situation.';
    default:
      return 'Tone: Direct and measured.';
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
