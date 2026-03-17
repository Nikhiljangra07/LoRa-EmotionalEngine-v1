import { getFalkorClient } from './falkorClient';
import type { FactAnchor } from '../factAnchorTypes';
import type {
  FactAnchorStoreState,
  UpsertInput,
  UpsertResult,
  MaintainInput,
  MaintainReport,
  GetCandidatesInput,
  AsyncFactAnchorStore,
} from '../factAnchorStoreTypes';
import { createInMemoryFactAnchorStore } from '../factAnchorStore';

const HASH_PREFIX = 'lora:anchors:';
const META_ANCHOR_ID = '__fact_store_meta__';

/** Defensive cap: refuse to persist payloads larger than 8 KiB. */
const MAX_PAYLOAD_BYTES = 8192;

/** Anchor hash TTL: 90 days of inactivity before Redis auto-expires the key. Refreshed on every save. */
const ANCHOR_TTL_SECONDS = 90 * 24 * 60 * 60;

interface StoreMeta {
  sessionSeen: Record<string, true>;
  sessionAnchorCount: Record<string, number>;
  lastMaintenanceSessionId?: string;
  quarantineMeta: Record<string, { birthMaintainCount: number }>;
}

const pureStore = createInMemoryFactAnchorStore();

function hashKey(userId: string): string {
  return `${HASH_PREFIX}${userId}`;
}

async function getConnectedClient() {
  const c = getFalkorClient();
  if (c.status === 'wait') await c.connect();
  return c;
}

function isValidAnchor(obj: unknown): obj is FactAnchor {
  if (!obj || typeof obj !== 'object') return false;
  const a = obj as Record<string, unknown>;
  return (
    typeof a.anchorId === 'string' &&
    typeof a.userId === 'string' &&
    typeof a.type === 'string' &&
    typeof a.status === 'string' &&
    (a.status === 'confirmed' || a.status === 'quarantined') &&
    typeof a.salience === 'number' &&
    typeof a.createdAt === 'number' &&
    Array.isArray(a.emotionVecAtCreation)
  );
}

/**
 * Redis-hash-backed FactAnchorStore. Uses plain HSET/HGETALL/HDEL/DEL —
 * works on any standard Redis instance (no FalkorDB/RedisGraph module required).
 *
 * Data model: one hash per user at key `lora:anchors:{userId}`.
 * Each hash field is an anchorId, value is the JSON-serialized FactAnchor.
 * Store metadata is stored under the field `__fact_store_meta__`.
 *
 * All pure lifecycle logic is delegated to createInMemoryFactAnchorStore — this
 * adapter only handles load/save against Redis.
 *
 * Degraded mode: every public method catches errors and returns null/false.
 * When loadState returns null (DB unreachable), methods propagate null immediately.
 */
export class FalkorFactAnchorStore implements AsyncFactAnchorStore {
  async loadState(userId: string): Promise<FactAnchorStoreState | null> {
    try {
      const c = await getConnectedClient();
      const raw = await c.hgetall(hashKey(userId));

      let meta: StoreMeta = {
        sessionSeen: {},
        sessionAnchorCount: {},
        quarantineMeta: {},
      };
      const confirmed: FactAnchor[] = [];
      const quarantined: FactAnchor[] = [];

      for (const [id, json] of Object.entries(raw)) {
        if (!json) continue;

        if (id === META_ANCHOR_ID) {
          try {
            const parsed = JSON.parse(json);
            meta = {
              sessionSeen: parsed.sessionSeen ?? {},
              sessionAnchorCount: parsed.sessionAnchorCount ?? {},
              lastMaintenanceSessionId: parsed.lastMaintenanceSessionId,
              quarantineMeta: parsed.quarantineMeta ?? {},
            };
          } catch { /* corrupt meta → use defaults */ }
          continue;
        }

        try {
          const anchor = JSON.parse(json);
          if (!isValidAnchor(anchor)) continue;
          if (anchor.status === 'confirmed') confirmed.push(anchor);
          else quarantined.push(anchor);
        } catch { /* skip corrupt entry */ }
      }

      confirmed.sort((a, b) => a.anchorId.localeCompare(b.anchorId));
      quarantined.sort((a, b) => a.anchorId.localeCompare(b.anchorId));

      return {
        confirmed,
        quarantined,
        sessionSeen: meta.sessionSeen,
        sessionAnchorCount: meta.sessionAnchorCount,
        lastMaintenanceSessionId: meta.lastMaintenanceSessionId,
        quarantineMeta: meta.quarantineMeta,
      };
    } catch {
      return null;
    }
  }

