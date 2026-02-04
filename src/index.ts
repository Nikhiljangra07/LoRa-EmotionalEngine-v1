import { EngineOrchestrator } from './emotion-core/engines/EngineOrchestrator';
import { InputProcessor } from './emotion-core/processors/InputProcessor';
import { EmotionalState } from './emotion-core/types/analysis.types';

console.log('\n=== LoRa Emotional Engine V1 — REAL MESSAGE TEST ===\n');

const engine = new EngineOrchestrator(0.3);

const messages = [
  "Hey.",
  "I'm fine, just tired...",
  "THIS IS AMAZING!!! 😄😄",
  "Why would you even do that???!!!"
];

for (const msg of messages) {
  const analyzerOutputs = InputProcessor.process(msg);
  const emotionalState: EmotionalState = {
    dominant: 'NEUTRAL',
    arousal: 'LOW',
    valence: 'NEUTRAL',
    confidence: 0.5,
  };
  engine.processMessage(analyzerOutputs, emotionalState);
}

const sessionResult = engine.endSession();

console.log(`Current ETV after session: ${sessionResult.newETV.toFixed(3)}`);
console.log('\n=== Test Complete ===\n');
