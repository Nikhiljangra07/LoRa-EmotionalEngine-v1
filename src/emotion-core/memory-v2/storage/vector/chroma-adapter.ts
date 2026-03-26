import { ChromaClient } from 'chromadb';
import type { Collection } from 'chromadb';
import type { IVectorStore } from '../interfaces';
import type { SessionFingerprint, EmotionalFingerprint } from '../../types';
import { encodeFingerprint } from './encoding';

// ──────────────────────────────────────────────────────
// ChromaDB implementation of IVectorStore
// Used for local development and testing.
// Production target: Pinecone (separate adapter).
// ──────────────────────────────────────────────────────

const COLLECTION_NAME = 'lora_memory_v2';

export interface ChromaAdapterConfig {
  /** ChromaDB server URL (default: http://localhost:8000) */
  url?: string;
}

/**
 * Serialize a SessionFingerprint to JSON for storage in ChromaDB metadata.
 * ChromaDB metadata values must be string | number | boolean.
 */
function serializeFingerprint(fp: SessionFingerprint): string {
  return JSON.stringify(fp);
}

/**
 * Deserialize a SessionFingerprint from ChromaDB metadata.
 */
function deserializeFingerprint(json: string): SessionFingerprint | null {
  try {
    const parsed = JSON.parse(json);
    // Minimal shape check — must have sessionId and emotionalFingerprint
    if (
      typeof parsed === 'object' && parsed !== null &&
      typeof parsed.sessionId === 'string' &&
      typeof parsed.emotionalFingerprint === 'object' && parsed.emotionalFingerprint !== null
    ) {
      return parsed as SessionFingerprint;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Build a unique document ID for ChromaDB: userId__sessionId
 */
function makeDocId(userId: string, sessionId: string): string {
  return `${userId}__${sessionId}`;
}

export class ChromaVectorStore implements IVectorStore {
  private client: ChromaClient;
  private collection: Collection | null = null;

  constructor(config?: ChromaAdapterConfig) {
    this.client = new ChromaClient({
      path: config?.url ?? 'http://localhost:8000',
    });
  }

  /**
   * Get or create the collection (lazy init).
   */
  private async getCollection(): Promise<Collection> {
    if (!this.collection) {
      this.collection = await this.client.getOrCreateCollection({
        name: COLLECTION_NAME,
        metadata: { 'hnsw:space': 'cosine' },
      });
    }
    return this.collection;
  }

  async store(userId: string, fingerprint: SessionFingerprint): Promise<void> {
    const collection = await this.getCollection();
    const vector = encodeFingerprint(fingerprint.emotionalFingerprint);
    const docId = makeDocId(userId, fingerprint.sessionId);

    await collection.upsert({
      ids: [docId],
      embeddings: [vector],
      metadatas: [{
        userId,
        sessionId: fingerprint.sessionId,
        importanceScore: fingerprint.importanceScore,
        timestamp: fingerprint.timestamp,
        accessCount: fingerprint.accessCount,
        // Full fingerprint stored as JSON string for reconstruction
        fingerprint_json: serializeFingerprint(fingerprint),
      }],
    });
  }

  async querySimilar(
    userId: string,
    currentFingerprint: EmotionalFingerprint,
    limit: number,
  ): Promise<SessionFingerprint[]> {
    const collection = await this.getCollection();
    const queryVector = encodeFingerprint(currentFingerprint);

    const results = await collection.query({
      queryEmbeddings: [queryVector],
      nResults: limit,
      where: { userId },
    });

    if (!results.metadatas || results.metadatas.length === 0) {
      return [];
    }

    const fingerprints: SessionFingerprint[] = [];
    const metadatas = results.metadatas[0];
    if (metadatas) {
      for (const meta of metadatas) {
        if (meta && typeof meta['fingerprint_json'] === 'string') {
          const fp = deserializeFingerprint(meta['fingerprint_json']);
          if (fp) fingerprints.push(fp);
        }
      }
    }

    return fingerprints;
  }

  async delete(userId: string, sessionId: string): Promise<void> {
    const collection = await this.getCollection();
    const docId = makeDocId(userId, sessionId);
    await collection.delete({ ids: [docId] });
  }

  async purgeUser(userId: string): Promise<void> {
    const collection = await this.getCollection();
    await collection.delete({ where: { userId } });
  }
}
