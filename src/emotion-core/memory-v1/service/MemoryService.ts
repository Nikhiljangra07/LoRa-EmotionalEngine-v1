import { FalkorAnchorAdapter, type AnchorRow } from '../db/FalkorAnchorAdapter';
import { ChromaSchemaAdapter } from '../db/ChromaSchemaAdapter';
import type { SchemaRecord } from '../schemaStore';

/**
 * Must match the embedding dimension of the lora_schemas collection.
 * The collection dimension is set by the first upsert; the existing
 * ChromaSchemaAdapter tests establish it at 5.
 */
const STUB_VECTOR_DIM = 5;

export interface MemorySaveInput {
  userId: string;
  messageId: string;
  content: string;
  timestamp: number;
  etv?: number;
  eiv?: number;
}

export interface AnchorRecord {
  anchorId: string;
  content: string;
  timestamp: number;
  etv?: number;
  eiv?: number;
}

export interface SemanticRecord {
  schemaId: string;
  salienceWeight: number;
  episodeCount: number;
  createdAt: number;
  lastUpdatedAt: number;
}

export interface MemoryContextResult {
  anchors: AnchorRecord[];
  semantic: SemanticRecord[];
}

export class MemoryService {
  constructor(
    private anchorAdapter: FalkorAnchorAdapter,
    private vectorAdapter: ChromaSchemaAdapter,
  ) {}

  async saveMessage(input: MemorySaveInput): Promise<boolean> {
    const { userId, messageId, content, timestamp, etv, eiv } = input;

    const schema: SchemaRecord = {
      schemaId: messageId,
      centroid: deterministicVector(hashString(content), STUB_VECTOR_DIM),
      salienceWeight: etv ?? 0,
      episodeCount: 1,
      retrievalBias: 0,
      createdAt: timestamp,
      lastUpdatedAt: timestamp,
    };

    const [anchorOk, vectorOk] = await Promise.all([
      this.anchorAdapter.upsertAnchor(userId, messageId, { content, timestamp, etv, eiv }),
      this.vectorAdapter.saveSchemas(userId, [schema]),
    ]);

    return anchorOk && vectorOk;
  }

  /**
   * Retrieve context for a user. The query parameter is accepted for future
   * similarity ranking but is not used yet (deterministic fetch only).
   */
  async retrieveContext(userId: string, _query: string): Promise<MemoryContextResult | null> {
    const [rawAnchors, rawSchemas] = await Promise.all([
      this.anchorAdapter.getAnchors(userId),
      this.vectorAdapter.loadSchemas(userId),
    ]);

    if (rawAnchors === null || rawSchemas === null) return null;

    return {
      anchors: rawAnchors.map(toAnchorRecord),
      semantic: rawSchemas.map(toSemanticRecord),
    };
  }

  async purgeUser(userId: string): Promise<boolean> {
    const [falkorOk, chromaOk] = await Promise.all([
      this.anchorAdapter.purgeUser(userId),
      this.vectorAdapter.purgeUser(userId),
    ]);
    return falkorOk && chromaOk;
  }

  async healthCheck(): Promise<{ falkor: boolean; chroma: boolean }> {
    const [falkorResult, chromaResult] = await Promise.all([
      this.anchorAdapter.getAnchors('__healthcheck__').catch(() => null),
      this.vectorAdapter.loadSchemas('__healthcheck__').catch(() => null),
    ]);
    return {
      falkor: falkorResult !== null,
      chroma: chromaResult !== null,
    };
  }
}

function toAnchorRecord(row: AnchorRow): AnchorRecord {
  const p = row.payload as Record<string, unknown> | null;
  return {
    anchorId: row.anchorId,
    content: typeof p?.content === 'string' ? p.content : '',
    timestamp: typeof p?.timestamp === 'number' ? p.timestamp : 0,
    etv: typeof p?.etv === 'number' ? p.etv : undefined,
    eiv: typeof p?.eiv === 'number' ? p.eiv : undefined,
  };
}

function toSemanticRecord(s: SchemaRecord): SemanticRecord {
  return {
    schemaId: s.schemaId,
    salienceWeight: s.salienceWeight,
    episodeCount: s.episodeCount,
    createdAt: s.createdAt,
    lastUpdatedAt: s.lastUpdatedAt,
  };
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
