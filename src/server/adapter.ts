import express from 'express';
import { EngineOrchestrator } from '../emotion-core/engines/EngineOrchestrator';
import { InputProcessor } from '../emotion-core/processors/InputProcessor';
import { EIVComponentAssembler } from '../emotion-core/processors/EIVComponentAssembler';
import { EIVScorer } from '../emotion-core/scorers/EIVScorer';
import { EmotionalStateInterpreter } from '../emotion-core/processors/EmotionalStateInterpreter';
import type { EmotionalState } from '../emotion-core/types/analysis.types';

const app = express();
const port = 3001;
const debugEnabled = process.env.LORA_DEBUG === '1';

app.use(express.json());

app.post('/chat', async (req, res) => {
  const message =
    typeof req.body?.message === 'string' ? req.body.message : '';

  if (!message) {
    return res.status(400).json({ reply: '' });
  }

  try {
    const engine = new EngineOrchestrator();
    const { analyzerOutputs, signalPacket } =
      InputProcessor.process(message);
    const components =
      EIVComponentAssembler.assemble(analyzerOutputs);
    const eivResult = EIVScorer.calculate(components);
    const interpreted = EmotionalStateInterpreter.interpret(
      analyzerOutputs,
      eivResult.value
    );
    const emotionalState: EmotionalState = {
      dominant: 'NEUTRAL',
      arousal: interpreted.arousal,
      valence: interpreted.valence,
      confidence: analyzerOutputs.valence.confidence,
    };

    const result = await engine.processMessage(
      analyzerOutputs,
      emotionalState,
      false,
      {},
      undefined,
      signalPacket
    );

    if (debugEnabled) {
      console.log('[LoRa::Adapter]', { message, reply: result.llmOutput });
    }

    return res.json({ reply: result.llmOutput });
  } catch (error) {
    if (debugEnabled) {
      console.log('[LoRa::Adapter]', 'error');
    }
    return res.status(500).json({ reply: '' });
  }
});

app.listen(port, () => {
  if (debugEnabled) {
    console.log(`[LoRa::Adapter] listening on ${port}`);
  }
});
