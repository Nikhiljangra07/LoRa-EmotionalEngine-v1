/**
 * Reset the Chroma lora_schemas collection (delete and recreate).
 * Use when switching to manual-embedding mode or clearing schema state.
 * Requires LORA_CHROMA_URL.
 */
import { getChromaClient } from '../src/emotion-core/memory-v1/db/chromaClient';

const COLLECTION_NAME = 'lora_schemas';

async function reset(): Promise<void> {
  const client = getChromaClient();
  try {
    await client.deleteCollection({ name: COLLECTION_NAME });
  } catch {
    // Collection may not exist
  }
  await client.getOrCreateCollection({
    name: COLLECTION_NAME,
    metadata: { 'hnsw:space': 'cosine' },
  });
  console.log('[LoRa] Chroma schemas collection reset (manual-embedding mode)');
}

reset().catch((err) => {
  console.error(err);
  process.exit(1);
});
