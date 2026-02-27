import { graphQuery } from './falkorClient';
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

const GRAPH_NAME = 'lora_anchors';
const META_ANCHOR_ID = '__fact_store_meta__';

/** Defensive cap: refuse to persist payloads larger than 8 KiB. */
const MAX_PAYLOAD_BYTES = 8192;

interface StoreMeta {
  sessionSeen: Record<string, true>;
  sessionAnchorCount: Record<string, number>;
  lastMaintenanceSessionId?: string;
  quarantineMeta: Record<string, { birthMaintainCount: number }>;
}

const pureStore = createInMemoryFactAnchorStore();

function parseGraphResult(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw) || raw.length < 2) return [];
  const header = raw[0];
  const data = raw[1];
  if (!Array.isArray(data) || !Array.isArray(header)) return [];
  const keys = header.map((h: unknown) => (typeof h === 'string' ? h : String(h)));
  return data.map((row: unknown) => {
    const arr = Array.isArray(row) ? row : [];
    const obj: Record<string, unknown> = {};
    keys.forEach((k: string, i: number) => {
      obj[k] = arr[i];
    });
    return obj;
  });
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
 * FalkorDB-backed FactAnchorStore. Stores each FactAnchor as an (:Anchor) node
 * with userId, anchorId, and a payloadJson property containing the full serialized
 * anchor. Store metadata (session tracking, quarantine meta) is stored on a
 * dedicated node with anchorId = META_ANCHOR_ID.
 *
 * All pure lifecycle logic is delegated to createInMemoryFactAnchorStore — this
 * adapter only handles load/save against the graph.
 *
 * Degraded mode: every public method catches errors and returns null/false.
 * When loadState returns null (DB unreachable), methods propagate null immediately
 * rather than falling back to an empty state.
 */
export class FalkorFactAnchorStore implements AsyncFactAnchorStore {
  async loadState(userId: string): Promise<FactAnchorStoreState | null> {
    try {
      const raw = await graphQuery(
        GRAPH_NAME,
        'MATCH (a:Anchor { userId: $userId }) RETURN a.anchorId AS anchorId, a.payloadJson AS payloadJson',
        { userId },
      );
      const rows = parseGraphResult(raw);

      let meta: StoreMeta = {
        sessionSeen: {},
        sessionAnchorCount: {},
        quarantineMeta: {},
      };
      const confirmed: FactAnchor[] = [];
      const quarantined: FactAnchor[] = [];

      for (const row of rows) {
        const id = typeof row.anchorId === 'string' ? row.anchorId : String(row.anchorId ?? '');
        const json = typeof row.payloadJson === 'string' ? row.payloadJson : null;
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
        } catch { /* skip corrupt node */ }
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
      const allAnchors = [...state.confirmed, ...state.quarantined];

      const existingRaw = await graphQuery(
        GRAPH_NAME,
        'MATCH (a:Anchor { userId: $userId }) RETURN a.anchorId AS anchorId',
        { userId },
      );
      const existingRows = parseGraphResult(existingRaw);
      const existingIds = new Set(
        existingRows.map((r) => (typeof r.anchorId === 'string' ? r.anchorId : String(r.anchorId ?? ''))),
      );

      const newIds = new Set(allAnchors.map((a) => a.anchorId));
      newIds.add(META_ANCHOR_ID);

      for (const oldId of existingIds) {
        if (!newIds.has(oldId)) {
          await graphQuery(
            GRAPH_NAME,
            'MATCH (a:Anchor { userId: $userId, anchorId: $anchorId }) DELETE a',
            { userId, anchorId: oldId },
          );
        }
      }

      for (const anchor of allAnchors) {
        const payload = JSON.stringify(anchor);
        if (payload.length > MAX_PAYLOAD_BYTES) continue;
        await graphQuery(
          GRAPH_NAME,
          `MERGE (a:Anchor { userId: $userId, anchorId: $anchorId })
           SET a.payloadJson = $payloadJson`,
          { userId, anchorId: anchor.anchorId, payloadJson: payload },
        );
      }

      const metaPayload: StoreMeta = {
        sessionSeen: state.sessionSeen,
        sessionAnchorCount: state.sessionAnchorCount,
        lastMaintenanceSessionId: state.lastMaintenanceSessionId,
        quarantineMeta: state.quarantineMeta,
      };
      await graphQuery(
        GRAPH_NAME,
        `MERGE (a:Anchor { userId: $userId, anchorId: $anchorId })
         SET a.payloadJson = $payloadJson`,
        { userId, anchorId: META_ANCHOR_ID, payloadJson: JSON.stringify(metaPayload) },
      );

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
      if (state === null) return null;
      const result = pureStore.upsertFromExtraction(state, input);
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
      if (state === null) return null;
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
      await graphQuery(
        GRAPH_NAME,
        'MATCH (n { userId: $userId }) DETACH DELETE n',
        { userId },
      );
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
      if (state === null) return null;
      return pureStore.exportAll(state);
    } catch {
      return null;
    }
  }
}
