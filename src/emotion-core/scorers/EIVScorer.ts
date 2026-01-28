// src/emotion-core/scorers/EIVScorer.ts

import { composeEIV, type EIVInputs } from "./EIVComposer";
import { EIVComponents, EIVResult } from "../types/eiv.types";
import { getEIVTier } from "./eivTiers";

export class EIVScorer {
  static calculate(components: EIVComponents): EIVResult {
    const inputs = components as unknown as EIVInputs;
    const composition = composeEIV(inputs);
    const tier = getEIVTier(composition.value);

    const breakdown = {
      rawComponents: { ...components },
      weightedComponents: {
        linguistic: 0,
        emoji: 0,
        capitalization: 0,
        punctuation: 0,
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
