import type { MemoryV1DebugSnapshot } from './debugTypes';
import { bucketConfidence } from './debugBuckets';

type BandHint = MemoryV1DebugSnapshot['bandHint'];

const VALID_BANDS = new Set<string>(['B0', 'B1', 'B2', 'B3', 'B4']);

function toBandHint(band?: string | null): BandHint {
  if (!band) return null;
  const mapped = band.replace('BAND_', 'B');
  return VALID_BANDS.has(mapped) ? (mapped as BandHint) : null;
}

export type DebugSnapshotInput = {
  userId: string;
  sessionId?: string;
  messageId?: string;
  encoderMode: 'baseline' | 'enhanced';
  wroteEpisode: boolean;
  noMatch: boolean;
  topSchemaIds: string[];
  winnerSchemaId?: string | null;
  memoryContext?: {
    sessionPattern?: string;
    confidenceLevel?: string;
  } | null;
  etvPolicy?: {
    band?: string;
  } | null;
};

const MAX_TOP_SCHEMAS = 3;

export function buildMemoryV1DebugSnapshot(
  input: DebugSnapshotInput,
): MemoryV1DebugSnapshot {
  const winner = input.noMatch ? null : (input.winnerSchemaId ?? null);

  let topIds = [...input.topSchemaIds];
  if (winner && !topIds.includes(winner)) {
    topIds = [winner, ...topIds];
  }
  topIds = topIds.slice(0, MAX_TOP_SCHEMAS);

  const confRaw = input.memoryContext?.confidenceLevel;
  const confBucketed = confRaw === 'LOW' || confRaw === 'MED' || confRaw === 'HIGH'
    ? (confRaw as 'LOW' | 'MED' | 'HIGH')
    : null;

  return {
    tag: 'memory:v1:debug',
    userId: input.userId,
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    ...(input.messageId !== undefined ? { messageId: input.messageId } : {}),
    mode: input.encoderMode,
    wroteEpisode: input.wroteEpisode,
    noMatch: input.noMatch,
    winnerSchemaId: winner,
    topSchemaIds: topIds,
    sessionPattern: input.memoryContext?.sessionPattern ?? null,
    confidenceLevel: confBucketed,
    bandHint: toBandHint(input.etvPolicy?.band),
  };
}
