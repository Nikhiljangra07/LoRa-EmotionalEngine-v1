import { getChromaClient } from './chromaClient';
import { registerEmbeddingFunction } from 'chromadb';
import { roundForSerialization } from '../determinism';
import { deterministicSort } from '../determinism';
import type { SchemaRecord } from '../schemaStore';

const COLLECTION_NAME = 'lora_schemas';
const ROUND_DECIMALS = 6;

/** Dimension of schema centroid vectors in memory-v1 (must match). */
const SCHEMA_VECTOR_DIM = 21;

/**
 * Lightweight deterministic embedding function for the lora_schemas collection only.
 * We do not use semantic search yet; we always provide embeddings directly in add/upsert.
 * Chroma requires an embedding function to be configured to avoid warnings and to make
 * add/query safe. This stub satisfies the interface with no network calls and serializes
 * as a "known" type so the client does not warn when the collection is fetched from the server.
 */
const LORA_STUB_EF_NAME = 'lora-schema-stub';

class LoraSchemaStubEmbeddingFunction {
  readonly name = LORA_STUB_EF_NAME;

  async generate(texts: string[]): Promise<number[][]> {
    return texts.map((t) => deterministicVector(hashString(t), SCHEMA_VECTOR_DIM));
  }

  getConfig(): Record<string, unknown> {
    return { dim: SCHEMA_VECTOR_DIM };
  }

  static buildFromConfig(_config: Record<string, unknown>): LoraSchemaStubEmbeddingFunction {
    return new LoraSchemaStubEmbeddingFunction();
  }
}

function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

function deterministicVector(seed: number, dim: number): number[] {
  const out: number[] = [];
  let s = seed;
  for (let i = 0; i < dim; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out.push((s / 0x100000000) * 2 - 1);
  }
  const norm = Math.sqrt(out.reduce((sum, x) => sum + x * x, 0)) || 1;
  return out.map((x) => x / norm);
}

let registered = false;
function ensureStubRegistered(): void {
  if (registered) return;
  try {
    registerEmbeddingFunction(LORA_STUB_EF_NAME, LoraSchemaStubEmbeddingFunction as any);
    registered = true;
  } catch {
    registered = true;
  }
}

export class ChromaSchemaAdapter {
  private async getCollection() {
    ensureStubRegistered();
    const client = getChromaClient();
    return client.getOrCreateCollection({
      name: COLLECTION_NAME,
      metadata: { 'hnsw:space': 'cosine' },
      embeddingFunction: new LoraSchemaStubEmbeddingFunction(),
    });
  }

  async saveSchemas(
    userId: string,
    schemas: SchemaRecord[],
  ): Promise<boolean> {
    try {
      const collection = await this.getCollection();

      if (schemas.length === 0) {
        return true;
      }

      const ids: string[] = [];
      const embeddings: number[][] = [];
      const metadatas: Array<Record<string, string | number>> = [];

      for (const s of schemas) {
        ids.push(`${userId}::${s.schemaId}`);
        embeddings.push(roundForSerialization(s.centroid, ROUND_DECIMALS));
        metadatas.push({
          userId,
          schemaId: s.schemaId,
          salienceWeight: s.salienceWeight,
          episodeCount: s.episodeCount,
          retrievalBias: s.retrievalBias,
          createdAt: s.createdAt,
          lastUpdatedAt: s.lastUpdatedAt,
        });
      }

      await collection.upsert({ ids, embeddings, metadatas });
      return true;
    } catch {
      return false;
    }
  }

  async loadSchemas(userId: string): Promise<SchemaRecord[] | null> {
    try {
      const collection = await this.getCollection();

      const result = await collection.get({
        where: { userId },
        include: ['metadatas', 'embeddings'],
      });

      if (!result.ids || result.ids.length === 0) {
        return [];
      }

      const schemas: SchemaRecord[] = [];

      for (let i = 0; i < result.ids.length; i++) {
        const meta = result.metadatas?.[i] as Record<string, unknown> | undefined;
        const embedding = result.embeddings?.[i] as number[] | undefined;

        if (!meta || !embedding) continue;

        schemas.push({
          schemaId: String(meta.schemaId ?? ''),
          centroid: roundForSerialization(embedding, ROUND_DECIMALS),
          salienceWeight: Number(meta.salienceWeight ?? 0),
          episodeCount: Number(meta.episodeCount ?? 0),
          retrievalBias: Number(meta.retrievalBias ?? 0),
          createdAt: Number(meta.createdAt ?? 0),
          lastUpdatedAt: Number(meta.lastUpdatedAt ?? 0),
        });
      }

      return deterministicSort(schemas, 'schemaId');
    } catch {
      return null;
    }
  }

  async purgeUser(userId: string): Promise<boolean> {
    try {
      const collection = await this.getCollection();
      await collection.delete({ where: { userId } });
      return true;
    } catch {
      return false;
    }
  }
}
