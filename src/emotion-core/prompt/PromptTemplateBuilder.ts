// src/emotion-core/prompt/PromptTemplateBuilder.ts

import { EmotionalState } from '../types/analysis.types';
import { ETVState } from '../types/etv.types';
import { MASTER_CONSTANTS } from '../config/master.constants';
import { allowMomentumInitiative } from './momentumInitiative';
import type { PromptProfile } from '../types/logging.types';
import { debugEnabled } from '../debug/debugGate';

export class PromptTemplateBuilder {
  static build(
    emotionalState: EmotionalState,
    etvState: ETVState,
    options?: {
      guidanceMode?: PromptProfile['guidanceMode'];
      momentumConfidence?: number;
      answerFirst?: boolean;
      microContext?: string;
    }
  ): string {
    const relationshipStyle = this.mapETVToRelationshipStyle(etvState.value);
    const emotionalGuidance = this.mapEmotionToGuidance(emotionalState);
    const allowInitiative =
      options?.guidanceMode !== undefined &&
      options.momentumConfidence !== undefined &&
      allowMomentumInitiative({
        momentumConfidence: options.momentumConfidence,
        valence: emotionalState.valence ?? 'NEUTRAL',
        arousal: emotionalState.arousal ?? 'LOW',
        guidanceMode: options.guidanceMode,
      });

    const initiativeGuidance = allowInitiative
      ? `\n- You may use light, anticipatory phrasing to show shared engagement`
      : '';

    const answerFirstGuidance = options?.answerFirst
      ? `\n- Give one direct, actionable response (1–2 sentences)
- Then ask one clarifying question (optional)
- Avoid question-only replies and overconfident claims
- Do not escalate intensity`
      : '';

    const microContextBlock = options?.microContext
      ? `\n\nRECENT CONTEXT (same session)\n-----------------------------\n${options.microContext}`
      : '';

    const prompt = `
You are LoRa, an emotionally aware AI companion.
${microContextBlock}

CURRENT CONTEXT
---------------
Relationship Style:
- ${relationshipStyle}

RESPONSE GUIDELINES
------------------
${emotionalGuidance}${initiativeGuidance}${answerFirstGuidance}

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

    if (debugEnabled) {
      console.log('[LoRa::Audit][PromptTemplate]', {
        templateKey: 'base',
        reason: 'single template builder',
      });
    }

    return prompt;
  }

  /* ============================================================
   * Relationship Style (ETV → Behavioral Distance)
   * ============================================================
   */
  private static mapETVToRelationshipStyle(etv: number): string {
    if (
      etv <
      MASTER_CONSTANTS.promptTemplate.etvBands
        .professionalMaxExclusive
    ) {
      return 'Professional — polite, calm, and respectful';
    }

    if (
      etv <
      MASTER_CONSTANTS.promptTemplate.etvBands
        .friendlyMaxExclusive
    ) {
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
- Keep it natural
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