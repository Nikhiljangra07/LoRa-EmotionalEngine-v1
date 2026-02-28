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

/* ============================================================================
 * Input Processor
 * ============================================================================
 *
 * Responsibility:
 * - Run analyzers (Layer 1)
 * - Emit AnalyzerOutputs (NO weighting, NO psychology)
 */

const STRONG_EMOTION_KEYWORDS: ReadonlySet<string> = new Set([
  "furious", "bullshit", "useless", "done", "angry",
  "hate", "overwhelmed", "worthless", "cant",
  "confident", "excited", "ready", "strong", "grateful",
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
    const enhancedArousal = computeEnhancedArousal(
      esFeatures.capsRatio,
      esFeatures.expressiveLengtheningCount > 0,
      hasStrongKw,
      esFeatures.exclamationCount,
    );
    const capsWeight = Math.min(esFeatures.capsRatio, 1);
    const repetitionWeight = esFeatures.expressiveLengtheningCount > 0 ? 1 : 0;

    const enhanced: EnhancedEIVSignals = {
      semanticScore: valenceResult.semanticScore,
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
