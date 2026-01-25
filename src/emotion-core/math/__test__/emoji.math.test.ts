import { computeEmojiEIV } from '../emoji.math';
import { EMOJI_CONFIG } from '../../config/emoji.config';
import { AnalyzerSignal } from '../../types/analysis.types';

function emojiSignal(count: number): AnalyzerSignal {
  return {
    type: 'emoji',
    value: count,
    position: 'mid',
    weightSource: 'EMOJI',
    confidence: 0,
    metadata: { emoji: '🙂' },
  };
}

describe('Emoji Math — Intensity (EIV)', () => {
  test('returns zero intensity for empty input', () => {
    const res = computeEmojiEIV([]);
    expect(res.intensity).toBe(0);
    expect(res.confidence).toBe(1);
  });

  test('single emoji produces base-range intensity', () => {
    const res = computeEmojiEIV([emojiSignal(1)]);
    expect(res.intensity).toBeGreaterThanOrEqual(0.08);
    expect(res.intensity).toBeLessThanOrEqual(0.25);
  });

  test('intensity is monotonic with emoji count', () => {
    const one = computeEmojiEIV([emojiSignal(1)]).intensity;
    const three = computeEmojiEIV([emojiSignal(3)]).intensity;
    const five = computeEmojiEIV([emojiSignal(5)]).intensity;

    expect(three).toBeGreaterThan(one);
    expect(five).toBeGreaterThanOrEqual(three);
  });

  test('intensity saturates by maxEffectiveCount (5–6)', () => {
    const five = computeEmojiEIV([emojiSignal(5)]).intensity;
    const ten = computeEmojiEIV([emojiSignal(10)]).intensity;

    // Saturation: extra emojis should not materially increase intensity
    expect(ten).toBeLessThanOrEqual(
      five + EMOJI_CONFIG.BASE_INCREMENT * 0.2
    );
  });

  test('intensity never exceeds MAX_CONTRIBUTION', () => {
    const extreme = computeEmojiEIV([emojiSignal(50)]);
    expect(extreme.intensity).toBeLessThanOrEqual(
      EMOJI_CONFIG.MAX_CONTRIBUTION
    );
  });
});

describe('Emoji Math — Confidence', () => {
  test('confidence is high for normal emoji usage (≤6)', () => {
    const res = computeEmojiEIV([emojiSignal(3)]);
    expect(res.confidence).toBeCloseTo(
      EMOJI_CONFIG.CONFIDENCE.BASE,
      2
    );
  });

  test('confidence drops sharply for emoji overuse (7+)', () => {
    const normal = computeEmojiEIV([emojiSignal(5)]).confidence;
    const overused = computeEmojiEIV([emojiSignal(8)]).confidence;

    expect(overused).toBeLessThan(normal);
    expect(overused).toBeCloseTo(
      EMOJI_CONFIG.CONFIDENCE.OVERUSE_PENALTY,
      2
    );
  });
});
