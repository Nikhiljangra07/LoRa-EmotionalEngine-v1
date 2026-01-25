// src/emotion-core/analyzers/content/RepetitionAnalyzer.ts

import type {
  AnalyzerResult,
  AnalyzerSignal,
  AnalysisContext,
} from '../../types/analysis.types';

/**
 * RepetitionAnalyzer
 *
 * Layer 1 — DETECTION ONLY
 *
 * Detects consecutive lexical repetition as a raw arousal signal.
 *
 * ❌ No intensity math
 * ❌ No EIV / ETV logic
 * ❌ No aggregation
 *
 * Research-grounded assumptions:
 * - Only consecutive repetition matters (massed repetition)
 * - Single occurrence = no signal
 * - Exact-token matching (case-insensitive)
 */

export interface RawRepetitionSignal {
  token: string;
  count: number;
  startIndex: number;
  endIndex: number;
}

export class RepetitionAnalyzer {
  readonly analyzerId = 'repetition';

  analyze(
    text: string,
    _context?: AnalysisContext
  ): AnalyzerResult {
    if (!text || !text.trim()) {
      return this.emptyResult();
    }

    const tokens = this.tokenize(text);
    const rawSignals = this.detectRepetitions(tokens);

    return {
      analyzerId: this.analyzerId,
      signals: rawSignals.map(s => this.toAnalyzerSignal(s)),
      confidence: 0, // computed later by engine
      metadata: {
        tokenCount: tokens.length,
        repetitionGroups: rawSignals.length,
      },
    };
  }

  /* ─────────────────────────────
   * DETECTION
   * ───────────────────────────── */

  private detectRepetitions(tokens: string[]): RawRepetitionSignal[] {
    const signals: RawRepetitionSignal[] = [];
    let i = 0;

    while (i < tokens.length) {
      const token = tokens[i];
      let count = 1;
      let j = i + 1;

      while (j < tokens.length && tokens[j] === token) {
        count++;
        j++;
      }

      if (count >= 2) {
        signals.push({
          token,
          count,
          startIndex: i,
          endIndex: j - 1,
        });
      }

      i = j;
    }

    return signals;
  }

  /* ─────────────────────────────
   * TOKENIZATION
   * ───────────────────────────── */

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/\s+/)
      .map(t => t.replace(/^[^a-z]+|[^a-z]+$/g, ''))
      .filter(Boolean);
  }

  /* ─────────────────────────────
   * TRANSFORMATION
   * ───────────────────────────── */

  private toAnalyzerSignal(
    raw: RawRepetitionSignal
  ): AnalyzerSignal {
    return {
      type: 'REPETITION',
      value: raw.count,
      confidence: 0, // Layer 3
      position: this.resolvePosition(
        raw.startIndex,
        raw.endIndex
      ),
      metadata: {
        token: raw.token,
        startIndex: raw.startIndex,
        endIndex: raw.endIndex,
      },
    };
  }

  private resolvePosition(
    start: number,
    end: number
  ): 'start' | 'mid' | 'end' {
    if (start === 0) return 'start';
    if (end === start) return 'mid';
    return 'mid';
  }

  private emptyResult(): AnalyzerResult {
    return {
      analyzerId: this.analyzerId,
      signals: [],
      confidence: 0,
      metadata: { empty: true },
    };
  }
}

export default RepetitionAnalyzer;
