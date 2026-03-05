import { getChromaClient } from './chromaClient';
import { roundForSerialization } from '../determinism';
import { deterministicSort } from '../determinism';
import type { SchemaRecord } from '../schemaStore';

const COLLECTION_NAME = 'lora_schemas';
const ROUND_DECIMALS = 6;

/**
 * Chroma runs in manual embedding mode: we always pass embeddings explicitly.
 * No embedding function is registered; collection is created without one.
 */
export class ChromaSchemaAdapter {
  private async getCollection() {
    const client = getChromaClient();
    return client.getOrCreateCollection({
      name: COLLECTION_NAME,
      metadata: { 'hnsw:space': 'cosine' },
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

      if (!embeddings || embeddings.length === 0) {
        throw new Error('Manual embedding required for Chroma upsert');
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
