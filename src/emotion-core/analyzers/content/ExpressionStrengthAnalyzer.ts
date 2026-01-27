import { ES_CONFIG } from "../../config/es.config";
import { computeES, type ESConfig } from "../../scorers/computeES";
import type { ExpressionStrengthFeatures } from "../../types/ExpressionStrength";

export type AnalyzerOutput<TMeta = unknown> = {
  score: number;
  dimension: "expression_strength";
  metadata?: TMeta;
};

export class ExpressionStrengthAnalyzer {
  public readonly name = "ExpressionStrengthAnalyzer";
  public readonly version = "1.0.0";

  private cfg: ESConfig;

  constructor(cfg: Partial<ESConfig> = {}) {
    this.cfg = {
      ...ES_CONFIG,
      ...cfg,
      weights: { ...ES_CONFIG.weights, ...(cfg as ESConfig).weights },
      saturation: { ...ES_CONFIG.saturation, ...(cfg as ESConfig).saturation },
      shortMessage: { ...ES_CONFIG.shortMessage, ...(cfg as ESConfig).shortMessage },
    };
  }

  analyze(features: ExpressionStrengthFeatures): AnalyzerOutput {
    const { es, breakdown } = computeES(features, this.cfg);

    return {
      score: es,
      dimension: "expression_strength",
      metadata: {
        breakdown,
        config: {
          weights: this.cfg.weights,
          saturation: this.cfg.saturation,
          shortMessage: this.cfg.shortMessage,
        },
      },
    };
  }
}