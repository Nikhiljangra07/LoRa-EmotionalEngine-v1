import { getFalkorClient } from './falkorClient';

const HASH_PREFIX = 'lora:legacy:';

export interface AnchorRow {
  anchorId: string;
  payload: unknown;
}

async function getConnectedClient() {
  const c = getFalkorClient();
  if (c.status === 'wait') await c.connect();
  return c;
}

/**
 * Minimal Redis adapter for anchor storage. All operations are userId-scoped.
 * Uses plain Redis hashes — no FalkorDB/RedisGraph module required.
 * Degraded mode: on error returns false / null / true as specified; never throws to callers.
 */
export class FalkorAnchorAdapter {
  async upsertAnchor(userId: string, anchorId: string, payload: object): Promise<boolean> {
    try {
      const c = await getConnectedClient();
      await c.hset(`${HASH_PREFIX}${userId}`, anchorId, JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  async getAnchors(userId: string): Promise<AnchorRow[] | null> {
    try {
      const c = await getConnectedClient();
      const raw = await c.hgetall(`${HASH_PREFIX}${userId}`);
      const out: AnchorRow[] = [];
      for (const [anchorId, json] of Object.entries(raw)) {
        let payload: unknown = null;
        if (json) {
          try {
            payload = JSON.parse(json);
          } catch {
            payload = null;
          }
        }
        out.push({ anchorId, payload });
      }
      out.sort((a, b) => (a.anchorId < b.anchorId ? -1 : a.anchorId > b.anchorId ? 1 : 0));
      return out;
    } catch {
      return null;
    }
  }

  async purgeUser(userId: string): Promise<boolean> {
    try {
      const c = await getConnectedClient();
      await c.del(`${HASH_PREFIX}${userId}`);
      return true;
    } catch {
      return false;
    }
  }
}
