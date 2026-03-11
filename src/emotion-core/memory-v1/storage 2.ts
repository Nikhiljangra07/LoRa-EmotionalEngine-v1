import * as fs from 'fs';
import * as nodePath from 'path';
import { safeNumber, clamp, l2Normalize } from './normalize';
import { MEMORY_V1_CONFIG } from './constants';
import type { MemoryV1Storage, StoredMemoryV1State } from './storageTypes';
import type { SchemaRecord } from './schemaStore';
import type { EncodedEvent, EncoderMode } from './types';
import type { RIFGuardState } from './rifGuard';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_SCHEMAS = 20;
const MAX_EPISODIC = 30;
const MAX_BIAS = 0.20;
const VEC_LEN = MEMORY_V1_CONFIG.DIMS; // 21
const L2_EPS = MEMORY_V1_CONFIG.L2_EPS;
const MAX_USER_ID_LEN = 128;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function sanitizeUserId(userId: string): string {
  const safe = userId
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, MAX_USER_ID_LEN);
  return safe || '_empty_';
}

export function createJSONStorage(
  baseDir: string = '.lora/memory-v1',
): MemoryV1Storage {
  function getPath(userId: string): string {
    return nodePath.join(baseDir, sanitizeUserId(userId), 'state.json');
  }

  function save(state: StoredMemoryV1State): void {
    const filePath = getPath(state.userId);
    const dir = nodePath.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });

    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  }

  function load(userId: string): StoredMemoryV1State | null {
    const filePath = getPath(userId);

    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf-8');
    } catch {
      return null;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      parsed.version !== 1 ||
      typeof parsed.userId !== 'string'
    ) {
      return null;
    }

    const schemas = sanitizeSchemas(parsed.schemas);
    const episodic = sanitizeEpisodic(parsed.episodic);
    const rifGuard = sanitizeRifGuard(parsed.rifGuard);

    const result: StoredMemoryV1State = {
      version: 1,
      userId: parsed.userId as string,
      savedAtMs: safeNumber(parsed.savedAtMs as number, 0),
      schemas,
      episodic,
      rifGuard,
    };

    return JSON.parse(JSON.stringify(result)) as StoredMemoryV1State;
  }

  return { load, save, getPath };
}

// ---------------------------------------------------------------------------
// Sanitizers
// ---------------------------------------------------------------------------

function sanitizeSchemas(raw: unknown): SchemaRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Record<string, unknown> => s !== null && typeof s === 'object')
    .slice(0, MAX_SCHEMAS)
    .map(sanitizeOneSchema);
}

function sanitizeOneSchema(s: Record<string, unknown>): SchemaRecord {
  const rawCentroid = Array.isArray(s.centroid)
    ? (s.centroid as unknown[]).map((v) => safeNumber(v as number, 0))
    : [];
  return {
    schemaId: String(s.schemaId ?? ''),
    centroid: l2Normalize(rawCentroid, L2_EPS),
    salienceWeight: clamp(safeNumber(s.salienceWeight as number, 0), 0, 1),
    episodeCount: Math.max(0, Math.floor(safeNumber(s.episodeCount as number, 0))),
    retrievalBias: clamp(safeNumber(s.retrievalBias as number, 0), -MAX_BIAS, MAX_BIAS),
    createdAt: safeNumber(s.createdAt as number, 0),
    lastUpdatedAt: safeNumber(s.lastUpdatedAt as number, 0),
  };
}

function sanitizeEpisodic(raw: unknown): EncodedEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is Record<string, unknown> => {
      if (e === null || typeof e !== 'object') return false;
      const rec = e as Record<string, unknown>;
      return Array.isArray(rec.emotionVec) && (rec.emotionVec as unknown[]).length === VEC_LEN;
    })
    .slice(0, MAX_EPISODIC)
    .map(sanitizeOneEvent);
}

function sanitizeOneEvent(e: Record<string, unknown>): EncodedEvent {
  const rawVec = e.emotionVec as unknown[];
  const emotionVec = rawVec.map((v) => safeNumber(v as number, 0));

  const mode: EncoderMode = e.mode === 'enhanced' ? 'enhanced' : 'baseline';

  const dimSummaryRaw = e.dimSummary as Record<string, unknown> | undefined;
  const topDimsRaw = Array.isArray(dimSummaryRaw?.topDims)
    ? (dimSummaryRaw!.topDims as Array<Record<string, unknown>>)
    : [];

  const topDims = topDimsRaw
    .filter((d): d is Record<string, unknown> => d !== null && typeof d === 'object')
    .map((d) => ({
      dim: Math.floor(safeNumber(d.dim as number, 0)),
      name: String(d.name ?? ''),
      value: safeNumber(d.value as number, 0),
    }));

  return { mode, emotionVec, dimSummary: { topDims } };
}

function sanitizeRifGuard(raw: unknown): RIFGuardState {
  if (raw === null || typeof raw !== 'object') {
    return { recentWinners: [], cooldownRemaining: 0 };
  }
  const g = raw as Record<string, unknown>;
  const winners = Array.isArray(g.recentWinners)
    ? (g.recentWinners as unknown[]).filter((w): w is string => typeof w === 'string')
    : [];
  return {
    recentWinners: winners,
    cooldownRemaining: Math.max(0, Math.floor(safeNumber(g.cooldownRemaining as number, 0))),
  };
}
