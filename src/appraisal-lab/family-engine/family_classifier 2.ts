import {
  AROUSAL_HIGH,
  AROUSAL_LOW,
  CAPS_HIGH,
  CLAMP_MAX,
  EPS,
  ES_HIGH,
  MOD_ANGER_MAX,
  MOD_DISGUST_MAX,
  MOD_FEAR_MAX,
  MOD_SURPRISE_MAX,
  QMARK_HIGH,
  REPEAT_HIGH,
  VAL_NEG,
  VAL_POS,
} from "./constants";
import { EkmanFamily, type FamilyInputs, type FamilyOutputs, type FamilyVector } from "./types";

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function sanitizeFinite(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return clamp(value, -CLAMP_MAX, CLAMP_MAX);
}

const TIE_BREAK_ORDER: EkmanFamily[] = [
  EkmanFamily.SURPRISE,
  EkmanFamily.JOY,
  EkmanFamily.SADNESS,
  EkmanFamily.FEAR,
  EkmanFamily.ANGER,
  EkmanFamily.DISGUST,
];

const ALL_FAMILIES: EkmanFamily[] = [
  EkmanFamily.JOY,
  EkmanFamily.ANGER,
  EkmanFamily.FEAR,
  EkmanFamily.SADNESS,
  EkmanFamily.SURPRISE,
  EkmanFamily.DISGUST,
];

function pickDominant(weights: FamilyVector): EkmanFamily {
  let best = TIE_BREAK_ORDER[0];
  let bestValue = weights[best];

  for (const family of TIE_BREAK_ORDER) {
    const candidate = weights[family];
    if (candidate > bestValue) {
      best = family;
      bestValue = candidate;
    }
  }

  return best;
}

function topTwo(weights: FamilyVector): [number, number] {
  const values = [
    weights.JOY,
    weights.ANGER,
    weights.FEAR,
    weights.SADNESS,
    weights.SURPRISE,
    weights.DISGUST,
  ].sort((a, b) => b - a);

  return [values[0] ?? 0, values[1] ?? 0];
}

