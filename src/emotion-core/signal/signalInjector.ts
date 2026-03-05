// src/emotion-core/signal/signalInjector.ts

type SignalRule = {
  keywords: string[];
  semantic: number;
  arousal: number;
};

const SIGNAL_RULES: SignalRule[] = [
  // HIGH ANGER
  {
    keywords: [
      'angry', 'furious', 'rage', 'pissed', 'outraged',
      'livid', 'mad', 'fuming', 'irritated', 'infuriating',
    ],
    semantic: 0.85,
    arousal: 0.75,
  },

  // FRUSTRATION
  {
    keywords: [
      'frustrated', 'annoyed', 'irritating', 'fed up',
      'tired of', 'sick of', 'this sucks', "can't stand",
    ],
    semantic: 0.65,
    arousal: 0.45,
  },

  // CONFUSION / STUCK
  {
    keywords: [
      'stuck', 'confused', 'lost', 'not sure',
      "don't understand", "can't figure out",
      'unclear', 'puzzled', 'what am i doing',
    ],
    semantic: 0.55,
    arousal: 0.25,
  },

  // SAD / LOW ENERGY
  {
    keywords: [
      'sad', 'exhausted', 'tired', 'burned out',
      'hopeless', 'drained', 'depressed',
      'empty', 'overwhelmed',
    ],
    semantic: 0.6,
    arousal: 0.15,
  },

  // ANXIETY
  {
    keywords: [
      'worried', 'anxious', 'nervous',
      'panic', 'stressed', 'pressure',
      'overthinking', 'fear', 'scared',
    ],
    semantic: 0.65,
    arousal: 0.55,
  },

  // POSITIVE / EXCITEMENT
  {
    keywords: [
      'happy', 'excited', 'great', 'awesome',
      'amazing', 'love this', 'fantastic',
      'energized', 'motivated',
    ],
    semantic: 0.4,
    arousal: 0.5,
  },

  // EXISTENTIAL / PURPOSE
  {
    keywords: [
      'purpose', 'meaning', 'direction',
      'my life', 'what am i doing',
      'career', 'future', 'identity',
    ],
    semantic: 0.5,
    arousal: 0.2,
  },
];

export function injectSignal(
  text: string,
): { semanticScore: number; arousalScore: number } | null {
  const lower = text.toLowerCase();

  for (const rule of SIGNAL_RULES) {
    for (const k of rule.keywords) {
      if (lower.includes(k)) {
        return {
          semanticScore: rule.semantic,
          arousalScore: rule.arousal,
        };
      }
    }
  }

  return null;
}
