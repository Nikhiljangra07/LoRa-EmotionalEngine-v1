import { ES_CONFIG } from "../config/es.config";
import {
  ExpressionStrengthFeatures,
  ExpressionStrengthResult,
} from "../types/ExpressionStrength";

export class ExpressionStrengthScorer {
  static compute(features: ExpressionStrengthFeatures): ExpressionStrengthResult {
    const {
      capsRatio,
      exclamationCount,
      questionCount,
      hasMixedPunctuation,
      emojiCount,
      expressiveLengtheningCount,
      intensifierCount,
      interjectionCount,
      messageCharLength,
    } = features;

    const sat = ES_CONFIG.saturation;
    const w = ES_CONFIG.weights;

    const capsScore = Math.min(1, 3 * capsRatio);
    const exclScore = Math.min(1, exclamationCount / sat.exclamation);
    const questScore =
      Math.min(1, questionCount / sat.question) +
      (hasMixedPunctuation ? 0.2 : 0);

    const emojiScore = Math.min(1, emojiCount / sat.emoji);
    const lengthScore = Math.min(1, expressiveLengtheningCount / sat.lengthening);
    const intensScore = Math.min(1, intensifierCount / sat.intensifier);
    const interjScore = Math.min(1, interjectionCount / sat.interjection);

    let esRaw =
      w.caps * capsScore +
      w.exclamation * exclScore +
      w.question * questScore +
      w.emoji * emojiScore +
      w.lengthening * lengthScore +
      w.intensifier * intensScore +
      w.interjection * interjScore;

    if (
      messageCharLength < ES_CONFIG.shortMessage.maxLength &&
      (capsScore > 0.5 || exclScore > 0.5 || emojiScore > 0.5)
    ) {
      esRaw += ES_CONFIG.shortMessage.boost;
    }

    const es = Math.max(
      ES_CONFIG.clipMin,
      Math.min(ES_CONFIG.clipMax, esRaw)
    );

    return {
      es,
      breakdown: {
        capsScore,
        exclScore,
        questScore,
        emojiScore,
        lengthScore,
        intensScore,
        interjScore,
      },
    };
  }
}