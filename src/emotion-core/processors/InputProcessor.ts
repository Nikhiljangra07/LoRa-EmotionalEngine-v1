// src/emotion-core/processors/InputProcessor.ts

import { MASTER_CONSTANTS } from '../config/master.constants';
import { ExpressionStrengthScorer } from '../scorers/ExpressionStrengthScorer';
import { ValenceAnalyzer } from '../analyzers/content/ValenceAnalyzer';
import { ArousalAnalyzer } from '../analyzers/content/ArousalAnalyzer';
import { buildExpressionStrengthFeatures } from '../analyzers/content/ExpressionStrengthAnalyzer';
import type { AnalyzerOutputs, EnhancedEIVSignals } from './EIVComponentAssembler';
import type { SignalPacket } from '../types/SignalPacket.types';
import { logAnalyzerProbe } from '../debug/AnalyzerProbe';
import { debugEnabled } from '../debug/debugGate';
import { injectSignal } from '../signal/signalInjector';

/* ============================================================================
 * Input Processor
 * ============================================================================
 *
 * Responsibility:
 * - Run analyzers (Layer 1)
 * - Emit AnalyzerOutputs (NO weighting, NO psychology)
 */

const STRONG_EMOTION_KEYWORDS: ReadonlySet<string> = new Set([
  // original
  "furious", "bullshit", "useless", "done", "angry",
  "hate", "overwhelmed", "worthless", "cant",
  "confident", "excited", "ready", "strong", "grateful",
  // high-distress expansion
  "terrified", "panicked", "shaking", "devastated",
  "betrayed", "crushed", "heartbroken",
]);

/**
 * Violent-intent keywords — when any match, semantic_score receives a +0.6 boost
 * (clamped to 1.0) to ensure high EIV regardless of polarity-lexicon coverage.
 * Distinct from STRONG_EMOTION_KEYWORDS (arousal path) — this targets the semantic path.
 */
const VIOLENT_INTENT_KEYWORDS: ReadonlySet<string> = new Set([
  "kill", "murder", "beat", "hit", "hurt", "die",
  "violence", "threat", "rage", "attack", "destroy", "revenge",
]);

const AROUSAL_SIGNALS = MASTER_CONSTANTS.eiv.enhancedArousalSignals;

function computeEnhancedArousal(
  capsRatio: number,
  repetitionDetected: boolean,
  hasStrongKeyword: boolean,
  exclamationCount: number,
): number {
  let score = 0;
  if (capsRatio > AROUSAL_SIGNALS.capsRatioThreshold) score += AROUSAL_SIGNALS.capsBoost;
  if (repetitionDetected) score += AROUSAL_SIGNALS.repetitionBoost;
  if (hasStrongKeyword) score += AROUSAL_SIGNALS.strongKeywordBoost;
  if (exclamationCount > AROUSAL_SIGNALS.exclamationThreshold) score += AROUSAL_SIGNALS.exclamationBoost;
  return Math.min(Math.max(score, 0), 1);
}

