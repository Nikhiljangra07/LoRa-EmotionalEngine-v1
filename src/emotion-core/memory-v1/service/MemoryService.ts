import { FalkorAnchorAdapter, type AnchorRow } from '../db/FalkorAnchorAdapter';
import { ChromaSchemaAdapter } from '../db/ChromaSchemaAdapter';
import type { SchemaRecord } from '../schemaStore';
import {
  type MemorySaveInput,
  type AnchorRecord,
  type SemanticRecord,
  type MemoryContextResult,
  type EmotionSignal,
  type EmotionalMetrics,
  validateEmotionSignal,
  validateMetrics,
  contentSummary,
} from './memoryTypes';

export type {
  MemorySaveInput,
  AnchorRecord,
  SemanticRecord,
  MemoryContextResult,
} from './memoryTypes';
export type { EmotionSignal, EmotionalMetrics, EmotionBand } from './memoryTypes';

/**
 * Must match the embedding dimension of the lora_schemas collection.
 * The collection dimension is set by the first upsert; the existing
 * ChromaSchemaAdapter tests establish it at 5.
 */
const STUB_VECTOR_DIM = 5;

export class MemoryService {
  constructor(
    private anchorAdapter: FalkorAnchorAdapter,
    private vectorAdapter: ChromaSchemaAdapter,
  ) {}

  async saveMessage(input: MemorySaveInput): Promise<boolean> {
    try {
      const { userId, messageId, content, timestamp } = input;
      const emotion = validateEmotionSignal(input.emotion);
      const metrics = validateMetrics(input.metrics);

      const falkorPayload = {
        messageId,
        timestamp,
        contentSummary: contentSummary(content),
        emotion,
        metrics,
      };

      const schema: SchemaRecord = {
        schemaId: messageId,
        centroid: deterministicVector(hashString(content), STUB_VECTOR_DIM),
        salienceWeight: metrics.etv,
        episodeCount: 1,
        retrievalBias: metrics.eiv,
        createdAt: timestamp,
        lastUpdatedAt: timestamp,
      };

      const [anchorOk, vectorOk] = await Promise.all([
        this.anchorAdapter.upsertAnchor(userId, messageId, falkorPayload),
        this.vectorAdapter.saveSchemas(userId, [schema]),
      ]);

      return anchorOk && vectorOk;
    } catch {
      return false;
    }
  }

  /**
   * Retrieve context for a user. Returns degraded flags instead of null
   * when individual DBs fail, so callers always get a usable result.
   * The query parameter is accepted for future similarity ranking.
   */
  async retrieveContext(userId: string, _query: string): Promise<MemoryContextResult> {
    const [rawAnchors, rawSchemas] = await Promise.all([
      this.anchorAdapter.getAnchors(userId).catch(() => null),
      this.vectorAdapter.loadSchemas(userId).catch(() => null),
    ]);

    const falkorDown = rawAnchors === null;
    const chromaDown = rawSchemas === null;

    return {
      anchors: falkorDown ? [] : rawAnchors.map(toAnchorRecord),
      semantic: chromaDown ? [] : rawSchemas.map(toSemanticRecord),
      degraded: { falkor: falkorDown, chroma: chromaDown },
    };
  }

  async purgeUser(userId: string): Promise<boolean> {
    try {
      const [falkorOk, chromaOk] = await Promise.all([
        this.anchorAdapter.purgeUser(userId),
        this.vectorAdapter.purgeUser(userId),
      ]);
      return falkorOk && chromaOk;
    } catch {
      return false;
    }
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

const DEFAULT_EMOTION: EmotionSignal = {
  valence: 0,
  arousal: 0,
  expressionStrength: 0,
  inferenceReliability: 0,
};

const DEFAULT_METRICS: EmotionalMetrics = { etv: 0, eiv: 0 };

function toAnchorRecord(row: AnchorRow): AnchorRecord {
  const p = row.payload as Record<string, unknown> | null;

  const rawEmotion = p?.emotion as Record<string, unknown> | undefined;
  const emotion: EmotionSignal = rawEmotion
    ? {
        valence: typeof rawEmotion.valence === 'number' ? rawEmotion.valence : 0,
        arousal: typeof rawEmotion.arousal === 'number' ? rawEmotion.arousal : 0,
        expressionStrength: typeof rawEmotion.expressionStrength === 'number' ? rawEmotion.expressionStrength : 0,
        inferenceReliability: typeof rawEmotion.inferenceReliability === 'number' ? rawEmotion.inferenceReliability : 0,
      }
    : { ...DEFAULT_EMOTION };

  const rawMetrics = p?.metrics as Record<string, unknown> | undefined;
  const metrics: EmotionalMetrics = rawMetrics
    ? {
        etv: typeof rawMetrics.etv === 'number' ? rawMetrics.etv : 0,
        eiv: typeof rawMetrics.eiv === 'number' ? rawMetrics.eiv : 0,
        ...(typeof rawMetrics.band === 'string' ? { band: rawMetrics.band as EmotionalMetrics['band'] } : {}),
      }
    : { ...DEFAULT_METRICS };

  return {
    anchorId: row.anchorId,
    contentSummary: typeof p?.contentSummary === 'string' ? p.contentSummary : '',
    timestamp: typeof p?.timestamp === 'number' ? p.timestamp : 0,
    emotion,
    metrics,
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
