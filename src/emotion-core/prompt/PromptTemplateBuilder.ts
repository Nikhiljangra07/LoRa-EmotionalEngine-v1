// src/emotion-core/prompt/PromptTemplateBuilder.ts

import { EmotionalState } from '../types/analysis.types';
import { ETVState } from '../types/etv.types';
import { MASTER_CONSTANTS } from '../config/master.constants';
import { allowMomentumInitiative } from './momentumInitiative';
import type { PromptProfile, PacingHint, ValidationIntensity, ToneHint, ValidationHint, ActionHint, InterruptHint, StepHint, QuestionBudgetHint } from '../types/logging.types';
import { debugEnabled } from '../debug/debugGate';
import { featureFlags } from '../config/featureFlags';

const ALLOWED_GUIDANCE_MODES: ReadonlySet<string> = new Set([
  'CALM_NEUTRAL',
  'ENERGY_MATCH',
  'VALIDATING',
  'DE_ESCALATE',
  'SUPPORTIVE',
  'FALLBACK',
  'STABILIZE',
  'SUPPORTIVE_REFLECTION',
]);

export class PromptTemplateBuilder {
  static build(
    emotionalState: EmotionalState,
    etvState: ETVState,
    options?: {
      guidanceMode?: PromptProfile['guidanceMode'];
      momentumConfidence?: number;
      answerFirst?: boolean;
      microContext?: string;
      pacingHint?: PacingHint;
      validationIntensity?: ValidationIntensity;
      toneHint?: ToneHint;
      validationHint?: ValidationHint;
      actionHint?: ActionHint;
      interruptHint?: InterruptHint;
      stepHint?: StepHint;
      questionBudgetHint?: QuestionBudgetHint;
    }
  ): string {
    if (
      featureFlags.strictGuidanceModeEnabled &&
      options?.guidanceMode !== undefined &&
      !ALLOWED_GUIDANCE_MODES.has(options.guidanceMode)
    ) {
      throw new Error(
        `[STRICT_MODE] Unknown guidanceMode: ${options.guidanceMode}`,
      );
    }

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

    // Phase 1.1: compatibility mapping for new modes
    const modeOverlay = this.getGuidanceModeOverlay(options?.guidanceMode);

    // Phase 2: pacing overlay driven by derived hint (never an appraisal object)
    const pacingOverlay = this.getPacingOverlay(options?.pacingHint);

    const validationOverlay = this.getValidationOverlay(options?.validationIntensity);
    const toneOverlay = this.getToneOverlay(options?.toneHint);
    const validationHintOverlay = this.getValidationHintOverlay(options?.validationHint);
    const actionHintOverlay = this.getActionHintOverlay(options?.actionHint);
    const interruptHintOverlay = this.getInterruptHintOverlay(options?.interruptHint);
    const stepHintOverlay = this.getStepHintOverlay(options?.stepHint);
    const questionBudgetOverlay = this.getQuestionBudgetOverlay(options?.questionBudgetHint);

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
${emotionalGuidance}${initiativeGuidance}${answerFirstGuidance}${modeOverlay}${pacingOverlay}${validationOverlay}${toneOverlay}${validationHintOverlay}${actionHintOverlay}${interruptHintOverlay}${stepHintOverlay}${questionBudgetOverlay}

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

  /* ============================================================
   * Phase 1.1: compatibility mapping for new guidance modes
   *
   * Existing modes return '' (no overlay) to preserve behavior.
   * New modes map to safe, grounded guidance aligned with the
   * closest legacy template.
   * ============================================================
   */
  private static getGuidanceModeOverlay(
    mode?: PromptProfile['guidanceMode']
  ): string {
    switch (mode) {
      // Maps to DE_ESCALATE-adjacent grounding guidance
      case 'STABILIZE':
        return `
- Prioritize emotional grounding and stability
- Use simple, clear language
- Avoid probing or challenging the user
- Default to a calm, steady presence`;

      // Maps to SUPPORTIVE/VALIDATING-adjacent reflective guidance
      case 'SUPPORTIVE_REFLECTION':
        return `
- Gently reflect what the user has shared
- Validate their experience without judgment
- Offer space for the user to process
- Maintain warmth and patience`;

      default:
        return '';
    }
  }

  /* ============================================================
   * Validation intensity overlay.
   *
   * Only MEDIUM and HIGH produce output; LOW/undefined are no-ops.
   * ============================================================
   */
  private static getValidationOverlay(intensity?: ValidationIntensity): string {
    switch (intensity) {
      case 'MEDIUM':
        return `
[VALIDATION_INTENSITY:MEDIUM]
- Acknowledge the user's feelings clearly before responding to content.`;
      case 'HIGH':
        return `
[VALIDATION_INTENSITY:HIGH]
- Lead with strong, explicit emotional validation.
- Name the feeling if contextually safe. Normalize the user's experience.`;
      default:
        return '';
    }
  }

  /* ============================================================
   * Tone hint overlay.
   *
   * Only GENTLE and FIRM produce output; undefined is a no-op.
   * ============================================================
   */
  private static getToneOverlay(hint?: ToneHint): string {
    switch (hint) {
      case 'GENTLE':
        return `
[TONE_HINT:GENTLE]
- Soften wording. Avoid confrontational phrasing. Validate first before offering perspective.`;
      case 'FIRM':
        return `
[TONE_HINT:FIRM]
- Be concise and direct. Set boundaries clearly. Ask one clear question. Do not over-validate.`;
      default:
        return '';
    }
  }

  /* ============================================================
   * Phase 2: pacing overlay from derived hint.
   *
   * Only SLOW and FAST produce output; NORMAL/undefined are no-ops.
   * ============================================================
   */
  private static getPacingOverlay(hint?: PacingHint): string {
    switch (hint) {
      case 'SLOW':
        return `
[PACING_HINT:SLOW]
- Pacing: slow down. Use shorter sentences. Pause between ideas. Avoid rapid questioning.`;
      case 'FAST':
        return `
[PACING_HINT:FAST]
- Pacing: keep it brisk. Use concise, direct responses.`;
      default:
        return '';
    }
  }

  private static getValidationHintOverlay(hint?: ValidationHint): string {
    switch (hint) {
      case 'STRONG':
        return `
[VALIDATION_HINT:STRONG]
- Provide clear emotional reassurance. Reflect and normalize the user's experience before moving forward.`;
      case 'LIGHT':
        return `
[VALIDATION_HINT:LIGHT]
- Keep validation brief. Do not over-soothe. Acknowledge, then move to substance.`;
      default:
        return '';
    }
  }

  private static getActionHintOverlay(hint?: ActionHint): string {
    switch (hint) {
      case 'ASK_ONE_QUESTION':
        return `
[ACTION_HINT:ASK_ONE_QUESTION]
- Ask at most one clarifying question. Keep it gentle.`;
      case 'OFFER_STEPS':
        return `
[ACTION_HINT:OFFER_STEPS]
- Offer 2\u20134 concrete steps. Avoid overload.`;
      case 'ENCOURAGE_BREATH':
        return `
[ACTION_HINT:ENCOURAGE_BREATH]
- Offer a grounding or breathing suggestion briefly.`;
      case 'SUGGEST_BREAK':
        return `
[ACTION_HINT:SUGGEST_BREAK]
- Suggest a short break and offer to resume later.`;
      case 'NO_ACTION':
        return `
[ACTION_HINT:NO_ACTION]
- Do not suggest actions; stay present.`;
      default:
        return '';
    }
  }

  private static getInterruptHintOverlay(hint?: InterruptHint): string {
    switch (hint) {
      case 'SOFT':
        return `
[INTERRUPT_HINT:SOFT]
- Gently interrupt loops; one sentence max.`;
      case 'FIRM':
        return `
[INTERRUPT_HINT:FIRM]
- Set a clear boundary; stop the current line of thought.`;
      case 'HARD_STOP':
        return `
[INTERRUPT_HINT:HARD_STOP]
- Hard boundary; refuse unsafe or looping demand and redirect.`;
      default:
        return '';
    }
  }

  private static getStepHintOverlay(hint?: StepHint): string {
    switch (hint) {
      case 'ONE_STEP':
        return `
[STEP_HINT:ONE_STEP]
- Offer at most one concrete step. Keep it concise.`;
      case 'TWO_STEPS':
        return `
[STEP_HINT:TWO_STEPS]
- Offer 1\u20132 concise steps. Avoid overload.`;
      default:
        return '';
    }
  }

  private static getQuestionBudgetOverlay(hint?: QuestionBudgetHint): string {
    switch (hint) {
      case 'ZERO':
        return `
[QUESTION_BUDGET:ZERO]
- Ask zero questions. Use statements, reflections, and grounding.`;
      case 'ONE':
        return `
[QUESTION_BUDGET:ONE]
- At most one question. Prefer one short, gentle question only if needed.`;
      default:
        return '';
    }
  }
}