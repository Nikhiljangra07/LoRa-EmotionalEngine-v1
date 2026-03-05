import Redis from 'ioredis';

const DEFAULT_URL = 'redis://localhost:6379';

let client: Redis | null = null;

export function getFalkorUrl(): string {
  return process.env.LORA_FALKOR_URL ?? DEFAULT_URL;
}

function createClient(): Redis {
  const url = getFalkorUrl();
  return new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: true,
    retryStrategy: () => null,
    maxRetriesPerRequest: 0,
    connectTimeout: 3000,
  });
}

/**
 * Returns a usable, connected FalkorDB client. Recreates the client if it is closed or reconnecting.
 */
export function getFalkorClient(): Redis {
  if (client === null) {
    client = createClient();
    return client;
  }
  const status = client.status;
  if (status === 'end' || status === 'close' || status === 'reconnecting') {
    try {
      client.removeAllListeners();
      client.disconnect();
    } catch {
      // ignore
    }
    client = createClient();
  }
  return client;
}

/**
 * For tests only: reset the singleton so the next getFalkorClient() uses current env.
 */
export function resetFalkorClient(): void {
  if (client) {
    client.removeAllListeners();
    client.disconnect();
    client = null;
  }
}

/** Escape single quotes for Cypher string literal: ' -> ''. */
function escapeCypherString(value: string): string {
  return value.replace(/'/g, "''");
}

const ALLOWED_PARAM_KEYS = [
  'userId',
  'anchorId',
  'payloadJson',
  'type',
  'slot',
  'createdAt',
  'reinforceCount',
  'value',
] as const;

/**
 * Safe parameter binder for Cypher. Replaces $key with Cypher literals:
 * string -> quoted escaped, number -> literal, null -> null.
 */
function bindParams(query: string, params?: Record<string, unknown>): string {
  if (!params) return query;
  let out = query;
  for (const key of ALLOWED_PARAM_KEYS) {
    const value = params[key];
    if (value === undefined) continue;
    let lit: string;
    if (value === null) {
      lit = 'null';
    } else if (typeof value === 'number') {
      lit = String(value);
    } else if (typeof value === 'string') {
      lit = "'" + escapeCypherString(value) + "'";
    } else {
      continue;
    }
    const pattern = new RegExp('\\$' + key + '\\b', 'g');
    out = out.replace(pattern, lit);
  }
  return out;
}

async function ensureConnected(c: Redis): Promise<void> {
  if (c.status === 'wait') {
    await c.connect();
  }
}

/**
 * Run a Cypher query on a FalkorDB graph. Uses GRAPH.QUERY.
 * Params: only userId and anchorId (strings) are bound safely; no unsafe interpolation.
 */
export async function graphQuery(
  graph: string,
  query: string,
  params?: Record<string, unknown>,
): Promise<unknown> {
  const c = getFalkorClient();
  await ensureConnected(c);
  const bound = bindParams(query, params);
  const result = await c.call('GRAPH.QUERY', graph, bound);
  return result;
}
