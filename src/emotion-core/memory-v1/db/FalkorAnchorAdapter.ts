import { graphQuery } from './falkorClient';

const GRAPH_NAME = 'lora_anchors';

export interface AnchorRow {
  anchorId: string;
  payload: unknown;
}

/**
 * Minimal FalkorDB adapter for anchor storage. All operations are userId-scoped.
 * Degraded mode: on error returns false / null / true as specified; never throws to callers.
 */
export class FalkorAnchorAdapter {
  async upsertAnchor(userId: string, anchorId: string, payload: object): Promise<boolean> {
    try {
      const payloadJson = JSON.stringify(payload);
      await graphQuery(
        GRAPH_NAME,
        `MERGE (a:Anchor { userId: $userId, anchorId: $anchorId })
         SET a.payloadJson = $payloadJson`,
        { userId, anchorId, payloadJson },
      );
      return true;
    } catch (err) {
      console.error('[FalkorAnchorAdapter ERROR]', err);
      throw err;
    }
  }

  async getAnchors(userId: string): Promise<AnchorRow[] | null> {
    try {
      const raw = await graphQuery(
        GRAPH_NAME,
        `MATCH (a:Anchor { userId: $userId }) RETURN a.anchorId AS anchorId, a.payloadJson AS payloadJson`,
        { userId },
      );
      const rows = parseGraphResult(raw);
      const out: AnchorRow[] = [];
      for (const row of rows) {
        const anchorId = typeof row.anchorId === 'string' ? row.anchorId : String(row.anchorId ?? '');
        let payload: unknown = null;
        if (row.payloadJson != null && typeof row.payloadJson === 'string') {
          try {
            payload = JSON.parse(row.payloadJson);
          } catch {
            payload = null;
          }
        }
        out.push({ anchorId, payload });
      }
      out.sort((a, b) => (a.anchorId < b.anchorId ? -1 : a.anchorId > b.anchorId ? 1 : 0));
      return out;
    } catch (err) {
      console.error('[FalkorAnchorAdapter ERROR]', err);
      throw err;
    }
  }

  async purgeUser(userId: string): Promise<boolean> {
    try {
      await graphQuery(
        GRAPH_NAME,
        `MATCH (n { userId: $userId }) DETACH DELETE n`,
        { userId },
      );
      return true;
    } catch (err) {
      console.error('[FalkorAnchorAdapter ERROR]', err);
      throw err;
    }
  }
}

/**
 * FalkorDB GRAPH.QUERY returns [header, data, metadata].
 * data is array of rows; each row is array of values in header order.
 */
function parseGraphResult(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw) || raw.length < 2) return [];
  const header = raw[0];
  const data = raw[1];
  if (!Array.isArray(data) || !Array.isArray(header)) return [];
  const keys = header.map((h) => (typeof h === 'string' ? h : String(h)));
  return data.map((row: unknown) => {
    const arr = Array.isArray(row) ? row : [];
    const obj: Record<string, unknown> = {};
    keys.forEach((k, i) => {
      obj[k] = arr[i];
    });
    return obj;
  });
}
