/* ============================================================================
 * NegationScopeAnalyzer
 * ============================================================================
 * - Rule-based, deterministic
 * - Hybrid lexical + window approach
 * - Emits negation signals ONLY
 * - No emotion inversion
 * - <1ms latency
 *
 * Research-backed defaults:
 * - Forward window: 5 tokens
 * - Backward window: 2 tokens
 * - Terminators: contrastive conjunctions > punctuation
 *
 * References:
 * - Morante & Blanco (2012)
 * - Fancellu et al. (2016)
 * - Chapman et al. (2011)
 * ============================================================================
 */

export interface NegationScope {
  cue: string;
  cueIndex: number;
  scopeStart: number;
  scopeEnd: number;
  negatedTokens: string[];
  recommendation?: 'INVERT' | 'NEUTRALIZE';
}

export interface NegationAnalysisResult {
  negationDetected: boolean;
  doubleNegationDetected: boolean;
  scopes: NegationScope[];
}

export class NegationScopeAnalyzer {
  // --------------------------------------------------
  // Configuration (frozen for beta)
  // --------------------------------------------------
  private static readonly NEGATION_CUES = new Set([
    'not',
    'no',
    'never',
    'none',
    'nobody',
    'nothing',
    'nowhere',
    'neither',
    'nor',
    "can't",
    "won't",
    "don't",
    "didn't",
    "isn't",
    "aren't",
    "wasn't",
    "weren't",
    "shouldn't",
    "wouldn't",
    "couldn't"
  ]);

  private static readonly TERMINATORS = new Set([
    'but',
    'however',
    'though',
    'although',
    'yet'
  ]);

  private static readonly SENTENCE_BOUNDARIES = new Set(['.', '!', '?']);

  private static readonly LIST_CONJUNCTIONS = new Set(['or', 'and']);

  private static readonly FILLER_WORDS = new Set([
    'here',
    'now',
    'there',
    'then',
    'just',
    'really'
  ]);

  private static readonly FORWARD_WINDOW = 5;
  private static readonly BACKWARD_WINDOW = 2;

  // --------------------------------------------------
  // Public API
  // --------------------------------------------------
  static analyze(text: string): NegationAnalysisResult {
    const tokens = this.tokenize(text);
    const scopes: NegationScope[] = [];

    let negationCueCount = 0;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      if (!this.NEGATION_CUES.has(token)) continue;
      negationCueCount++;

      const { start, end } = this.resolveScope(tokens, i);
      const negatedTokens = tokens
        .slice(start, end + 1)
        .filter(t => t !== token)
        .filter(t => !this.SENTENCE_BOUNDARIES.has(t))
        .filter(t => !this.LIST_CONJUNCTIONS.has(t))
        .filter(t => !this.FILLER_WORDS.has(t));

      scopes.push({
        cue: token,
        cueIndex: i,
        scopeStart: start,
        scopeEnd: end,
        negatedTokens,
      });
    }

    const doubleNegationDetected =
      negationCueCount >= 2 &&
      scopes.some(scope =>
        tokens
          .slice(scope.scopeStart, scope.scopeEnd + 1)
          .some(
            (t, idx) =>
              this.NEGATION_CUES.has(t) &&
              scope.scopeStart + idx !== scope.cueIndex
          )
      );

    // Double negation policy: NEVER invert automatically
    if (doubleNegationDetected) {
      for (const scope of scopes) {
        scope.recommendation = 'NEUTRALIZE';
      }
    }

    return {
      negationDetected: scopes.length > 0,
      doubleNegationDetected,
      scopes
    };
  }

  // --------------------------------------------------
  // Tokenization (shared philosophy with NRC)
  // --------------------------------------------------
  private static tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/([.!?])/g, ' $1 ')
      .replace(/[^a-z\s'!?\.]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }

  // --------------------------------------------------
  // Scope Resolution (Hybrid)
  // --------------------------------------------------
  private static resolveScope(tokens: string[], cueIndex: number) {
    let start = Math.max(0, cueIndex - this.BACKWARD_WINDOW);
    let end = Math.min(tokens.length - 1, cueIndex + this.FORWARD_WINDOW);

    for (let i = cueIndex - 1; i >= start; i--) {
      if (this.SENTENCE_BOUNDARIES.has(tokens[i])) {
        start = i + 1;
        break;
      }
    }

    // Early termination on contrastive conjunction
    for (let i = cueIndex + 1; i <= end; i++) {
      if (this.TERMINATORS.has(tokens[i])) {
        end = i - 1;
        break;
      }
    }

    for (let i = cueIndex + 1; i <= end; i++) {
      if (this.SENTENCE_BOUNDARIES.has(tokens[i])) {
        end = i - 1;
        break;
      }
    }

    
    return { start, end };
  }
}