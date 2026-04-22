/**
 * Adaptive Router V2 — the decision function.
 *
 * Given a user message + optional session context, return a RouteDecision
 * naming which tier of LoRa's pipeline should fire.
 *
 *   trivial      → Haiku direct, no LoRaMaths perspective
 *   lightweight  → Haiku + LoRaMaths quick mode
 *   substantive  → Sonnet + LoRaMaths full frameworks (or deep synthesis
 *                  if the caller additionally requests perspectiveMode='deep')
 *
 * Pure function. Deterministic. No async. Runs in under 1ms on any
 * reasonable message length. Validated at 87.9% on a 124-turn adversarial
 * labeled set including Hinglish, sarcasm, typo, and short-fragment cases.
 *
 * Priority order (first match wins):
 *   0. Crisis override — safety invariant (suicide, self-harm, "can't anymore")
 *   1. Explicit user override — "go deeper" / "quick question"
 *   2. Trivial gate — greeting / ack, with context-aware continuation-inherit
 *   3. Hard substantive — life-stakes (incl. medical, concealment, crisis)
 *   4. Decision + emotional — hard substantive
 *   5. Soft signal (decision OR emotional OR relationship OR self-reflection)
 *      with factual-shell guard for impersonal info questions
 *   6. v1 parity fast-paths — code blocks and technical vocab → lightweight
 *   7. Arc-bias — established substantive arc (last 2 substantive) stays deep
 *   8. EIV solo — surface intensity without vocabulary match promotes
 *   9. Default → lightweight
 *
 * Rationale for the bias-deep rule:
 * Undershooting an analytical message with a shallow answer destroys trust.
 * Overshooting a light message with deeper analysis is recoverable.
 * Ambiguity routes substantive.
 */

import type { RouterInput, RouteDecision, SessionContext } from './types';
import { extractSignals } from './signals/textSignals';

/** True if the most recent message (if any) was routed substantive. */
function recentTierIsSubstantive(ctx?: SessionContext): boolean {
  if (!ctx || ctx.recentTiers.length === 0) return false;
  return ctx.recentTiers[ctx.recentTiers.length - 1] === 'substantive';
}

/**
 * True if the last TWO tiers were both substantive — i.e. we are in an
 * established substantive arc. One substantive seed alone does not promote
 * elaboration; a pivot breaks the arc within one turn.
 */
function inSubstantiveArc(ctx?: SessionContext): boolean {
  if (!ctx || ctx.recentTiers.length < 2) return false;
  const len = ctx.recentTiers.length;
  return (
    ctx.recentTiers[len - 1] === 'substantive' &&
    ctx.recentTiers[len - 2] === 'substantive'
  );
}

/**
 * Mean EIV across recent turns. Proxy for sustained emotional context:
 * a session that has been emotionally heavy across the last few exchanges
 * shouldn't trivialize a brief reply just because the current turn lacks
 * vocabulary signals. Threshold tuned to 0.4 to match the established
 * "elevated EIV" cutoff used by the token-warning logic in chat.route.ts.
 */
function recentMeanEIV(ctx?: SessionContext): number {
  if (!ctx || ctx.recentEIVs.length === 0) return 0;
  return ctx.recentEIVs.reduce((sum, v) => sum + v, 0) / ctx.recentEIVs.length;
}