  async saveState(userId: string, state: FactAnchorStoreState): Promise<boolean> {
    try {
      const c = await getConnectedClient();
      const key = hashKey(userId);
      const allAnchors = [...state.confirmed, ...state.quarantined];

      const existingFields = await c.hkeys(key);
      const existingIds = new Set(existingFields);

      const newIds = new Set(allAnchors.map((a) => a.anchorId));
      newIds.add(META_ANCHOR_ID);

      const toDelete = existingFields.filter((id) => !newIds.has(id));
      if (toDelete.length > 0) {
        await c.hdel(key, ...toDelete);
      }

      const pipeline = c.pipeline();
      for (const anchor of allAnchors) {
        const payload = JSON.stringify(anchor);
        if (payload.length > MAX_PAYLOAD_BYTES) continue;
        pipeline.hset(key, anchor.anchorId, payload);
      }

      const metaPayload: StoreMeta = {
        sessionSeen: state.sessionSeen,
        sessionAnchorCount: state.sessionAnchorCount,
        lastMaintenanceSessionId: state.lastMaintenanceSessionId,
        quarantineMeta: state.quarantineMeta,
      };
      pipeline.hset(key, META_ANCHOR_ID, JSON.stringify(metaPayload));

      await pipeline.exec();
      await c.expire(key, ANCHOR_TTL_SECONDS);
      return true;
    } catch {
      return false;
    }
  }

  async upsertFromExtraction(
    userId: string,
    input: UpsertInput,
  ): Promise<{ nextState: FactAnchorStoreState; results: UpsertResult } | null> {
    try {
      const state = await this.loadState(userId);
      const effectiveState = state ?? {
        confirmed: [],
        quarantined: [],
        sessionSeen: {},
        sessionAnchorCount: {},
        quarantineMeta: {},
      };
      const result = pureStore.upsertFromExtraction(effectiveState, input);
      const saved = await this.saveState(userId, result.nextState);
      if (!saved) return null;
      return result;
    } catch {
      return null;
    }
  }

  async getCandidates(
    userId: string,
    input: GetCandidatesInput,
  ): Promise<FactAnchor[] | null> {
    try {
      const state = await this.loadState(userId);
      if (state === null) return [];
      return pureStore.getCandidates(state, input);
    } catch {
      return null;
    }
  }

  async maintain(
    userId: string,
    input: MaintainInput,
  ): Promise<{ report: MaintainReport } | null> {
    try {
      const state = await this.loadState(userId);
      if (state === null) return null;
      const result = pureStore.maintain(state, input);
      const saved = await this.saveState(userId, result.nextState);
      if (!saved) return null;
      return { report: result.report };
    } catch {
      return null;
    }
  }

  async purgeAll(userId: string): Promise<boolean> {
    try {
      const c = await getConnectedClient();
      await c.del(hashKey(userId));
      return true;
    } catch {
      return false;
    }
  }

  async exportAll(
    userId: string,
  ): Promise<{ confirmed: FactAnchor[]; quarantined: FactAnchor[] } | null> {
    try {
      const state = await this.loadState(userId);
      if (state === null) return { confirmed: [], quarantined: [] };
      return pureStore.exportAll(state);
    } catch {
      return null;
    }
  }
}
