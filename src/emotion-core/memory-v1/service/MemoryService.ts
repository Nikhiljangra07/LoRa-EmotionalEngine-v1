import { FalkorFactAnchorStore } from '../db/FalkorFactAnchorStore';
import { FalkorAnchorAdapter } from '../db/FalkorAnchorAdapter';
import { ChromaSchemaAdapter } from '../db/ChromaSchemaAdapter';
import { extractFactAnchor } from '../factExtractor';
import { scoreAnchors, type AnchorScore } from '../anchorRelevanceArbiter';
import type { FactAnchor } from '../factAnchorTypes';
import type { SchemaRecord } from '../schemaStore';
import type { MaintainReport, AsyncFactAnchorStore } from '../factAnchorStoreTypes';
import {
  type MemorySaveInput,
  type MemorySaveResult,
  type AnchorRecord,
  type SemanticRecord,
  type MemoryContextResult,
  type RetrieveContextOpts,
  type EmotionSignal,
  type EmotionalMetrics,
  validateEmotionSignal,
  validateMetrics,
  anchorSummaryLabel,
} from './memoryTypes';

export type {
  MemorySaveInput,
  MemorySaveResult,
  AnchorRecord,
  SemanticRecord,
  MemoryContextResult,
  RetrieveContextOpts,
} from './memoryTypes';
export type { EmotionSignal, EmotionalMetrics, EmotionBand } from './memoryTypes';

const STUB_VECTOR_DIM = 5;

export class MemoryService {
  private readonly factStore: AsyncFactAnchorStore;
  private lastMaintainKey: string | null = null;

  constructor(
    _anchorAdapter: FalkorAnchorAdapter,
    private vectorAdapter: ChromaSchemaAdapter,
    factStore?: AsyncFactAnchorStore,
  ) {
    this.factStore = factStore ?? new FalkorFactAnchorStore();
  }

  /**
   * Two-phase save: Falkor first (facts are MVP), then Chroma.
   * Falkor failure → ok=false. Chroma failure never blocks Falkor; degraded.chroma=true.
   */
  async saveMessage(input: MemorySaveInput): Promise<MemorySaveResult> {
    const { userId, messageId, content, timestamp } = input;
    const emotion = validateEmotionSignal(input.emotion);
    const metrics = validateMetrics(input.metrics);
    const sessionId = input.sessionId ?? messageId;
    const emotionVec = input.emotionVec ?? [
      emotion.valence,
      emotion.arousal,
      emotion.expressionStrength,
      emotion.inferenceReliability,
    ];

    let wroteFalkor = false;
    let wroteChroma = false;

    // Phase 1: Falkor anchor upsert
    try {
      const candidate = extractFactAnchor(
        userId,
        content,
        sessionId,
        emotionVec,
        timestamp,
        0,
      );
      if (candidate) {
        const upsertResult = await this.factStore.upsertFromExtraction(userId, {
          userId,
          sessionId,
          nowMs: timestamp,
          extracted: [candidate],
        });
        wroteFalkor = upsertResult !== null;
      } else {
        wroteFalkor = true; // no anchor to write is success
      }
    } catch (err) {
      console.warn('[LoRa::MemoryServiceSave] Falkor upsert failed', err);
    }

    // Phase 2: Chroma schema upsert (never blocks Falkor)
    try {
      const schema: SchemaRecord = {
        schemaId: messageId,
        centroid: deterministicVector(hashString(content), STUB_VECTOR_DIM),
        salienceWeight: metrics.etv,
        episodeCount: 1,
        retrievalBias: metrics.eiv,
        createdAt: timestamp,
        lastUpdatedAt: timestamp,
      };
      wroteChroma = await this.vectorAdapter.saveSchemas(userId, [schema]);
    } catch (err) {
      console.warn('[LoRa::MemoryServiceSave] Chroma upsert failed', err);
    }

    const degraded = { falkor: !wroteFalkor, chroma: !wroteChroma };
    const ok = wroteFalkor; // facts are MVP; ok=false only if Falkor failed
    const result: MemorySaveResult = { ok, wroteFalkor, wroteChroma, degraded };
    console.log(
      '[LoRa::MemoryServiceSave]',
      { wroteFalkor, wroteChroma, ok },
    );
    return result;
  }

