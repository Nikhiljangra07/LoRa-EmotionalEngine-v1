require('dotenv').config({ path: '.env.local' });

import readline from 'readline';
import { EngineOrchestrator } from '../emotion-core/engines/EngineOrchestrator';
import { EmotionalState } from '../emotion-core/types/analysis.types';
import { AnalyzerOutputs } from '../emotion-core/processors/EIVComponentAssembler';

/* --------------------------------------------------
 * Simple V1 analyzer mapper (INTENTIONAL)
 * This is NOT final NLP — just signal scaffolding
 * -------------------------------------------------- */
function analyzeInput(text: string): AnalyzerOutputs {
  const hasCaps = text !== text.toLowerCase();
  const hasEmoji = /[\u{1F300}-\u{1F6FF}]/u.test(text);
  const punctuationCount = (text.match(/[!?]/g) || []).length;
  const repetition = /(.)\1{2,}/.test(text);

  const expressionStrength = Math.min(
    (punctuationCount * 0.15) + (repetition ? 0.2 : 0),
    1
  );
  const arousal = Math.min(
    (hasCaps ? 0.2 : 0) + (hasEmoji ? 0.2 : 0) + expressionStrength * 0.6,
    1
  );

  return {
    expressionStrength: {
      score: expressionStrength,
      confidence: 0.6,
    },
    valence: {
      score: hasEmoji ? 0.2 : 0,
      confidence: 0.5,
    },
    arousal: {
      score: arousal,
      confidence: 0.6,
    },
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