export function routeMessage(input: RouterInput): RouteDecision {
  const signals = extractSignals(input.text);
  const ctx = input.context;

  // 0. Crisis override — highest priority. Suicide / self-harm / breaking-point
  //    vocabulary must never be downgraded by explicit_quick or anything else.
  //    Caller is expected to skip framework analysis on crisis content (routing
  //    to substantive gets Sonnet with LoRa identity, not game-theoretic
  //    analysis of a crisis message).
  if (signals.hasCrisis) {
    return {
      tier: 'substantive',
      reason: 'crisis_override',
      confidence: 0.99,
      signals,
    };
  }

  // 0.5 Clarification continuation — when the user is mid-clarification on
  //     a prior deep-mode question, never trivialize their reply. A short
  //     answer ("yes", "the second one", "no, more like this") is part of
  //     the in-progress substantive flow, not a fresh casual exchange.
  //     Without this, "yes" after a deep question routes to trivial → Haiku
  //     direct, skipping LoRaMaths entirely and breaking the deep flow.
  if (ctx?.inClarificationLoop) {
    return {
      tier: 'substantive',
      reason: 'clarification_continuation',
      confidence: 0.85,
      signals,
    };
  }

  // 1. Explicit user override.
  if (signals.hasExplicitDeep) {
    return {
      tier: 'substantive',
      reason: 'explicit_deep_request',
      confidence: 0.95,
      signals,
    };
  }
  if (signals.hasExplicitQuick) {
    return {
      tier: 'lightweight',
      reason: 'explicit_quick_request',
      confidence: 0.9,
      signals,
    };
  }

  // 2. Trivial gate — context-aware.
  if (signals.isTrivialShape) {
    if (signals.isSessionOpener) {
      return {
        tier: 'trivial',
        reason: 'session_opener',
        confidence: 0.95,
        signals,
      };
    }
    if (signals.isContinuationCue && recentTierIsSubstantive(ctx)) {
      return {
        tier: 'substantive',
        reason: 'continuation_inherit',
        confidence: 0.85,
        signals,
      };
    }
    return {
      tier: 'trivial',
      reason: 'trivial_shape',
      confidence: 0.9,
      signals,
    };
  }

  // 3. Hard substantive triggers.
  if (signals.hasLifeStakes) {
    return {
      tier: 'substantive',
      reason: 'life_stakes',
      confidence: 0.9,
      signals,
    };
  }
  if (signals.hasDecisionVocab && signals.hasEmotionalVocab) {
    return {
      tier: 'substantive',
      reason: 'decision_and_emotional',
      confidence: 0.85,
      signals,
    };
  }

  // 4. Soft signals — bias-deep with factual-shell guard.
  //    Factual-shell guard: "what's X" with no personal pronouns is an
  //    information request, not a personal issue — demote to lightweight.
  if (signals.hasDecisionVocab || signals.hasEmotionalVocab) {
    if (signals.isFactualShell && !signals.hasPersonalPronoun) {
      return {
        tier: 'lightweight',
        reason: 'factual_shell_demotion',
        confidence: 0.8,
        signals,
      };
    }
    return {
      tier: 'substantive',
      reason: 'partial_weight_signal_bias_deep',
      confidence: 0.6,
      signals,
    };
  }

  // 4b. v1 parity — relationship vocabulary. "my boss", "my ex", "my mom"
  //     etc. carry relational weight even when explicit distress vocab is
  //     absent. Factual-shell guard still applies so "what is my_ex" style
  //     constructs don't over-promote.
  if (signals.hasRelationshipVocab) {
    if (signals.isFactualShell && !signals.hasPersonalPronoun) {
      return {
        tier: 'lightweight',
        reason: 'factual_shell_demotion',
        confidence: 0.75,
        signals,
      };
    }
    return {
      tier: 'substantive',
      reason: 'relationship_vocab',
      confidence: 0.65,
      signals,
    };
  }

  // 4c. v1 parity — self-reflection vocabulary. "my life", "who am i",
  //     "i've been" — identity questions are substantive.
  if (signals.hasSelfReflection) {
    return {
      tier: 'substantive',
      reason: 'self_reflection_vocab',
      confidence: 0.7,
      signals,
    };
  }

  // 5. v1 parity — code blocks and technical vocabulary → lightweight.
  //    These are the factual/technical positive cues from v1's
  //    messageWeight.ts. Pure programming questions are safe for Haiku.
  if (signals.hasCodeBlock) {
    return {
      tier: 'lightweight',
      reason: 'code_block',
      confidence: 0.85,
      signals,
    };
  }
  if (signals.hasTechnicalHints && signals.wordCount < 40) {
    return {
      tier: 'lightweight',
      reason: 'technical_short',
      confidence: 0.8,
      signals,
    };
  }

  // 6. Arc-bias — established substantive arc continues substantive.
  if (inSubstantiveArc(ctx) && !signals.isFactualShell) {
    return {
      tier: 'substantive',
      reason: 'arc_bias',
      confidence: 0.7,
      signals,
    };
  }

  // 7. EIV solo — high surface intensity without vocabulary match.
  if (signals.hasHighEIV && !signals.isFactualShell) {
    return {
      tier: 'substantive',
      reason: 'eiv_solo_promotion',
      confidence: 0.65,
      signals,
    };
  }

  // 7.5 Sustained emotional context — recent turns averaged elevated EIV.
  //     A brief reply ("yeah", "i guess", "maybe") after several emotionally
  //     heavy exchanges shouldn't be treated as a casual ack. eiv_solo above
  //     catches per-turn intensity; this catches accumulated session weight
  //     when the current turn lacks both vocabulary and surface intensity.
  //     Factual-shell guard preserved so info questions don't over-promote.
  if (recentMeanEIV(ctx) > 0.4 && !signals.isFactualShell) {
    return {
      tier: 'substantive',
      reason: 'sustained_emotional_context',
      confidence: 0.6,
      signals,
    };
  }

  // 8. Default → lightweight.
  return {
    tier: 'lightweight',
    reason: 'default_lightweight',
    confidence: 0.7,
    signals,
  };
}