  /**
   * Retrieve context for prompt building. Loads confirmed anchors from Falkor,
   * scores them through the relevance arbiter, and loads semantic schemas from
   * Chroma. Returns degraded flags for each DB independently.
   */
  async retrieveContext(
    userId: string,
    _query: string,
    opts?: RetrieveContextOpts,
  ): Promise<MemoryContextResult> {
    const nowMs = opts?.nowMs ?? Date.now();
    const band = opts?.band ?? 'B0';
    const emotionVec = opts?.emotionVec ?? [0, 0, 0, 0];

    const [rawCandidates, rawSchemas] = await Promise.all([
      this.factStore.getCandidates(userId, { nowMs }).catch(() => null),
      this.vectorAdapter.loadSchemas(userId).catch(() => null),
    ]);

    const falkorDown = rawCandidates === null;
    const chromaDown = rawSchemas === null;

    let relevantAnchors: AnchorRecord[] = [];
    if (!falkorDown && rawCandidates.length > 0) {
      const scored: AnchorScore[] = scoreAnchors(rawCandidates, emotionVec, nowMs, band);
      relevantAnchors = scored.map((s) => factAnchorToRecord(s.anchor, band));
    }

    return {
      anchors: relevantAnchors,
      semantic: chromaDown ? [] : (rawSchemas ?? []).map(toSemanticRecord),
      degraded: { falkor: falkorDown, chroma: chromaDown },
    };
  }

  /**
   * Run lifecycle maintenance (promotion, expiry) for the user's anchors.
   * Idempotent per (userId, sessionId) pair — repeated calls in the same
   * session are no-ops and return null.
   */
  async maintainAnchors(
    userId: string,
    sessionId: string,
    nowMs: number,
  ): Promise<MaintainReport | null> {
    const key = `${userId}::${sessionId}`;
    if (this.lastMaintainKey === key) return null;
    try {
      const result = await this.factStore.maintain(userId, { sessionId, nowMs });
      if (result !== null) this.lastMaintainKey = key;
      return result?.report ?? null;
    } catch {
      return null;
    }
  }

  async purgeUser(userId: string): Promise<boolean> {
    try {
      const [falkorOk, chromaOk] = await Promise.all([
        this.factStore.purgeAll(userId),
        this.vectorAdapter.purgeUser(userId),
      ]);
      return falkorOk && chromaOk;
    } catch {
      return false;
    }
  }

  async healthCheck(): Promise<{ falkor: boolean; chroma: boolean }> {
    const [falkorResult, chromaResult] = await Promise.all([
      this.factStore.exportAll('__healthcheck__').catch(() => null),
      chromaHealthProbe(this.vectorAdapter).catch(() => false),
    ]);
    return {
      falkor: falkorResult !== null,
      chroma: chromaResult,
    };
  }

}

function factAnchorToRecord(
  fa: FactAnchor,
  band: string,
): AnchorRecord {
  const vec = fa.emotionVecAtCreation;
  const slotValue =
    fa.value !== undefined
      ? `${fa.summary.slot} = ${fa.value}`
      : undefined;
  return {
    anchorId: fa.anchorId,
    contentSummary: slotValue ?? anchorSummaryLabel(fa.summary.template, fa.summary.slot),
    slotValue,
    timestamp: fa.createdAt,
    emotion: {
      valence: vec[0] ?? 0,
      arousal: vec[1] ?? 0,
      expressionStrength: vec[2] ?? 0,
      inferenceReliability: vec[3] ?? 0,
    },
    metrics: {
      etv: fa.salience * 100,
      eiv: fa.extractionConfidence * 100,
      band: band as EmotionalMetrics['band'],
    },
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

/**
 * Health probe for ChromaDB. Uses loadSchemas on a sentinel userId
 * which returns [] on success and null on failure.
 */
async function chromaHealthProbe(adapter: ChromaSchemaAdapter): Promise<boolean> {
  const result = await adapter.loadSchemas('__healthcheck__');
  return result !== null;
}
