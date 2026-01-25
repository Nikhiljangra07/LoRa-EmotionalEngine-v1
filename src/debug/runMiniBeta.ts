// src/debug/runMiniBeta.ts

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { EngineOrchestrator } from '../emotion-core/engines/EngineOrchestrator';
import { EmotionalState } from '../emotion-core/types/analysis.types';
import { AnalyzerOutputs } from '../emotion-core/processors/EIVComponentAssembler';

/**
 * ----------------------------------------------------
 * MINI BETA DRIVER
 * ----------------------------------------------------
 * Purpose:
 * - End-to-end validation of LoRa v1 core loop
 * - No real analyzers yet (manual control)
 * - Deterministic + inspectable behavior
 */

// ---- MOCK ANALYZER OUTPUTS (NORMALIZED 0–1) ----
const analyzerOutputs: AnalyzerOutputs = {
  linguisticScore: 0.35,        // placeholder semantic load
  emojiScore: 0.0,              // no emoji used
  capitalizationScore: 0.1,     // mild caps
  punctuationScore: 0.2,        // some punctuation emphasis
};

// ---- MOCK EMOTIONAL STATE ----
const emotionalState: EmotionalState = {
  dominant: 'ANGER',
  arousal: 'LOW',
  valence: 'NEGATIVE',
  confidence: 0.4,
};

async function runTest() {
  console.log('--- LoRa Mini Beta Test ---');
  console.log('API KEY PRESENT:', !!process.env.OPENAI_API_KEY);

  const engine = new EngineOrchestrator(0.5);

  const result = await engine.processMessage(
    analyzerOutputs,
    emotionalState,
    false,                       // no safety violation
    { ambiguityDetected: false },
    'neutral'                    // simulated user feedback
  );

  console.log('\n--- RESULT ---');
  console.log('EIV:', result.eiv.value);
  console.log('EIV Tier:', result.eiv.breakdown.tier);
  console.log('Prompt:\n', result.prompt);
  console.log('LLM Output:\n', result.llmOutput);

  engine.endSession();
}

runTest().catch((err) => {
  console.error('Mini beta failed:', err);
});
