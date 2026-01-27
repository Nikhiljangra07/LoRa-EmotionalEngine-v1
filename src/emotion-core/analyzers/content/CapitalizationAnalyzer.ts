import {
  AnalyzerResult,
  AnalyzerSignal,
  AnalysisContext
} from '../../types/analysis.types';
import { MASTER_CONSTANTS } from '../../config/master.constants';

const CAPS_BASE_WEIGHT = MASTER_CONSTANTS.capitalization.weights.capsBase;
const REPEAT_BASE_WEIGHT = MASTER_CONSTANTS.capitalization.weights.repeatBase;
const CAPS_THRESHOLDS = MASTER_CONSTANTS.capitalization.thresholds;
const CAPS_CONFIDENCE = MASTER_CONSTANTS.capitalization.confidence;

const IGNORED_TOKENS = new Set(['OK']);

const HEADER_KEYWORDS = new Set([
  'AND', 'OR', 'OF', 'THE', 'TERMS', 'CONDITIONS', 'POLICY'
]);

const ACRONYMS = new Set<string>([
  'USA','FBI','CIA','API','CPU','GPU','RAM','HTML','JSON','XML','SQL',
  'NASA','WHO','UN','EU','HTTP','HTTPS'
]);

export class CapitalizationAnalyzer {
  readonly analyzerId = 'capitalization';

  analyze(text: string, _context?: AnalysisContext): AnalyzerResult {
    const rawTokens = text.trim().split(/\s+/);
    const cleanTokens = rawTokens
      .map(t => t.replace(/[^A-Za-z]/g, ''))
      .filter(Boolean);

    const signals: AnalyzerSignal[] = [];

    const isAllCapsText = /^[A-Z_\s]+$/.test(text);
    const hasHeaderKeywords = cleanTokens.some(t => HEADER_KEYWORDS.has(t));
    const hasEmotionalToken = cleanTokens.some(
      t =>
        t.length > CAPS_THRESHOLDS.emotionalTokenLengthMinExclusive &&
        !HEADER_KEYWORDS.has(t)
    );

    // Correct title suppression
    if (isAllCapsText && hasHeaderKeywords && !hasEmotionalToken) {
      return {
        analyzerId: this.analyzerId,
        signals: [],
        confidence: 0,
        metadata: { titleSuppressed: true }
      };
    }

    let capsCount = 0;

    for (let i = 0; i < cleanTokens.length; i++) {
      const rawToken = rawTokens[i] ?? '';
      const token = cleanTokens[i];
      const position = this.position(i, cleanTokens.length);

      if (IGNORED_TOKENS.has(token)) continue;
      if (token.length < CAPS_THRESHOLDS.minTokenLength) continue;
      if (this.isExcluded(rawToken, token, i)) continue;

      if (this.isAllCaps(token)) {
        capsCount++;
        signals.push({
          type: 'CAPITALIZATION',
          value: CAPS_BASE_WEIGHT,
          confidence: CAPS_CONFIDENCE.allCaps,
          position,
          weightSource: 'ALL_CAPS',
          metadata: { token }
        });
      }

      if (this.hasRepeatedLetters(token)) {
        signals.push({
          type: 'CAPITALIZATION',
          value: REPEAT_BASE_WEIGHT,
          confidence: CAPS_CONFIDENCE.repeatedLetters,
          position,
          weightSource: 'REPEATED_LETTERS',
          metadata: { token }
        });
      }
    }

    if (capsCount > CAPS_THRESHOLDS.capsBoostCountThreshold) {
      signals.forEach(s => {
        if (s.weightSource === 'ALL_CAPS') s.confidence = CAPS_CONFIDENCE.allCapsBoosted;
      });
    }

    return {
      analyzerId: this.analyzerId,
      signals,
      confidence: 0,
      metadata: {
        capsCount,
        tokenCount: cleanTokens.length
      }
    };
  }

  // ---------------- helpers ----------------

  private isAllCaps(token: string): boolean {
    return token === token.toUpperCase();
  }

  private hasRepeatedLetters(token: string): boolean {
    const repeatRegex = new RegExp(
      `(.)\\1{${CAPS_THRESHOLDS.repeatedLetterMinCount},}`,
      'i'
    );
    return repeatRegex.test(token);
  }

  private isExcluded(
    rawToken: string,
    cleanToken: string,
    index: number
  ): boolean {
    if (rawToken.includes('_')) return true;          // ✅ FIX
    if (/\d/.test(rawToken)) return true;
    if (ACRONYMS.has(cleanToken)) return true;
    if (/^[A-Z][a-z]+$/.test(cleanToken) && index === 0) return true;
    return false;
  }

  private position(
    index: number,
    total: number
  ): 'start' | 'mid' | 'end' {
    if (index === 0) return 'start';
    if (index === total - 1) return 'end';
    return 'mid';
  }
}

export default CapitalizationAnalyzer;
