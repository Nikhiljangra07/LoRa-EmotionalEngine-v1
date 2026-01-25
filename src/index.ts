import { EngineOrchestrator } from './emotion-core/engines/EngineOrchestrator';
import { InputProcessor } from './emotion-core/processors/InputProcessor';

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
  engine.processMessage(analyzerOutputs);
}

const sessionResult = engine.endSession();

console.log(`Current ETV after session: ${sessionResult.newETV.toFixed(3)}`);
console.log('\n=== Test Complete ===\n');