export function classifyFamily(inputs: FamilyInputs): FamilyOutputs {
  const valence = clamp(sanitizeFinite(inputs.valence), -1, 1);
  const arousal = clamp01(sanitizeFinite(inputs.arousal));
  const expressionStrength = clamp01(sanitizeFinite(inputs.expressionStrength));

  const capsRatio = clamp01(sanitizeFinite(inputs.signals.capsRatio));
  const punctuationHits = Math.max(0, sanitizeFinite(inputs.signals.punctuationHits));
  const emojiHits = Math.max(0, sanitizeFinite(inputs.signals.emojiHits));
  const repetitionScore = Math.max(0, sanitizeFinite(inputs.signals.repetitionScore));
  const questionMarks = Math.max(0, sanitizeFinite(inputs.signals.questionMarks));

  const joyBase = Math.max(0, valence) * (0.6 + 0.4 * arousal);
  const sadnessBase = Math.max(0, -valence) * (0.6 + 0.4 * (1 - arousal));
  const angerBaseUnscaled = Math.max(0, -valence) * arousal * (0.5 + 0.5 * expressionStrength);
  const fearBaseUnscaled = Math.max(0, -valence) * arousal * 0.8;
  const neutral = 1 - Math.min(1, Math.abs(valence) / 0.8);
  const surpriseBase = arousal * Math.max(0, neutral);
  const disgustBaseInitial = Math.max(0, -valence) * (0.7 - 0.4 * arousal);

  const angerHasDominanceCue =
    capsRatio > CAPS_HIGH ||
    punctuationHits > 3 ||
    repetitionScore > REPEAT_HIGH ||
    expressionStrength > ES_HIGH;
  const angerBase = Math.max(
    0,
    Number.isFinite(angerBaseUnscaled)
      ? angerBaseUnscaled * (angerHasDominanceCue ? 1 : 0.75)
      : 0
  );

  const fearBase = Math.max(
    0,
    Number.isFinite(fearBaseUnscaled)
      ? fearBaseUnscaled * (questionMarks >= QMARK_HIGH ? 1.15 : 0.9)
      : 0
  );

  let disgustScale = 1;
  if (repetitionScore > REPEAT_HIGH && valence < VAL_NEG) {
    disgustScale *= 1.2;
  }
  if (capsRatio < 0.1 && arousal < 0.5 && valence < VAL_NEG) {
    disgustScale *= 1.1;
  }
  disgustScale = clamp(disgustScale, 1, 1.5);
  const disgustBase = Math.max(
    0,
    Number.isFinite(disgustBaseInitial) ? disgustBaseInitial * disgustScale : 0
  );

  const angerModRaw =
    0.2 * (capsRatio / Math.max(CAPS_HIGH, EPS)) +
    0.1 * Math.min(1, punctuationHits / 6) +
    0.1 * Math.min(1, repetitionScore);
  const angerMod = Math.min(MOD_ANGER_MAX, Math.max(0, angerModRaw));

  const fearModRaw = 0.15 * Math.min(1, questionMarks / Math.max(QMARK_HIGH, 1));
  const fearMod = Math.min(MOD_FEAR_MAX, Math.max(0, fearModRaw));

  const surpriseModRaw =
    0.12 * Math.min(1, questionMarks / Math.max(QMARK_HIGH, 1)) + 0.08 * arousal;
  const surpriseMod = Math.min(MOD_SURPRISE_MAX, Math.max(0, surpriseModRaw));

  const disgustModRaw =
    valence < VAL_NEG ? 0.1 * Math.min(1, repetitionScore / Math.max(REPEAT_HIGH, EPS)) : 0;
  const disgustMod = Math.min(MOD_DISGUST_MAX, Math.max(0, disgustModRaw));

  const joyEmojiTiny = Math.min(0.05, Math.max(0, 0.03 * Math.min(1, emojiHits / 5)));

  const raw: FamilyVector = {
    JOY: Math.max(0, joyBase + joyEmojiTiny),
    SADNESS: Math.max(0, sadnessBase),
    ANGER: Math.max(0, angerBase + angerMod),
    FEAR: Math.max(0, fearBase + fearMod),
    SURPRISE: Math.max(0, surpriseBase + surpriseMod),
    DISGUST: Math.max(0, disgustBase) + disgustMod,
  };

  raw.JOY = Number.isFinite(raw.JOY) ? raw.JOY : 0;
  raw.SADNESS = Number.isFinite(raw.SADNESS) ? raw.SADNESS : 0;
  raw.ANGER = Number.isFinite(raw.ANGER) ? raw.ANGER : 0;
  raw.FEAR = Number.isFinite(raw.FEAR) ? raw.FEAR : 0;
  raw.SURPRISE = Number.isFinite(raw.SURPRISE) ? raw.SURPRISE : 0;
  raw.DISGUST = Number.isFinite(raw.DISGUST) ? raw.DISGUST : 0;

  const totalRaw = raw.JOY + raw.ANGER + raw.FEAR + raw.SADNESS + raw.SURPRISE + raw.DISGUST;
  if (!Number.isFinite(totalRaw) || totalRaw <= EPS) {
    const fallbackBase: FamilyVector = {
      SURPRISE: 0.4,
      JOY: 0.1,
      SADNESS: 0.1,
      FEAR: 0.1,
      ANGER: 0.1,
      DISGUST: 0.1,
    };
    const fallbackTotal =
      fallbackBase.JOY +
      fallbackBase.ANGER +
      fallbackBase.FEAR +
      fallbackBase.SADNESS +
      fallbackBase.SURPRISE +
      fallbackBase.DISGUST;

    return {
      familyWeights: {
        JOY: fallbackBase.JOY / fallbackTotal,
        ANGER: fallbackBase.ANGER / fallbackTotal,
        FEAR: fallbackBase.FEAR / fallbackTotal,
        SADNESS: fallbackBase.SADNESS / fallbackTotal,
        SURPRISE: fallbackBase.SURPRISE / fallbackTotal,
        DISGUST: fallbackBase.DISGUST / fallbackTotal,
      },
      dominantFamily: EkmanFamily.SURPRISE,
      confidence: 0,
      reasons: ["FALLBACK_NEUTRAL_BASELINE"],
    };
  }

  const familyWeights: FamilyVector = {
    JOY: clamp01(raw.JOY / totalRaw),
    ANGER: clamp01(raw.ANGER / totalRaw),
    FEAR: clamp01(raw.FEAR / totalRaw),
    SADNESS: clamp01(raw.SADNESS / totalRaw),
    SURPRISE: clamp01(raw.SURPRISE / totalRaw),
    DISGUST: clamp01(raw.DISGUST / totalRaw),
  };

  const allowExtremeDominance = Math.abs(valence) > 0.9 && arousal > 0.9;
  const dominanceCap = 0.95 - 1e-12;
  if (!allowExtremeDominance) {
    const preGuardDominant = pickDominant(familyWeights);
    const dominantWeight = familyWeights[preGuardDominant];
    if (dominantWeight > dominanceCap) {
      const overflow = dominantWeight - dominanceCap;
      familyWeights[preGuardDominant] = dominanceCap;

      const otherFamilies = ALL_FAMILIES.filter((family) => family !== preGuardDominant);
      const otherSum = otherFamilies.reduce((sum, family) => sum + familyWeights[family], 0);
      if (otherSum <= EPS) {
        const increment = overflow / otherFamilies.length;
        for (const family of otherFamilies) {
          familyWeights[family] = clamp01(familyWeights[family] + increment);
        }
      } else {
        for (const family of otherFamilies) {
          const share = familyWeights[family] / otherSum;
          familyWeights[family] = clamp01(familyWeights[family] + overflow * share);
        }
      }
    }
  }

  const guardedSum =
    familyWeights.JOY +
    familyWeights.ANGER +
    familyWeights.FEAR +
    familyWeights.SADNESS +
    familyWeights.SURPRISE +
    familyWeights.DISGUST;
  if (guardedSum > EPS) {
    familyWeights.JOY = clamp01(familyWeights.JOY / guardedSum);
    familyWeights.ANGER = clamp01(familyWeights.ANGER / guardedSum);
    familyWeights.FEAR = clamp01(familyWeights.FEAR / guardedSum);
    familyWeights.SADNESS = clamp01(familyWeights.SADNESS / guardedSum);
    familyWeights.SURPRISE = clamp01(familyWeights.SURPRISE / guardedSum);
    familyWeights.DISGUST = clamp01(familyWeights.DISGUST / guardedSum);
  }

  const dominantFamily = pickDominant(familyWeights);
  const [top1, top2] = topTwo(familyWeights);
  const gap = clamp01(top1 - top2);
  const signalStrength = clamp01(0.5 * expressionStrength + 0.5 * arousal);
  let confidence = clamp01(gap * (0.6 + 0.4 * signalStrength));
  if (totalRaw <= 0.15) {
    confidence = clamp01(confidence * 0.5);
  }

  const reasons: string[] = [];
  if (valence > VAL_POS) {
    reasons.push("VALENCE_POS");
  }
  if (valence < VAL_NEG) {
    reasons.push("VALENCE_NEG");
  }
  if (arousal > AROUSAL_HIGH) {
    reasons.push("AROUSAL_HIGH");
  }
  if (arousal < AROUSAL_LOW) {
    reasons.push("AROUSAL_LOW");
  }
  if (expressionStrength > ES_HIGH) {
    reasons.push("ES_HIGH");
  }
  if (capsRatio > CAPS_HIGH) {
    reasons.push("CAPS_HIGH");
  }
  if (repetitionScore > REPEAT_HIGH) {
    reasons.push("REPETITION_HIGH");
  }
  if (questionMarks >= QMARK_HIGH) {
    reasons.push("QMARKS_HIGH");
  }
  reasons.push(`DOM_${dominantFamily}`);

  return {
    familyWeights,
    dominantFamily,
    confidence,
    reasons,
  };
}
