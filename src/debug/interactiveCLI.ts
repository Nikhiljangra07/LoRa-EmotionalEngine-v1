require('dotenv').config({ path: '.env.local' });

import readline from 'readline';
import { EngineOrchestrator } from '../emotion-core/engines/EngineOrchestrator';
import { EmotionalState } from '../emotion-core/types/analysis.types';

/* --------------------------------------------------
 * Simple V1 analyzer mapper (INTENTIONAL)
 * This is NOT final NLP — just signal scaffolding
 * -------------------------------------------------- */
function analyzeInput(text: string) {
  const hasCaps = text !== text.toLowerCase();
  const hasEmoji = /[\u{1F300}-\u{1F6FF}]/u.test(text);
  const punctuationCount = (text.match(/[!?]/g) || []).length;
  const repetition = /(.)\1{2,}/.test(text);

  return {
    linguisticScore: repetition ? 0.4 : 0.2,
    emojiScore: hasEmoji ? 0.6 : 0,
    capitalizationScore: hasCaps ? 0.4 : 0,
    punctuationScore: Math.min(punctuationCount * 0.15, 1),
  };
}

/* --------------------------------------------------
 * Simple emotional interpreter (V1)
 * -------------------------------------------------- */
function interpretEmotion(text: string): EmotionalState {
  const lower = text.toLowerCase();

  if (lower.includes('sad') || lower.includes('tired') || lower.includes('off')) {
    return {
      dominant: 'SADNESS',
      arousal: 'LOW',
      valence: 'NEGATIVE',
      confidence: 0.6,
    };
  }

  if (lower.includes('angry') || lower.includes('frustrated')) {
    return {
      dominant: 'ANGER',
      arousal: 'MEDIUM',
      valence: 'NEGATIVE',
      confidence: 0.7,
    };
  }

  if (lower.includes('happy') || lower.includes('good')) {
    return {
      dominant: 'JOY',
      arousal: 'MEDIUM',
      valence: 'POSITIVE',
      confidence: 0.6,
    };
  }

  return {
    dominant: 'NEUTRAL',
    arousal: 'LOW',
    valence: 'NEUTRAL',
    confidence: 0.5,
  };
}

/* --------------------------------------------------
 * CLI Loop
 * -------------------------------------------------- */
async function startCLI() {
  console.log('\n--- LoRa Interactive CLI ---');
  console.log('Type your message. Type "exit" to quit.\n');

  const orchestrator = new EngineOrchestrator();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.on('line', async (input) => {
    if (input.trim().toLowerCase() === 'exit') {
      orchestrator.endSession();
      rl.close();
      process.exit(0);
    }

    const analyzerOutputs = analyzeInput(input);
    const emotionalState = interpretEmotion(input);

    const result = await orchestrator.processMessage(
      analyzerOutputs,
      emotionalState,
      false,
      {},
      undefined
    );

    console.log('\nLoRa:', result.llmOutput, '\n');
  });
}

startCLI();