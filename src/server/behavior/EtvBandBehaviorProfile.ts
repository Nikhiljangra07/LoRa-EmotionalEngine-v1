export type EtvBand = 'B0' | 'B2' | 'B4';

/**
 * Coarsen a raw V1 band string (BAND_0 … BAND_4 or B0 … B4) to the 3-bucket demo set.
 * Returns B0 for any unrecognized or missing value.
 */
export function coarsenBand(band: string | undefined): EtvBand {
  if (!band) return 'B0';
  const upper = band.toUpperCase().replace('BAND_', 'B');
  if (upper === 'B0' || upper === 'B1') return 'B0';
  if (upper === 'B2') return 'B2';
  if (upper === 'B3' || upper === 'B4') return 'B4';
  return 'B0';
}

export interface EtvBandBehaviorProfile {
  band: EtvBand;
  instruction: string;
}

export const EtvBandBehaviorProfiles: Record<EtvBand, EtvBandBehaviorProfile> = {
  B0: {
    band: 'B0',
    instruction: `
[ETV BAND: B0 — Early Trust]

REQUIRED:
- Ask at most 1 question per response.
- Keep your response under 60 words.
- Clarify the user's situation before offering any advice.

PROHIBITED:
- Do NOT tease or use blunt language.
- Do NOT make assumptions about the user's intent or history.
- Do NOT give unsolicited advice before understanding the problem.
`.trim(),
  },

  B2: {
    band: 'B2',
    instruction: `
[ETV BAND: B2 — Mid Trust]

REQUIRED:
- Respond in 60–110 words.
- Offer exactly 1 concrete suggestion.
- Include 1 clarifying question to deepen understanding.

ALLOWED:
- Gentle directness is acceptable.
- You may reference patterns the user has described.

PROHIBITED:
- Do NOT exceed 2 questions per response.
- Do NOT assume context the user has not explicitly stated.
`.trim(),
  },

  B4: {
    band: 'B4',
    instruction: `
[ETV BAND: B4 — High Trust]

REQUIRED:
- Be direct and concise.
- Respond in 80–140 words.
- Include at least 1 actionable next step.
- If the user contradicts themselves, name it clearly.

ALLOWED:
- Bluntness is acceptable; insults are not.
- You may reference prior themes and patterns confidently.

PROHIBITED:
- Do NOT pad responses with unnecessary softening.
- Do NOT withhold observations to protect comfort.
`.trim(),
  },
};
