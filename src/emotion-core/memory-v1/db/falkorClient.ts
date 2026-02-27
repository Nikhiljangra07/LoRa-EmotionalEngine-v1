import Redis from 'ioredis';

const DEFAULT_URL = 'redis://localhost:6379';

let cachedClient: Redis | undefined = undefined;

export function getFalkorUrl(): string {
  return process.env.LORA_FALKOR_URL ?? DEFAULT_URL;
}

/**
 * Singleton ioredis client for FalkorDB. Reads LORA_FALKOR_URL (default redis://localhost:6379).
 * Uses lazyConnect: true so tests can call connect() explicitly to control timing.
 * Retries disabled and short connectTimeout to avoid hangs when DB is unreachable.
 */
export function getFalkorClient(): Redis {
  if (!cachedClient) {
    const url = getFalkorUrl();
    cachedClient = new Redis(url, {
      lazyConnect: true,
      retryStrategy: () => null,
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
      connectTimeout: 1000,
    });
  }
  return cachedClient;
}

/**
 * For tests only: reset the singleton so the next getFalkorClient() uses current env.
 * Disconnects the client and clears the singleton.
 */
export function resetFalkorClient(): void {
  if (cachedClient) {
    cachedClient.disconnect();
    cachedClient = undefined;
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
