import { EIVComponents } from "../types/eiv.types";
import { EIVInputs } from "./EIVComposer";

export class EIVComponentMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EIVComponentMappingError";
  }
}

const assertSignal = (
  label: string,
  signal: { score: number; confidence: number } | undefined
) => {
  if (!signal) {
    throw new EIVComponentMappingError(
      `Missing required EIV component: ${label}`
    );
  }
  if (!Number.isFinite(signal.score)) {
    throw new EIVComponentMappingError(
      `Invalid ${label}.score: ${String(signal.score)}`
    );
  }
  if (!Number.isFinite(signal.confidence)) {
    throw new EIVComponentMappingError(
      `Invalid ${label}.confidence: ${String(signal.confidence)}`
    );
  }
};

export function mapEIVComponentsToInputs(
  components: EIVComponents
): EIVInputs {
  assertSignal("expressionStrength", components.expressionStrength);
  assertSignal("valence", components.valence);
  assertSignal("arousal", components.arousal);

  return {
    es: {
      score: components.expressionStrength.score,
      confidence: components.expressionStrength.confidence,
    },
    valence: {
      score: components.valence.score,
      confidence: components.valence.confidence,
    },
    arousal: {
      score: components.arousal.score,
      confidence: components.arousal.confidence,
    },
  };
}
