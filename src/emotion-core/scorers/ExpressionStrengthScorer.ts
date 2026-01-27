import { ES_BASELINE_FLOOR, ES_CONFIG } from "../config/es.config";
import { MASTER_CONSTANTS } from "../config/master.constants";
import {
  ExpressionStrengthFeatures,
  ExpressionStrengthResult,
} from "../types/ExpressionStrength";

export class ExpressionStrengthScorer {
  static compute(features: ExpressionStrengthFeatures): ExpressionStrengthResult {
    const esConstants = MASTER_CONSTANTS.es;
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

    const capsScore = Math.min(
      esConstants.clip.max,
      esConstants.scoring.capsRatioMultiplier * capsRatio
    );
    const exclScore = Math.min(
      esConstants.clip.max,
      exclamationCount / sat.exclamation
    );
    const questScore =
      Math.min(esConstants.clip.max, questionCount / sat.question) +
      (hasMixedPunctuation ? esConstants.scoring.mixedPunctuationBoost : 0);

    const emojiScore = Math.min(esConstants.clip.max, emojiCount / sat.emoji);
    const lengthScore = Math.min(
      esConstants.clip.max,
      expressiveLengtheningCount / sat.lengthening
    );
    const intensScore = Math.min(
      esConstants.clip.max,
      intensifierCount / sat.intensifier
    );
    const interjScore = Math.min(
      esConstants.clip.max,
      interjectionCount / sat.interjection
    );

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
      (capsScore > esConstants.shortMessage.scoreThreshold ||
        exclScore > esConstants.shortMessage.scoreThreshold ||
        emojiScore > esConstants.shortMessage.scoreThreshold)
    ) {
      esRaw += ES_CONFIG.shortMessage.boost;
    }

    const esRawWithFloor =
      features.hasText && esRaw < ES_BASELINE_FLOOR ? ES_BASELINE_FLOOR : esRaw;

    const es = Math.max(
      ES_CONFIG.clipMin,
      Math.min(ES_CONFIG.clipMax, esRawWithFloor)
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