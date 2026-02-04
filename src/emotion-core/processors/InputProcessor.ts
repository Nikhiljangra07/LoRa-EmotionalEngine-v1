// src/emotion-core/processors/InputProcessor.ts

import { MASTER_CONSTANTS } from '../config/master.constants';
import { ExpressionStrengthScorer } from '../scorers/ExpressionStrengthScorer';
import { ValenceAnalyzer } from '../analyzers/content/ValenceAnalyzer';
import { ArousalAnalyzer } from '../analyzers/content/ArousalAnalyzer';
import { buildExpressionStrengthFeatures } from '../analyzers/content/ExpressionStrengthAnalyzer';
import type { AnalyzerOutputs } from './EIVComponentAssembler';

/* ============================================================================
 * Input Processor
 * ============================================================================
 *
 * Responsibility:
 * - Run analyzers (Layer 1)
 * - Emit AnalyzerOutputs (NO weighting, NO psychology)
 */

export class InputProcessor {
  private static readonly valenceAnalyzer = new ValenceAnalyzer();
  private static readonly arousalAnalyzer = new ArousalAnalyzer();

  static process(text: string): AnalyzerOutputs {
    const esFeatures = buildExpressionStrengthFeatures(text);
    const esResult = ExpressionStrengthScorer.compute(esFeatures);
    const valenceResult = this.valenceAnalyzer.analyze(text);
    const arousalResult = this.arousalAnalyzer.analyze(text);

    return {
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
    };
  }
}
