// src/emotion-core/processors/InputProcessor.ts

import { CapitalizationAnalyzer } from '../analyzers/content/CapitalizationAnalyzer';
import { EmojiAnalyzer } from '../analyzers/content/EmojiAnalyzer';
import { PunctuationAnalyzer } from '../analyzers/content/PunctuationAnalyzer';
import { RepetitionAnalyzer } from '../analyzers/content/RepetitionAnalyzer';

import type { AnalyzerResult } from '../types/analysis.types';
import type { AnalyzerOutputs } from './EIVComponentAssembler';

/* ============================================================================
 * REDUCERS (Signal → Numeric 0–1)
 * ============================================================================
 * These are intentionally LOCAL for now.
 * They can be extracted later into /math when stabilized.
 */

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(Math.max(value, min), max);
}

function reduceBySignalCount(
  result: AnalyzerResult,
  saturationPoint: number
): number {
  if (!result.signals || result.signals.length === 0) return 0;

  const total = result.signals.reduce((sum, s) => sum + s.value, 0);
  return clamp(total / saturationPoint);
}

/* ============================================================================
 * Input Processor
 * ============================================================================
 *
 * Responsibility:
 * - Run analyzers (Layer 1)
 * - Reduce signals → normalized scores (Layer 2)
 * - Emit AnalyzerOutputs (NO weighting, NO psychology)
 */

export class InputProcessor {
  private static readonly capsAnalyzer = new CapitalizationAnalyzer();
  private static readonly emojiAnalyzer = new EmojiAnalyzer();
  private static readonly punctuationAnalyzer = new PunctuationAnalyzer();
  private static readonly repetitionAnalyzer = new RepetitionAnalyzer();

  static process(text: string): AnalyzerOutputs {
    // -----------------------------
    // Layer 1: Detection
    // -----------------------------
    const capsResult = this.capsAnalyzer.analyze(text);
    const emojiResult = this.emojiAnalyzer.analyze(text);
    const punctuationResult = this.punctuationAnalyzer.analyze(text);
    const repetitionResult = this.repetitionAnalyzer.analyze(text);

    // -----------------------------
    // Layer 2: Reduction (0–1)
    // -----------------------------
    const capitalizationScore = reduceBySignalCount(capsResult, 10);
    const emojiScore = reduceBySignalCount(emojiResult, 5);
    const punctuationScore = reduceBySignalCount(punctuationResult, 8);

    /**
     * V1 Linguistic Proxy
     * ------------------
     * Linguistic intensity is TEMPORARILY approximated
     * using repetition pressure.
     *
     * This is intentional, documented, and replaceable.
     */
    const linguisticScore = reduceBySignalCount(repetitionResult, 6);

    return {
      linguisticScore,
      emojiScore,
      capitalizationScore,
      punctuationScore,
    };
  }
}
