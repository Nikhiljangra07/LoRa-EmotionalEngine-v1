// src/emotion-core/scorers/EIVScorer.ts

import { composeEIV } from "./EIVComposer";
import { EIVComponents, EIVResult } from "../types/eiv.types";
import { getEIVTier } from "./eivTiers";
import { mapEIVComponentsToInputs } from "./mapEIVComponentsToInputs";

export class EIVScorer {
  static calculate(components: EIVComponents): EIVResult {
    const inputs = mapEIVComponentsToInputs(components);
    const composition = composeEIV(inputs);
    const tier = getEIVTier(composition.value);

    const breakdown = {
      rawComponents: { ...components },
      weightedComponents: {
        expressionStrength: 0,
        valence: 0,
        arousal: 0,
      },
      dominantSignals: [],
      tier,
      rawValue: Number(composition.base.toFixed(4)),
      finalValue: Number(composition.value.toFixed(4)),
    };

    return {
      value: composition.value,
      components: { ...components },
      breakdown,
      timestamp: Date.now(),
    };
  }
}
