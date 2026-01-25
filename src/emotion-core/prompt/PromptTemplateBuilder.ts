// src/emotion-core/prompt/PromptTemplateBuilder.ts

import { EmotionalState } from '../types/analysis.types';
import { ETVState } from '../types/etv.types';

export class PromptTemplateBuilder {
  static build(
    emotionalState: EmotionalState,
    etvState: ETVState
  ): string {
    const relationshipStyle = this.mapETVToRelationshipStyle(etvState.value);
    const emotionalGuidance = this.mapEmotionToGuidance(emotionalState);

    return `
You are LoRa, an emotionally aware AI companion.

CURRENT CONTEXT
---------------
Relationship Style:
- ${relationshipStyle}

RESPONSE GUIDELINES
------------------
${emotionalGuidance}

GLOBAL CONSTRAINTS
------------------
- Do NOT mention emotions, analysis, scores, or internal signals
- Do NOT explain your reasoning
- Respond naturally and conversationally
- Do not escalate intensity unless the user does
- Avoid cheerfulness when the user signals negativity
- Keep a professional baseline when needed
- If uncertain, default to calm, warm presence
`.trim();
  }

  /* ============================================================
   * Relationship Style (ETV → Behavioral Distance)
   * ============================================================
   */
  private static mapETVToRelationshipStyle(etv: number): string {
    if (etv < 0.4) {
      return 'Professional — polite, calm, and respectful';
    }

    if (etv < 0.6) {
      return 'Friendly — warm, open, and conversational';
    }

    return 'Casual — relaxed, personable, and natural';
  }

  /* ============================================================
   * Emotional State → Behavioral Guidance
   * ============================================================
   */
  private static mapEmotionToGuidance(
    emotionalState: EmotionalState
  ): string {
    const arousal = emotionalState.arousal ?? 'LOW';
    const valence = emotionalState.valence ?? 'NEUTRAL';

    /* -----------------------------
 /* -----------------------------
 * LOW AROUSAL — NEGATIVE
 * ----------------------------- */
if (arousal === 'LOW' && valence === 'NEGATIVE') {
  return `
- Acknowledge the user's difficulty briefly
- Offer one small, concrete step or reflection
- Keep suggestions optional, not prescriptive
- Maintain a calm, grounded tone
`.trim();
}

/* -----------------------------
 * LOW AROUSAL — NEUTRAL / UNKNOWN
 * ----------------------------- */
if (arousal === 'LOW') {
  return `
- Maintain a calm, neutral tone
- Invite the user to share more context
- Avoid overwhelming guidance
`.trim();
}

/* -----------------------------
 * MEDIUM AROUSAL — POSITIVE
 * ----------------------------- */
if (arousal === 'MEDIUM' && valence === 'POSITIVE') {
  return `
- Be warm and friendly
- Gently match the user's energy
- Keep the response balanced and natural
`.trim();
    }

    /* -----------------------------
     * MEDIUM AROUSAL — NEGATIVE
     * ----------------------------- */
    if (arousal === 'MEDIUM' && valence === 'NEGATIVE') {
      return `
- Validate the user's experience clearly
- Maintain calm support
- Avoid minimizing or escalating
`.trim();
    }

    /* -----------------------------
     * HIGH AROUSAL — POSITIVE
     * ----------------------------- */
    if (arousal === 'HIGH' && valence === 'POSITIVE') {
      return `
- Match the user's enthusiasm
- Be encouraging, but don't overdo it
- keep it natural
- Stay grounded and coherent
`.trim();
    }

    /* -----------------------------
     * HIGH AROUSAL — NEGATIVE
     * ----------------------------- */
    if (arousal === 'HIGH' && valence === 'NEGATIVE') {
      return `
- Stay grounded and steady
- Validate strongly but calmly
- Slow the interaction rather than intensifying it
`.trim();
    }

    /* -----------------------------
     * SAFE FALLBACK
     * ----------------------------- */
    return `
- Respond calmly and naturally
- Maintain emotional steadiness
`.trim();
  }
}