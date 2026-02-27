import { FalkorAnchorAdapter } from '../src/emotion-core/memory-v1/db/FalkorAnchorAdapter';
import { ChromaSchemaAdapter } from '../src/emotion-core/memory-v1/db/ChromaSchemaAdapter';
import { FalkorFactAnchorStore } from '../src/emotion-core/memory-v1/db/FalkorFactAnchorStore';
import { getFalkorClient, resetFalkorClient } from '../src/emotion-core/memory-v1/db/falkorClient';
import { MemoryService } from '../src/emotion-core/memory-v1/service/MemoryService';
import { PromptTemplateBuilder } from '../src/emotion-core/prompt/PromptTemplateBuilder';
import type { MemorySaveInput } from '../src/emotion-core/memory-v1/service/memoryTypes';
import type { EmotionalState } from '../src/emotion-core/types/analysis.types';
import type { ETVState } from '../src/emotion-core/types/etv.types';

const USER_ID = 'demo-user';

const EMOTION_VEC = [0.3, 0.4, 0.5, 0.7];
const EMOTION_SIGNAL = {
  valence: 0.3,
  arousal: 0.4,
  expressionStrength: 0.5,
  inferenceReliability: 0.7,
};
const METRICS = { etv: 55, eiv: 60, band: 'B4' as const };

function fail(reason: string): never {
  console.error(`[demo-fact-anchors] FAIL: ${reason}`);
  process.exit(1);
}

async function main() {
  const falkorUrl = process.env.LORA_FALKOR_URL ?? 'redis://localhost:6379';
  const chromaUrl = process.env.LORA_CHROMA_URL;
  if (!chromaUrl) fail('LORA_CHROMA_URL is not set');

  // Suppress ioredis unhandled error noise during connectivity probes
  getFalkorClient().on('error', () => {});

  const anchorAdapter = new FalkorAnchorAdapter();
  const chromaAdapter = new ChromaSchemaAdapter();
  const factStore = new FalkorFactAnchorStore();
  const svc = new MemoryService(anchorAdapter, chromaAdapter, factStore);

  const health = await svc.healthCheck();
  if (!health.falkor) fail(`FalkorDB unreachable at ${falkorUrl}`);
  if (!health.chroma) fail(`ChromaDB unreachable at ${chromaUrl}`);

  const nowMs = Date.now();

  const msg1: MemorySaveInput = {
    userId: USER_ID,
    messageId: 'demo-msg-1',
    content: 'my goal is exercise every day',
    timestamp: nowMs - 60_000,
    emotion: EMOTION_SIGNAL,
    metrics: METRICS,
    sessionId: 'sess-1',
    emotionVec: EMOTION_VEC,
  };

  const msg2: MemorySaveInput = {
    userId: USER_ID,
    messageId: 'demo-msg-2',
    content: 'reminder: my goal is exercise',
    timestamp: nowMs,
    emotion: EMOTION_SIGNAL,
    metrics: METRICS,
    sessionId: 'sess-2',
    emotionVec: EMOTION_VEC,
  };

  await svc.saveMessage(msg1);
  await svc.saveMessage(msg2);

  await svc.maintainAnchors(USER_ID, 'sess-2', nowMs);

  const ctx = await svc.retrieveContext(USER_ID, '', {
    emotionVec: EMOTION_VEC,
    nowMs,
    band: 'B4',
  });

  console.log('--- degraded flags ---');
  console.log(JSON.stringify(ctx.degraded));

  console.log('--- returned anchors ---');
  for (const a of ctx.anchors) {
    console.log(`  ${a.anchorId}  ${a.contentSummary}`);
  }

  if (ctx.anchors.length > 0) {
    const emotionalState: EmotionalState = {
      dominant: 'NEUTRAL',
      arousal: 'LOW',
      valence: 'NEUTRAL',
      confidence: 0.5,
    };
    const etvState: ETVState = {
      value: 0.5,
      sessionEIVs: [],
      messageCount: 1,
      lastUpdated: nowMs,
    };
    const prompt = PromptTemplateBuilder.build(emotionalState, etvState, {
      relevantAnchors: ctx.anchors,
    });

    const factIdx = prompt.indexOf('FACT CONTEXT');
    if (factIdx >= 0) {
      console.log('--- FACT CONTEXT block ---');
      console.log(prompt.slice(factIdx).trim());
    } else {
      console.log('--- FACT CONTEXT block ---');
      console.log('(none — anchors may be below B2 eligibility)');
    }
  } else {
    console.log('--- FACT CONTEXT block ---');
    console.log('(no anchors returned)');
  }

  if (process.env.LORA_DEMO_KEEP !== '1') {
    await svc.purgeUser(USER_ID);
    console.log('--- cleanup: demo-user purged ---');
  } else {
    console.log('--- cleanup: skipped (LORA_DEMO_KEEP=1) ---');
  }

  resetFalkorClient();
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
