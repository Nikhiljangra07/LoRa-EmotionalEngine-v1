// src/emotion-core/analyzers/content/EmojiAnalyzer.ts

import { AnalyzerResult, AnalyzerSignal } from '../../types/analysis.types';
import { MASTER_CONSTANTS } from '../../config/master.constants';

const EMOJI_CONSTANTS = MASTER_CONSTANTS.emojiAnalyzer;

/**
 * EmojiAnalyzer
 *
 * Role:
 * - Pure detection layer
 * - Emits raw emoji occurrence signals
 *
 * Research alignment:
 * - Emojis are high-arousal, non-semantic markers
 * - Repetition ≠ amplification (handled downstream)
 * - Confidence and saturation handled by math layer
 *
 * References:
 * - Hutto & Gilbert (2014) — VADER
 * - NRC Emoji Lexicon (2016–2021)
 * - Fischer et al. (2021)
 */
export class EmojiAnalyzer {
  readonly analyzerId = 'emoji';

  /**
   * Unicode Extended Pictographic range
   * Covers modern emoji consistently across platforms
   */
  private static readonly EMOJI_REGEX = /\p{Extended_Pictographic}/gu;

  /**
   * Remove fenced code blocks.
   * Emojis inside code are non-emotional artifacts.
   *
   * This mirrors detection-safety rules used by
   * punctuation and repetition analyzers.
   */
  private stripCodeBlocks(text: string): string {
    return text.replace(/```[\s\S]*?```/g, '');
  }

  /**
   * Extract emojis from natural-language text only.
   * Kept local to avoid polluting shared utilities.
   */
  private extractEmojis(text: string): string[] {
    return text.match(EmojiAnalyzer.EMOJI_REGEX) ?? [];
  }

  analyze(text: string): AnalyzerResult {
    if (
      !text ||
      text.trim().length === EMOJI_CONSTANTS.thresholds.emptyTextLength
    ) {
      return {
        analyzerId: this.analyzerId,
        signals: [],
        confidence: EMOJI_CONSTANTS.defaults.confidence,
      };
    }

    // ------------------------------------------------------------------
    // SAFETY: Strip code blocks before emoji detection
    // ------------------------------------------------------------------
    const sanitizedText = this.stripCodeBlocks(text);
    const emojis = this.extractEmojis(sanitizedText);

    if (emojis.length === EMOJI_CONSTANTS.thresholds.emptyEmojiCount) {
      return {
        analyzerId: this.analyzerId,
        signals: [],
        confidence: EMOJI_CONSTANTS.defaults.confidence,
      };
    }

    /**
     * Count identical emojis
     * Order-independent by design
     */
    const counts = new Map<string, number>();
    for (const emoji of emojis) {
      counts.set(
        emoji,
        (counts.get(emoji) ?? EMOJI_CONSTANTS.defaults.countSeed) + 1
      );
    }

    const signals: AnalyzerSignal[] = [];
    let index = EMOJI_CONSTANTS.defaults.indexStart;

    for (const [emoji, count] of counts.entries()) {
      signals.push({
        type: 'emoji',
        value: count, // raw repetition count (NOT intensity)
        position: index === EMOJI_CONSTANTS.defaults.indexStart ? 'start' : 'mid',
        weightSource: 'EMOJI',
        confidence: EMOJI_CONSTANTS.defaults.confidence, // explicitly deferred to math layer
        metadata: {
          emoji,
        },
      });
      index++;
    }

    return {
      analyzerId: this.analyzerId,
      signals,
      confidence: EMOJI_CONSTANTS.defaults.confidence, // analyzer-level confidence intentionally neutral
    };
  }
}
