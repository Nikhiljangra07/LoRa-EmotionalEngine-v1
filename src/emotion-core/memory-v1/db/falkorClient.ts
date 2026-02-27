import Redis from 'ioredis';

const DEFAULT_URL = 'redis://localhost:6379';

let client: Redis | null = null;

export function getFalkorUrl(): string {
  return process.env.LORA_FALKOR_URL ?? DEFAULT_URL;
}

function createClient(): Redis {
  const url = getFalkorUrl();
  return new Redis(url, {
    lazyConnect: false,
    enableOfflineQueue: true,
    retryStrategy: () => null,
    maxRetriesPerRequest: 0,
    connectTimeout: 1000,
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
    client.disconnect();
    client = null;
  }
}

/** Escape single quotes for Cypher string literal: ' -> ''. */
function escapeCypherString(value: string): string {
  return value.replace(/'/g, "''");
}

const ALLOWED_PARAM_KEYS = ['userId', 'anchorId', 'payloadJson'] as const;

/**
 * Safe parameter binder for Cypher: only supports string params userId, anchorId, payloadJson.
 * Replaces $key in the query with escaped string literals. No raw interpolation.
 */
function bindParams(query: string, params?: Record<string, unknown>): string {
  if (!params) return query;
  let out = query;
  for (const key of ALLOWED_PARAM_KEYS) {
    const value = params[key];
    if (typeof value === 'string') {
      const lit = "'" + escapeCypherString(value) + "'";
      const pattern = new RegExp('\\$' + key, 'g');
      out = out.replace(pattern, lit);
    }
  }
  return out;
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
  const client = getFalkorClient();
  const bound = bindParams(query, params);
  const result = await client.call('GRAPH.QUERY', graph, bound);
  return result;
}
