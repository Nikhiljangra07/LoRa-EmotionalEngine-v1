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
      emojiCount,
      expressiveLengtheningCount,
      messageCharLength,
    } = features;

    const sat = ES_CONFIG.saturation;
    const w = ES_CONFIG.weights;
    const { zero: ZERO } = ES_CONFIG.numbers;
    const totalChars = Math.max(
      messageCharLength,
      ES_CONFIG.density.minTotalChars
    );
    const exclamationDensity = exclamationCount / totalChars;
    const questionDensity = questionCount / totalChars;
    const emojiDensity = emojiCount / totalChars;
    const elongationDensity = expressiveLengtheningCount / totalChars;

    const capsScore = Math.min(
      esConstants.clip.max,
      esConstants.scoring.capsRatioMultiplier * capsRatio
    );
    const exclScore = Math.min(
      esConstants.clip.max,
      exclamationDensity * sat.exclamation
    );
    const questScore = Math.min(
      esConstants.clip.max,
      questionDensity * sat.question
    );

    const emojiScore = Math.min(
      esConstants.clip.max,
      emojiDensity * sat.emoji
    );
    const lengthScore = Math.min(
      esConstants.clip.max,
      elongationDensity * sat.lengthening
    );
    const intensScore = ZERO;
    const interjScore = ZERO;

    let esRaw =
      w.caps * capsScore +
      w.exclamation * exclScore +
      w.question * questScore +
      w.emoji * emojiScore +
      w.lengthening * lengthScore +
      w.intensifier * intensScore +
      w.interjection * interjScore;

    esRaw += ZERO;

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