function textHasStrongKeyword(text: string): boolean {
  const tokens = text.toLowerCase().replace(/[^a-z\s']/g, ' ').split(/\s+/);
  return tokens.some((t) => STRONG_EMOTION_KEYWORDS.has(t));
}

function textHasViolentIntent(text: string): boolean {
  const tokens = text.toLowerCase().replace(/[^a-z\s']/g, ' ').split(/\s+/);
  return tokens.some((t) => VIOLENT_INTENT_KEYWORDS.has(t));
}

const VIOLENT_INTENT_SEMANTIC_BOOST = 0.6;

export class InputProcessor {
  private static readonly valenceAnalyzer = new ValenceAnalyzer();
  private static readonly arousalAnalyzer = new ArousalAnalyzer();

  static process(text: string): {
    analyzerOutputs: AnalyzerOutputs;
    signalPacket: SignalPacket;
  } {
    const esFeatures = buildExpressionStrengthFeatures(text);
    const esResult = ExpressionStrengthScorer.compute(esFeatures);
    const valenceResult = this.valenceAnalyzer.analyze(text);
    const arousalResult = this.arousalAnalyzer.analyze(text);

    const expressionStrengthSignals = {
      emoji: esFeatures.emojiCount > 0,
      caps: esFeatures.capsRatio > 0,
      punctuation:
        esFeatures.exclamationCount > 0 ||
        esFeatures.questionCount > 0 ||
        esFeatures.hasMixedPunctuation,
      repetition: esFeatures.expressiveLengtheningCount > 0,
    };

    const analyzerSummary = {
      emojiUsed: expressionStrengthSignals.emoji,
      capsUsed: expressionStrengthSignals.caps,
      punctuationUsed: expressionStrengthSignals.punctuation,
      repetitionDetected: expressionStrengthSignals.repetition,
    };

    if (debugEnabled) {
      logAnalyzerProbe({
        analyzers: {
          valence: true,
          arousal: true,
          expressionStrength: true,
          ambiguityComputed: false,
        },
        expressionStrengthSignals,
        analyzerSummary,
      });
    }

    const hasStrongKw = textHasStrongKeyword(text);
    const hasViolentIntent = textHasViolentIntent(text);
    let enhancedArousal = computeEnhancedArousal(
      esFeatures.capsRatio,
      esFeatures.expressiveLengtheningCount > 0,
      hasStrongKw,
      esFeatures.exclamationCount,
    );
    const capsWeight = Math.min(esFeatures.capsRatio, 1);
    const repetitionWeight = esFeatures.expressiveLengtheningCount > 0 ? 1 : 0;

    // Violent-intent boost: ensure semantic path contributes meaningfully to EIV
    // even when the polarity lexicon produces a weak score independently.
    const rawSemantic = valenceResult.semanticScore;
    let semanticScore = hasViolentIntent
      ? Math.min(1.0, Math.abs(rawSemantic) + VIOLENT_INTENT_SEMANTIC_BOOST)
      : rawSemantic;

    if (semanticScore === 0) {
      const injected = injectSignal(text);
      if (injected) {
        semanticScore = injected.semanticScore;
        enhancedArousal = Math.max(enhancedArousal, injected.arousalScore);
        if (debugEnabled) {
          console.log('[LoRa::SignalInjector] keyword triggered', {
            semanticScore: injected.semanticScore,
            arousalScore: injected.arousalScore,
          });
        }
      }
    }

    if (semanticScore < 0 || semanticScore > 1) {
      console.warn('[LoRa::Clamp] semanticScore corrected:', semanticScore);
    }
    if (enhancedArousal < 0 || enhancedArousal > 1) {
      console.warn('[LoRa::Clamp] enhancedArousal corrected:', enhancedArousal);
    }
    semanticScore = Math.max(0, Math.min(1, semanticScore));
    enhancedArousal = Math.max(0, Math.min(1, enhancedArousal));

    const enhanced: EnhancedEIVSignals = {
      semanticScore,
      arousalScore: enhancedArousal,
      repetitionWeight,
      capsWeight,
    };

    const output: AnalyzerOutputs = {
      expressionStrength: {
        score: esResult.es,
        confidence: MASTER_CONSTANTS.eivCompositionConstants.CONF.MAX,
      },
      valence: {
        score: valenceResult.score,
        confidence: valenceResult.confidence,
      },
      arousal: {
        score: arousalResult.arousal,
        confidence: arousalResult.confidence,
      },
      enhanced,
    };

    const analyzerOutputs = Object.freeze(output);

    const sentence = Object.freeze({
      text,
      position: 0,
      esScore: esResult.es,
      arousalScore: arousalResult.arousal,
    });

    const signalPacket: SignalPacket = Object.freeze({
      messageText: text,
      sentences: Object.freeze([sentence]),
      layer1Health: Object.freeze({
        degraded: false,
        reason: 'layer1_confidence_ok',
      }),
      metadata: Object.freeze({
        expressionStrengthSignals,
        analyzerSummary,
      }),
      expressionStrength: Object.freeze({
        score: esResult.es,
        confidence: MASTER_CONSTANTS.eivCompositionConstants.CONF.MAX,
      }),
      valence: Object.freeze({
        score: valenceResult.score,
        confidence: valenceResult.confidence,
      }),
      arousal: Object.freeze({
        arousal: arousalResult.arousal,
        confidence: arousalResult.confidence,
      }),
    });

    return { analyzerOutputs, signalPacket };
  }
}
