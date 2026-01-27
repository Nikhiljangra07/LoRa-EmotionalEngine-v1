// src/emotion-core/analyzers/content/PunctuationAnalyzer.ts

/**
 * Layer 1: DETECTION ONLY
 *
 * Responsibility: What happened in the text?
 * - Detect punctuation patterns
 * - Count occurrences
 * - Identify position (start/mid/end)
 * - Emit raw signals
 *
 * ❌ NO MATH
 * ❌ NO EMOTION
 * ❌ NO POLICY
 *
 * This file should be boring.
 */

import type {
  AnalyzerResult,
  AnalyzerSignal,
  AnalysisContext,
} from '../../types/analysis.types';

import {
  stripUrls,
  stripAbbreviations,
  isCodeBlock,
} from '../../utils/textCleaning';
import { MASTER_CONSTANTS } from '../../config/master.constants';

const PUNCTUATION_CONSTANTS = MASTER_CONSTANTS.punctuationAnalyzer;

/**
 * Raw punctuation detection result
 */
export interface RawPunctuationSignal {
  type:
    | 'exclamation'
    | 'question'
    | 'ellipsis'
    | 'mixed'
    | 'trailing_ellipsis'
    | 'period';
  count: number;
  position: 'start' | 'mid' | 'end';
  index: number;
  rawMatch: string;
}

export class PunctuationAnalyzer {
  readonly analyzerId = 'punctuation';

  analyze(message: string, _context?: AnalysisContext): AnalyzerResult {
    if (!message || isCodeBlock(message)) {
      return {
        analyzerId: this.analyzerId,
        signals: [],
        confidence: 0,
        metadata: { emptyInput: true },
      };
    }

    const cleaned = this.clean(message);
    const rawSignals = this.detectAll(cleaned);

    return {
      analyzerId: this.analyzerId,
      signals: rawSignals.map(s => this.toAnalyzerSignal(s)),
      confidence: 0,
      metadata: {
        messageLength: message.length,
        cleanedLength: cleaned.length,
        rawSignalCount: rawSignals.length,
      },
    };
  }

  /* ---------- CLEANING ---------- */

  private clean(text: string): string {
    let out = stripUrls(text);
    out = stripAbbreviations(out);
    return out;
  }

  /* ---------- DETECTION ---------- */

  private detectAll(text: string): RawPunctuationSignal[] {
    return [
      ...this.detectExclamations(text),
      ...this.detectQuestions(text),
      ...this.detectEllipsis(text),
      ...this.detectMixed(text),
      ...this.detectPeriods(text),
    ];
  }

  private detectExclamations(text: string): RawPunctuationSignal[] {
    const signals: RawPunctuationSignal[] = [];
    const regex = /!+/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text))) {
      signals.push({
        type: 'exclamation',
        count: match[0].length,
        position: this.resolvePosition(text, match.index),
        index: match.index,
        rawMatch: match[0],
      });
    }

    return signals;
  }

  private detectQuestions(text: string): RawPunctuationSignal[] {
    const signals: RawPunctuationSignal[] = [];
    const regex = /\?+/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text))) {
      signals.push({
        type: 'question',
        count: match[0].length,
        position: this.resolvePosition(text, match.index),
        index: match.index,
        rawMatch: match[0],
      });
    }

    return signals;
  }

  private detectEllipsis(text: string): RawPunctuationSignal[] {
    const signals: RawPunctuationSignal[] = [];
    const regex = new RegExp(
      `\\.{${PUNCTUATION_CONSTANTS.thresholds.ellipsisMinDots},}`,
      'g'
    );
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text))) {
      const position = this.resolvePosition(text, match.index);
      const isTrailing = position === 'end';

      signals.push({
        type: isTrailing ? 'trailing_ellipsis' : 'ellipsis',
        count: match[0].length,
        position,
        index: match.index,
        rawMatch: match[0],
      });
    }

    return signals;
  }

  private detectMixed(text: string): RawPunctuationSignal[] {
    const signals: RawPunctuationSignal[] = [];
    const regex = /(\?!|!\?)+/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text))) {
      signals.push({
        type: 'mixed',
        count:
          match[0].length / PUNCTUATION_CONSTANTS.scoring.mixedPairDivisor,
        position: this.resolvePosition(text, match.index),
        index: match.index,
        rawMatch: match[0],
      });
    }

    return signals;
  }

  /**
   * FIXED: Period detection
   * - Detects sentence-ending '.'
   * - Excludes decimals (3.14)
   * - Excludes ellipsis
   */
  private detectPeriods(text: string): RawPunctuationSignal[] {
    const signals: RawPunctuationSignal[] = [];

    for (let i = 0; i < text.length; i++) {
      if (text[i] !== '.') continue;

      const prev = text[i - 1];
      const next = text[i + 1];

      // Exclude ellipsis
      if (next === '.') continue;

      // Exclude decimals (digit . digit)
      if (/\d/.test(prev) && /\d/.test(next)) continue;

      // Must be sentence-ending
      if (next && !/\s/.test(next)) continue;

      signals.push({
        type: 'period',
        count: PUNCTUATION_CONSTANTS.scoring.periodCount,
        position: this.resolvePosition(text, i),
        index: i,
        rawMatch: '.',
      });
    }

    return signals;
  }

  /* ---------- HELPERS ---------- */

  private resolvePosition(text: string, index: number): 'start' | 'mid' | 'end' {
    const ratio = index / text.length;
    if (ratio < PUNCTUATION_CONSTANTS.thresholds.positionStartRatio) return 'start';
    if (ratio > PUNCTUATION_CONSTANTS.thresholds.positionEndRatio) return 'end';
    return 'mid';
  }

  private toAnalyzerSignal(raw: RawPunctuationSignal): AnalyzerSignal {
    return {
      type: raw.type,
      value: raw.count,
      confidence: 0,
      position: raw.position,
      metadata: {
        rawMatch: raw.rawMatch,
        index: raw.index,
      },
    };
  }
}
