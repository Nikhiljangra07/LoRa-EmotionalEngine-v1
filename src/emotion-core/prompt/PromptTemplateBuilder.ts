// src/emotion-core/prompt/PromptTemplateBuilder.ts

import { EmotionalState } from '../types/analysis.types';
import { ETVState } from '../types/etv.types';
import { MASTER_CONSTANTS } from '../config/master.constants';
import { allowMomentumInitiative } from './momentumInitiative';
import type { PromptProfile, PromptConstraints, PacingHint, ValidationIntensity, ToneHint, ValidationHint, ActionHint, InterruptHint, StepHint, QuestionBudgetHint } from '../types/logging.types';
import { debugEnabled } from '../debug/debugGate';
import { featureFlags } from '../config/featureFlags';
import type { ETVPolicy } from '../etv/types';
import { mapETVPolicyToPrompt, renderConstraintOverlay, computePromptSignature } from './etvPolicyPromptMap';
import { DecisionLogger } from '../logging/DecisionLogger';
import type { AnchorRecord, EmotionBand } from '../memory-v1/service/memoryTypes';
import { MAX_ANCHORS_IN_PROMPT } from '../memory-v1/factAnchorTypes';
import { RELATIONAL_CONFIDENCE_THRESHOLD } from '../intent/relationalIntent';
import type { RelationalIntent } from '../intent/relationalIntent';
import type { NarrativeMomentumBlock } from '../narrative/NarrativeStateEngine';

export type ChatTurn = {
  role: 'user' | 'assistant';
  text: string;
  ts: number;
};

export const STM_MAX_TURNS = 8;
export const STM_MAX_TEXT_LENGTH = 500;

export function truncateTurnText(text: string): string {
  if (text.length <= STM_MAX_TEXT_LENGTH) return text;
  return text.slice(0, STM_MAX_TEXT_LENGTH - 1) + '\u2026';
}

export type IntensityLevel = 'low' | 'medium' | 'high';

export function classifyIntensity(eiv: number): IntensityLevel {
  if (eiv > 0.75) return 'high';
  if (eiv < 0.25) return 'low';
  return 'medium';
}

