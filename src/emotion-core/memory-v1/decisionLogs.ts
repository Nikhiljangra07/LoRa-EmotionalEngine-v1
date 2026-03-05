// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MemoryLogEvent = { tag: string; payload: Record<string, unknown> };

// ---------------------------------------------------------------------------
// Rounding helper
// ---------------------------------------------------------------------------

function r3(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function makeMemoryEncodeLog(params: {
  userId: string;
  sessionId?: string;
  messageId?: string;
  tsMs: number;
  eventId: string;
  salience: number;
  mode: string;
  matchedSchemaId: string | null;
  topDims: Array<{ dim: number; name: string; value: number }>;
}): MemoryLogEvent {
  return {
    tag: 'memory:encode',
    payload: {
      userId: params.userId,
      sessionId: params.sessionId ?? null,
      messageId: params.messageId ?? null,
      tsMs: params.tsMs,
      eventId: params.eventId,
      salience: r3(params.salience),
      mode: params.mode,
      matchedSchemaId: params.matchedSchemaId ?? 'new',
      topDims: params.topDims.map((d) => ({
        dim: d.dim,
        name: d.name,
        value: r3(d.value),
      })),
    },
  };
}

export function makeMemoryRetrieveLog(params: {
  userId: string;
  sessionId?: string;
  messageId?: string;
  tsMs: number;
  topK: Array<{ schemaId: string; sim: number; p: number }>;
  confidenceLevel: string;
  noMatch: boolean;
  winnerId: string | null;
}): MemoryLogEvent {
  return {
    tag: 'memory:retrieve',
    payload: {
      userId: params.userId,
      sessionId: params.sessionId ?? null,
      messageId: params.messageId ?? null,
      tsMs: params.tsMs,
      topK: params.topK.map((k) => ({
        schemaId: k.schemaId,
        sim: r3(k.sim),
        p: r3(k.p),
      })),
      confidenceLevel: params.confidenceLevel,
      noMatch: params.noMatch,
      winnerId: params.winnerId ?? null,
    },
  };
}

export function makeMemoryConsolidateLog(params: {
  userId: string;
  sessionId?: string;
  tsMs: number;
  createdCount: number;
  mergedCount: number;
  prunedCount: number;
  episodesEvicted: number;
  totalSchemas: number;
  totalEpisodes: number;
  noveltyFlag: boolean;
}): MemoryLogEvent {
  return {
    tag: 'memory:consolidate',
    payload: {
      userId: params.userId,
      sessionId: params.sessionId ?? null,
      tsMs: params.tsMs,
      createdCount: r3(params.createdCount),
      mergedCount: r3(params.mergedCount),
      prunedCount: r3(params.prunedCount),
      episodesEvicted: r3(params.episodesEvicted),
      totalSchemas: r3(params.totalSchemas),
      totalEpisodes: r3(params.totalEpisodes),
      noveltyFlag: params.noveltyFlag,
    },
  };
}

// ---------------------------------------------------------------------------
// Memory Service (dual DB pipeline) logs
// ---------------------------------------------------------------------------

export function makeMemoryServiceRetrieveLog(params: {
  userId: string;
  sessionId?: string;
  messageId?: string;
  tsMs: number;
  anchorCount: number;
  semanticCount: number;
  degraded: { falkor: boolean; chroma: boolean };
  band?: string;
}): MemoryLogEvent {
  return {
    tag: 'memoryService:retrieve',
    payload: {
      userId: params.userId,
      sessionId: params.sessionId ?? null,
      messageId: params.messageId ?? null,
      tsMs: params.tsMs,
      anchorCount: params.anchorCount,
      semanticCount: params.semanticCount,
      degraded: params.degraded,
      band: params.band ?? null,
    },
  };
}

export function makeMemoryServiceSaveLog(params: {
  userId: string;
  sessionId?: string;
  messageId?: string;
  tsMs: number;
  ok: boolean;
  wroteFalkor?: boolean;
  wroteChroma?: boolean;
  degraded?: { falkor: boolean; chroma: boolean };
}): MemoryLogEvent {
  return {
    tag: 'memoryService:save',
    payload: {
      userId: params.userId,
      sessionId: params.sessionId ?? null,
      messageId: params.messageId ?? null,
      tsMs: params.tsMs,
      ok: params.ok,
      wroteFalkor: params.wroteFalkor ?? null,
      wroteChroma: params.wroteChroma ?? null,
      degraded: params.degraded ?? null,
    },
  };
}
