/**
 * Ekman Family Weighting — Modifies hint overlays based on dominant Ekman emotion.
 *
 * Each family adjusts existing hint values directionally:
 *   SADNESS  → increase validation, reduce interruption
 *   ANGER    → increase interruption allowance, reduce question budget
 *   FEAR     → enforce pacing=SLOW, enforce short sentences
 *   DISGUST  → reduce emotional warmth, increase directness
 *   JOY      → allow ENERGY_MATCH more aggressively
 *
 * These modify hints, not raw LLM text.
 */

import type { EkmanDominant } from '../emotion-core/types/analysis.types';
import type {
  PacingHint,
  ValidationIntensity,
  InterruptHint,
  QuestionBudgetHint,
} from '../emotion-core/types/logging.types';

export interface EkmanHintModifiers {
  pacingHint?: PacingHint;
  validationIntensity?: ValidationIntensity;
  interruptHint?: InterruptHint;
  questionBudgetHint?: QuestionBudgetHint;
  preferEnergyMatch?: boolean;
  preferDirectness?: boolean;
}

export interface EkmanWeightResult {
  applied: boolean;
  family: EkmanDominant | null;
  modifiers: EkmanHintModifiers;
}

const VALIDATION_TIERS: readonly ValidationIntensity[] = ['LOW', 'MEDIUM', 'HIGH'];

function raiseValidation(current?: ValidationIntensity): ValidationIntensity {
  if (!current) return 'MEDIUM';
  const idx = VALIDATION_TIERS.indexOf(current);
  return VALIDATION_TIERS[Math.min(idx + 1, VALIDATION_TIERS.length - 1)];
}

export function computeEkmanWeighting(
  ekmanDominant: EkmanDominant | undefined,
  ekmanConfidence: number | undefined,
  currentHints: {
    pacingHint?: PacingHint;
    validationIntensity?: ValidationIntensity;
    interruptHint?: InterruptHint;
    questionBudgetHint?: QuestionBudgetHint;
  },
): EkmanWeightResult {
  if (!ekmanDominant || (ekmanConfidence ?? 0) < 0.35) {
    return { applied: false, family: null, modifiers: {} };
  }

  const modifiers: EkmanHintModifiers = {};

  switch (ekmanDominant) {
    case 'SADNESS':
      modifiers.validationIntensity = raiseValidation(currentHints.validationIntensity);
      if (currentHints.interruptHint === 'HARD_STOP') {
        modifiers.interruptHint = 'FIRM';
      } else if (currentHints.interruptHint === 'FIRM') {
        modifiers.interruptHint = 'SOFT';
      }
      break;

    case 'ANGER':
      if (!currentHints.interruptHint || currentHints.interruptHint === 'SOFT') {
        modifiers.interruptHint = 'FIRM';
      }
      if (!currentHints.questionBudgetHint) {
        modifiers.questionBudgetHint = 'ONE';
      } else if (currentHints.questionBudgetHint === 'ONE') {
        modifiers.questionBudgetHint = 'ZERO';
      }
      break;

    case 'FEAR':
      modifiers.pacingHint = 'SLOW';
      break;

    case 'DISGUST':
      modifiers.preferDirectness = true;
      break;

    case 'JOY':
      modifiers.preferEnergyMatch = true;
      break;

    case 'SURPRISE':
      break;
  }

  const hasModifiers = Object.keys(modifiers).length > 0;

  return {
    applied: hasModifiers,
    family: ekmanDominant,
    modifiers,
  };
}