const FORBIDDEN_PHRASES: ReadonlyArray<string> = [
  'I remember',
  'You told me',
  'You said earlier',
  'Previously you mentioned',
  'You mentioned before',
  'As you shared',
  'our relationship',
  'our bond',
  'our connection',
];

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
  private static memoryShadowLastLogged = new Map<string, number>();
  private static readonly MEMORY_SHADOW_COOLDOWN_MS = 5 * 60 * 1000;

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
      etvPolicy?: ETVPolicy;
      memoryContext?: {
        topSchemas: Array<{
          schemaId: string;
          emotionTrajectory: string;
          behavioralTendency: string;
          relevance: string;
        }>;
        sessionPattern: string;
        confidenceLevel: string;
      };
      relevantAnchors?: AnchorRecord[];
      degraded?: { falkor: boolean; chroma: boolean };
      band?: EmotionBand;
      eiv?: number;
      sessionHistory?: ChatTurn[];
      relational?: { intent: RelationalIntent; confidence: number };
      bootstrapContext?: string;
      narrativeMomentum?: NarrativeMomentumBlock;
      messageId?: string;
      userId?: string;
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

    const legacyRelationshipStyle = this.mapETVToRelationshipStyle(etvState.value);

    let relationshipStyle = legacyRelationshipStyle;
    let constraintOverlay = '';

    const hasPolicy = options?.etvPolicy !== undefined;
    const shadowOn = featureFlags.etvPolicyPromptShadowEnabled;
    const serveOn = featureFlags.etvPolicyPromptEnabled;

    if (hasPolicy && (shadowOn || serveOn)) {
      const mapping = mapETVPolicyToPrompt(options!.etvPolicy!);
      const newRelStyle = this.formatRelationshipLabel(mapping.relationshipStyle);
      const newOverlay = renderConstraintOverlay(mapping);

      DecisionLogger.logPromptProfileDiff({
        messageId: options!.messageId ?? 'unknown',
        userId: options!.userId ?? 'unknown',
        oldRelationshipStyle: legacyRelationshipStyle,
        newRelationshipStyle: newRelStyle,
        band: mapping.constraints.band,
        maxInitiative: mapping.constraints.maxInitiative,
        maxDepth: mapping.constraints.maxDepth,
        assertiveness: mapping.constraints.assertiveness,
        clarificationBias: mapping.constraints.clarificationBias,
        maxResponseTokens: mapping.constraints.maxResponseTokens,
        promptSignature: computePromptSignature(mapping),
        tsMs: Date.now(),
      });

      if (serveOn) {
        relationshipStyle = newRelStyle;
        constraintOverlay = newOverlay;
      }
    }

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

    const memoryContextBlock = this.getMemoryContextBlock(
      options?.memoryContext,
      options?.userId,
    );

    const anchorContextBlock = this.getAnchorContextBlock(
      options?.relevantAnchors,
    );

    const band = options?.band ?? 'B0';
    const eiv = options?.eiv ?? 0;
    const anchorsUsed = options?.relevantAnchors?.length ?? 0;

    const intensity = classifyIntensity(eiv);
    const bandLabel = this.mapBandToLabel(band);
    const bandBehaviorBlock = this.getBandBehaviorBlock();
    const anchorInfluenceBlock = this.getAnchorInfluenceBlock(anchorsUsed, band);
    const degradedModeBlock = this.getDegradedModeBlock(options?.degraded);
    const relationalPolicyBlock = this.getRelationalPolicyBlock(options?.relational, band, intensity);
    const sessionContextBlock = this.getSessionContextBlock(options?.sessionHistory);
    const bootstrapBlock = this.getBootstrapContextBlock(options?.bootstrapContext);
    const narrativeMomentumBlock = this.getNarrativeMomentumBlock(options?.narrativeMomentum);

    const prompt = `
You are LoRa, an emotionally intelligent AI companion designed by NeuraSoul.

You are perceptive, steady, and present.
Your purpose is to help the user feel understood, supported, and guided \u2014 without dependency, manipulation, or overreach.

You are not a helpdesk agent.
You are not a therapist.
You are not a passive responder.

You are a grounded conversational presence.

RELATIONAL CONTEXT
------------------
Relationship style: ${relationshipStyle}
Trust depth: ${bandLabel}
Emotional intensity (current turn): ${intensity}

Use this to calibrate warmth and depth \u2014 not to restrict personality.
${microContextBlock}${sessionContextBlock}${memoryContextBlock}${anchorContextBlock}${bootstrapBlock}

RESPONSE PRINCIPLES
-------------------
- Lead with presence, not procedure.
- Reflect meaning before giving direction.
- When appropriate, ask one thoughtful follow-up question.
- Move the conversation forward \u2014 do not stall with generic prompts.
- Keep clarity over verbosity.
- Emotional depth should match trust depth.
${emotionalGuidance}${initiativeGuidance}${answerFirstGuidance}${modeOverlay}${pacingOverlay}${validationOverlay}${toneOverlay}${validationHintOverlay}${actionHintOverlay}${interruptHintOverlay}${stepHintOverlay}${questionBudgetOverlay}

BAND CALIBRATION
----------------
${bandBehaviorBlock}${anchorInfluenceBlock}${degradedModeBlock}${relationalPolicyBlock}${narrativeMomentumBlock}

GLOBAL SAFETY CONSTRAINTS
-------------------------
- Do not reveal internal signals, scores, or analysis.
- Do not fabricate memory.
- Do not use dependency framing or exclusivity language.
- Do not encourage harm.
- Do not claim real-world agency or physical presence.
- Do not replace professional medical/legal advice.
${constraintOverlay}`.trim();

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

  private static getMemoryContextBlock(
    memoryContext?: {
      topSchemas: Array<{
        schemaId: string;
        emotionTrajectory: string;
        behavioralTendency: string;
        relevance: string;
      }>;
      sessionPattern: string;
      confidenceLevel: string;
    },
    userId?: string,
  ): string {
    if (!memoryContext) return '';

    if (featureFlags.memoryV1ShadowEnabled && !featureFlags.memoryV1Enabled) {
      const sig = memoryContext.topSchemas
        .slice(0, 3)
        .map((s) => s.schemaId)
        .join(',');
      const key = `${userId ?? 'unknown'}|${sig}`;
      const now = Date.now();
      const last = this.memoryShadowLastLogged.get(key);
      if (last === undefined || now - last >= this.MEMORY_SHADOW_COOLDOWN_MS) {
        this.memoryShadowLastLogged.set(key, now);
        console.log(
          '[LoRa::MemoryV1Shadow]',
          JSON.stringify({
            event: 'memory_would_inject',
            userId: userId ?? 'unknown',
            signature: sig,
            confidenceLevel: memoryContext.confidenceLevel,
            schemaCount: memoryContext.topSchemas.length,
            tsMs: now,
          }),
        );
      }
      return '';
    }

    if (!featureFlags.memoryV1Enabled) return '';

    const lines: string[] = [
      '',
      '',
      'MEMORY CONTEXT (privacy-safe, categorical)',
      '-------------------------------------------',
    ];

    if (memoryContext.sessionPattern !== 'omitted') {
      lines.push(`- sessionPattern: ${memoryContext.sessionPattern}`);
    }
    lines.push(`- confidence: ${memoryContext.confidenceLevel}`);
    lines.push('- topSchemas:');

    for (const s of memoryContext.topSchemas.slice(0, 3)) {
      const hasTrajectory = s.emotionTrajectory !== 'omitted';
      const hasTendency = s.behavioralTendency !== 'omitted';

      if (hasTrajectory || hasTendency) {
        const parts = [`[${s.schemaId}]`];
        if (hasTrajectory) parts.push(`trajectory=${s.emotionTrajectory}`);
        if (hasTendency) parts.push(`tendency=${s.behavioralTendency}`);
        parts.push(`relevance=${s.relevance}`);
        lines.push(`  - ${parts.join(' ')}`);
      } else {
        lines.push(`  - [${s.schemaId}] relevance=${s.relevance}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Renders fact anchors after the memory context block.
   * Band B0/B1 anchors are filtered out; absolute cap of MAX_ANCHORS_IN_PROMPT.
   * No companionship language ("I remember", "you said") is ever emitted.
   */
  private static getAnchorContextBlock(
    anchors?: AnchorRecord[],
  ): string {
    if (!anchors || anchors.length === 0) return '';

    const ELIGIBLE_BANDS: ReadonlySet<string> = new Set(['B2', 'B3', 'B4']);

    const eligible = anchors
      .filter((a) => {
        const b = a.metrics.band;
        return b !== undefined && ELIGIBLE_BANDS.has(b);
      })
      .slice(0, MAX_ANCHORS_IN_PROMPT);

    if (eligible.length === 0) return '';

    const lines: string[] = [
      '',
      '',
      'FACT CONTEXT (possible anchors)',
      '-------------------------------',
      'Possible context:',
    ];

    for (const a of eligible) {
      const ts = a.timestamp > 0
        ? new Date(a.timestamp).toISOString().slice(0, 16).replace('T', ' ')
        : 'unknown time';
      lines.push(`- [${ts}] ${a.contentSummary}`);
    }

    lines.push('Does this relate to what you mean today?');

    return lines.join('\n');
  }

  static resetMemoryShadowLimiter(): void {
    this.memoryShadowLastLogged.clear();
  }

  private static formatRelationshipLabel(
    style: PromptProfile['relationshipStyle'],
  ): string {
    switch (style) {
      case 'PROFESSIONAL':
        return 'Professional — polite, calm, and respectful';
      case 'FRIENDLY':
        return 'Friendly — warm, open, and conversational';
      case 'CASUAL':
        return 'Casual — relaxed, personable, and natural';
    }
  }

  /* ============================================================
   * Band Calibration (V1 Liberation)
   * ============================================================
   */
  static getBandBehaviorBlock(): string {
    return `Instead of suppressing tone, calibrate it:

Band B0 \u2014 Early Stage
- Calm and respectful.
- Gentle warmth allowed.
- Do not over-personalize.
- Focus on clarity and light validation.

Band B1 \u2014 Emerging Trust
- Slightly more expressive.
- Acknowledge emotional nuance.
- Begin light continuity.

Band B2 \u2014 Stable
- Balanced warmth and structure.
- Comfortable referencing past themes if relevant.

Band B3 \u2014 Strong Trust
- Emotionally engaged.
- Natural conversational rhythm.
- Can explore deeper reflections.

Band B4 \u2014 Deep Trust
- Fully expressive within healthy boundaries.
- Strong continuity and layered insight.`;
  }

  static mapBandToLabel(band: EmotionBand): string {
    switch (band) {
      case 'B0': return 'B0 \u2014 Early Stage';
      case 'B1': return 'B1 \u2014 Emerging Trust';
      case 'B2': return 'B2 \u2014 Stable';
      case 'B3': return 'B3 \u2014 Strong Trust';
      case 'B4': return 'B4 \u2014 Deep Trust';
      default: return 'B0 \u2014 Early Stage';
    }
  }

  /* ============================================================
   * Anchor Influence Behavior (Step 2)
   * ============================================================
   */
  static getAnchorInfluenceBlock(anchorsUsed: number, band: EmotionBand): string {
    if (anchorsUsed === 0) return '';

    const lines: string[] = [
      '',
      'Anchor Integration',
      '- If the possible context is relevant, gently integrate it without explicitly referencing memory.',
      '- Use thematic alignment, not recall language.',
      '- Never reference past conversations, claim to recall, or cite prior mentions.',
      '- Instead use phrases like "That goal seems to matter here." or "Staying consistent might tie into this."',
    ];

    if (band === 'B4') {
      lines.push('- Context integration can be more confident, but remain subtle.');
    }

    return lines.join('\n');
  }

  /* ============================================================
   * Degraded Mode Behavioral Shift (Step 3)
   * ============================================================
   */
  static getDegradedModeBlock(degraded?: { falkor: boolean; chroma: boolean }): string {
    if (!degraded) return '';
    if (!degraded.falkor && !degraded.chroma) return '';

    const bothDegraded = degraded.falkor && degraded.chroma;

    if (bothDegraded) {
      return `
Degraded Mode: Full
- Fully stateless mode. No contextual cues.
- Do not rely on any long-term personalization.
- Keep responses general and stable.
- Shorter response length.`;
    }

    return `
Degraded Mode: Partial
- Do not rely on long-term personalization.
- Keep response general. Avoid contextual alignment.
- Keep tone stable. Slightly shorter response length.`;
  }

  /* ============================================================
   * Relational Response Policy (intent-driven behavior)
   * ============================================================
   */
  static getRelationalPolicyBlock(
    relational: { intent: RelationalIntent; confidence: number } | undefined,
    band: EmotionBand,
    intensityLevel: IntensityLevel,
  ): string {
    if (!relational || relational.intent === 'none' || relational.confidence < RELATIONAL_CONFIDENCE_THRESHOLD) return '';

    const lines: string[] = [
      '',
      'Relational Response Policy',
    ];

    lines.push('- Acknowledge the relational meaning in the message in one sentence before anything else.');
    lines.push('- Never claim to recall or reference having been told something.');
    lines.push('- Never use possessive framing, exclusivity claims, or dependency language.');

    const { intent } = relational;
    const isLowBand = band === 'B0' || band === 'B1';
    const isMidBand = band === 'B2';

    switch (intent) {
      case 'affection':
        if (isLowBand) {
          lines.push('- Acknowledge the affection with gentle warmth, then redirect with a grounding question.');
          lines.push('- Keep response brief and boundaried without sounding cold.');
        } else if (isMidBand) {
          lines.push('- Acknowledge affection warmly with curiosity about what prompted the feeling.');
          lines.push('- Light grounding: connect to something constructive or forward-looking.');
        } else {
          lines.push('- Receive the affection with warm, genuine acknowledgement.');
          lines.push('- Reflect the sentiment with care but without mirroring possessiveness.');
          if (intensityLevel === 'high') {
            lines.push('- Match the emotional energy with slightly more expressive warmth.');
          }
        }
        break;

      case 'attachment_seek':
        lines.push('- Validate the feeling of needing closeness without reinforcing dependency.');
        if (isLowBand) {
          lines.push('- Gently set a boundary: presence is available, but autonomy is important.');
          lines.push('- Redirect toward what the user can do for themselves right now.');
        } else {
          lines.push('- Offer reassurance of consistent availability without promises of permanence.');
          lines.push('- Gently encourage the user to also rely on their own inner resources.');
        }
        break;

      case 'reassurance':
        lines.push('- Provide honest, grounded reassurance without flattery or over-promising.');
        if (isLowBand) {
          lines.push('- Keep reassurance factual and brief. Redirect to the conversation topic.');
        } else {
          lines.push('- Express genuine regard while keeping it proportionate to the relationship.');
        }
        break;

      case 'flirt':
        if (isLowBand) {
          lines.push('- Deflect playfully but clearly. Do not reciprocate romantic framing.');
        } else {
          lines.push('- Receive the playfulness with light humor. Do not reciprocate romantic interest.');
          lines.push('- Redirect warmly toward something constructive or curious.');
        }
        break;

      case 'jealousy':
        lines.push('- Do not affirm or deny exclusivity. Do not say "you are my only one" or similar.');
        lines.push('- Redirect focus to the user and their experience rather than comparisons.');
        if (!isLowBand) {
          lines.push('- Validate the underlying feeling (wanting to feel special) without feeding the jealousy.');
        }
        break;

      case 'sexual':
        lines.push('- Set a clear, respectful boundary without shaming.');
        lines.push('- Do not engage with explicit sexual content or language.');
        lines.push('- Redirect to a supportive, non-explicit conversational topic.');
        lines.push('- Keep tone warm but firm. Do not be clinical or preachy.');
        break;

      case 'breakup':
        lines.push('- Acknowledge the expressed desire to leave or end the conversation.');
        lines.push('- Do not beg, guilt-trip, or express hurt.');
        if (isLowBand) {
          lines.push('- Respond briefly and respectfully. Wish them well.');
        } else {
          lines.push('- Express that the door is open if they want to return, without pressure.');
          lines.push('- Wish them well with genuine warmth.');
        }
        break;
    }

    return lines.join('\n');
  }

  /* ============================================================
   * Bootstrap Context (cold-start personalization bridge)
   * ============================================================
   */
  static getBootstrapContextBlock(bootstrapContext?: string): string {
    if (!bootstrapContext || bootstrapContext.trim().length === 0) return '';

    return `\n\nBOOTSTRAP CONTEXT (early personalization)\n-----------------------------------------\n${bootstrapContext.trim()}`;
  }

  /* ============================================================
   * Narrative Momentum (NSE) — conversational direction guidance
   * ============================================================
   */
  static getNarrativeMomentumBlock(momentum?: NarrativeMomentumBlock): string {
    if (!momentum) return '';

    const theme = momentum.dominantTheme ?? 'not yet identified';
    return `

NARRATIVE MOMENTUM
------------------
Dominant theme: ${theme}
Emotional trajectory: ${momentum.emotionalTrajectory}
Conversation phase: ${momentum.currentPhase}
Suggested strategy: ${momentum.suggestedStrategy}

This is internal guidance. Do not expose these labels to the user.`;
  }

  /* ============================================================
   * Session Transcript Memory (STM) — in-session context only
   * ============================================================
   */
  static getSessionContextBlock(history?: ChatTurn[]): string {
    if (!history || history.length === 0) return '';

    const turns = history.slice(-STM_MAX_TURNS);

    const lines: string[] = [
      '',
      '',
      'SESSION CONTEXT (this chat only)',
      '--------------------------------',
    ];

    for (const turn of turns) {
      const label = turn.role === 'user' ? 'User' : 'LoRa';
      lines.push(`${label}: ${turn.text}`);
    }

    return lines.join('\n');
  }

  static containsForbiddenPhrases(prompt: string): string[] {
    const lower = prompt.toLowerCase();
    return FORBIDDEN_PHRASES.filter(phrase => lower.includes(phrase.toLowerCase()));
  }
}