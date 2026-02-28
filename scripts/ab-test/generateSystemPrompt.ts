/**
 * A/B Test Lab — System prompt capture
 *
 * Uses the real PromptTemplateBuilder to generate a system prompt for a given
 * user message. No LLM calls. No changes to production code paths or feature flags.
 */

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
import { PromptTemplateBuilder } from '../../src/emotion-core/prompt/PromptTemplateBuilder';
import type { EmotionalState } from '../../src/emotion-core/types/analysis.types';
import type { ETVState } from '../../src/emotion-core/types/etv.types';

const DEFAULT_EMOTIONAL_STATE: EmotionalState = {
  dominant: 'NEUTRAL',
  arousal: 'LOW',
  valence: 'NEUTRAL',
  confidence: 0.5,
};

const DEFAULT_ETV_STATE: ETVState = {
  value: 0.35,
  sessionEIVs: [],
  messageCount: 1,
  lastUpdated: Date.now(),
};

export function generateSystemPrompt(_userMessage: string): string {
  const emotionalState = DEFAULT_EMOTIONAL_STATE;
  const etvState = DEFAULT_ETV_STATE;

  const systemPrompt = PromptTemplateBuilder.build(emotionalState, etvState, {
    band: 'B0',
    guidanceMode: 'CALM_NEUTRAL',
    eiv: 0.5,
    narrativeMomentum: {
      dominantTheme: 'work',
      emotionalTrajectory: 'stable',
      currentPhase: 'opening',
      suggestedStrategy: 'validation',
    },
    responseShapeContract: undefined,
  });

  return systemPrompt;
}
