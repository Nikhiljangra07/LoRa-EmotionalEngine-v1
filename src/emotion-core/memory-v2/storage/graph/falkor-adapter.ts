import Redis from 'ioredis';
import type { IGraphStore } from '../interfaces';
import type { FactAnchor, GraphSnapshot, GraphNode, GraphEdge, UserProfile } from '../../types';

// ──────────────────────────────────────────────────────
// FalkorDB implementation of IGraphStore
// Uses Redis hashes — same pattern as current backend.
//
// Key scheme:
//   lora:memory_v2:{userId}:anchors:{sessionId}  → JSON array of FactAnchor[]
//   lora:memory_v2:{userId}:sessions              → SET of sessionIds
//   lora:memory_v2:{userId}:edge_ts:{edgeKey}     → timestamp of last access
//
// 90-day TTL on all keys (matching backend).
// ──────────────────────────────────────────────────────

const KEY_PREFIX = 'lora:memory_v2';
const TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

export interface FalkorAdapterConfig {
  /** Redis connection URL (default: redis://localhost:6379) */
  url?: string;
  /** Injected Redis client (for testing) */
  client?: Redis;
}

/**
 * Build a unique key for edges so we can track their last access time.
 */
function edgeKey(anchor: FactAnchor, relIndex: number): string {
  const rel = anchor.relationships[relIndex];
  if (!rel) return '';
  return `${anchor.type}:${anchor.value}--${rel.edge}-->${rel.targetType}:${rel.targetValue}`;
}

export class FalkorGraphStore implements IGraphStore {
  private redis: Redis;

  constructor(config?: FalkorAdapterConfig) {
    this.redis = config?.client ?? new Redis(config?.url ?? 'redis://localhost:6379');
  }

  private anchorsKey(userId: string, sessionId: string): string {
    return `${KEY_PREFIX}:${userId}:anchors:${sessionId}`;
  }

  private sessionsKey(userId: string): string {
    return `${KEY_PREFIX}:${userId}:sessions`;
  }

  private edgeTsKey(userId: string, ek: string): string {
    return `${KEY_PREFIX}:${userId}:edge_ts:${ek}`;
  }

  private profileKey(userId: string): string {
    return `${KEY_PREFIX}:${userId}:profile`;
  }

  async storeAnchors(userId: string, sessionId: string, anchors: FactAnchor[]): Promise<void> {
    const pipeline = this.redis.pipeline();
    const aKey = this.anchorsKey(userId, sessionId);
    const sKey = this.sessionsKey(userId);
    const now = Date.now().toString();

    // Store anchors as JSON
    pipeline.set(aKey, JSON.stringify(anchors));
    pipeline.expire(aKey, TTL_SECONDS);

    // Track session ID
    pipeline.sadd(sKey, sessionId);
    pipeline.expire(sKey, TTL_SECONDS);

    // Track edge timestamps for pruning
    for (const anchor of anchors) {
      for (let i = 0; i < anchor.relationships.length; i++) {
        const ek = edgeKey(anchor, i);
        if (ek) {
          const etKey = this.edgeTsKey(userId, ek);
          pipeline.set(etKey, now);
          pipeline.expire(etKey, TTL_SECONDS);
        }
      }
    }

    const results = await pipeline.exec();
    // Check for pipeline-level errors
    if (results) {
      for (const [err] of results) {
        if (err) {
          throw new Error(`Falkor pipeline error during storeAnchors: ${err.message}`);
        }
      }
    }
  }

  async getAnchorsForSessions(userId: string, sessionIds: string[]): Promise<FactAnchor[]> {
    if (sessionIds.length === 0) return [];

    const pipeline = this.redis.pipeline();
    for (const sid of sessionIds) {
      pipeline.get(this.anchorsKey(userId, sid));
    }

    const results = await pipeline.exec();
    const allAnchors: FactAnchor[] = [];

    if (results) {
      for (const [err, val] of results) {
        if (!err && typeof val === 'string') {
          try {
            const parsed = JSON.parse(val) as FactAnchor[];
            if (Array.isArray(parsed)) {
              allAnchors.push(...parsed);
            }
          } catch {
            // Corrupted JSON in Redis — skip this session's anchors
          }
        }
      }
    }

    return allAnchors;
  }

  async getUserGraph(userId: string): Promise<GraphSnapshot> {
    const sKey = this.sessionsKey(userId);
    const sessionIds = await this.redis.smembers(sKey);

    if (sessionIds.length === 0) {
      return { nodes: [], edges: [] };
    }

    const anchors = await this.getAnchorsForSessions(userId, sessionIds);

    // Build graph from anchors
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const seenNodes = new Set<string>();

    for (const anchor of anchors) {
      const nodeKey = `${anchor.type}:${anchor.value}`;

      if (!seenNodes.has(nodeKey)) {
        seenNodes.add(nodeKey);
        const node = anchorToNode(anchor);
        if (node) nodes.push(node);
      }

      for (const rel of anchor.relationships) {
        const targetKey = `${rel.targetType}:${rel.targetValue}`;

        if (!seenNodes.has(targetKey)) {
          seenNodes.add(targetKey);
          // Create a minimal target node
          const targetNode = minimalNode(rel.targetType, rel.targetValue);
          if (targetNode) nodes.push(targetNode);
        }

        const fromNode = anchorToNode(anchor);
        const toNode = minimalNode(rel.targetType, rel.targetValue);
        if (fromNode && toNode) {
          edges.push({
            edgeType: rel.edge as GraphEdge['edgeType'],
            from: fromNode,
            to: toNode,
          });
        }
      }
    }

    return { nodes, edges };
  }

  async pruneStaleEdges(userId: string, maxAgeDays: number): Promise<number> {
    const cutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const pattern = this.edgeTsKey(userId, '*');

    let pruned = 0;
    let cursor = '0';

    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor, 'MATCH', pattern, 'COUNT', 100,
      );
      cursor = nextCursor;

      if (keys.length > 0) {
        const pipeline = this.redis.pipeline();
        for (const key of keys) {
          pipeline.get(key);
        }
        const results = await pipeline.exec();

        const toDelete: string[] = [];
        if (results) {
          for (let i = 0; i < results.length; i++) {
            const [err, val] = results[i]!;
            if (!err && typeof val === 'string') {
              const ts = parseInt(val, 10);
              if (ts < cutoffMs) {
                toDelete.push(keys[i]!);
              }
            }
          }
        }

        if (toDelete.length > 0) {
          await this.redis.del(...toDelete);
          pruned += toDelete.length;
        }
      }
    } while (cursor !== '0');

    return pruned;
  }

  async storeProfile(userId: string, profile: UserProfile): Promise<void> {
    const key = this.profileKey(userId);
    const pipeline = this.redis.pipeline();
    pipeline.set(key, JSON.stringify(profile));
    pipeline.expire(key, TTL_SECONDS);
    const results = await pipeline.exec();
    if (results) {
      for (const [err] of results) {
        if (err) throw new Error(`Falkor pipeline error during storeProfile: ${err.message}`);
      }
    }
  }

  async getProfile(userId: string): Promise<UserProfile | null> {
    const key = this.profileKey(userId);
    const raw = await this.redis.get(key);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      // Minimal shape check
      if (
        typeof parsed === 'object' && parsed !== null &&
        typeof parsed.userId === 'string' &&
        typeof parsed.sessionsCompleted === 'number'
      ) {
        return parsed as UserProfile;
      }
      return null;
    } catch {
      return null;
    }
  }

  async purgeUser(userId: string): Promise<void> {
    // Get all session IDs to find anchor keys
    const sKey = this.sessionsKey(userId);
    const sessionIds = await this.redis.smembers(sKey);

    const keysToDelete: string[] = [sKey, this.profileKey(userId)];

    for (const sid of sessionIds) {
      keysToDelete.push(this.anchorsKey(userId, sid));
    }

    // Also scan for edge timestamp keys
    const pattern = this.edgeTsKey(userId, '*');
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor, 'MATCH', pattern, 'COUNT', 100,
      );
      cursor = nextCursor;
      keysToDelete.push(...keys);
    } while (cursor !== '0');

    if (keysToDelete.length > 0) {
      await this.redis.del(...keysToDelete);
    }
  }

  /** Close the Redis connection */
  async disconnect(): Promise<void> {
    await this.redis.quit();
  }
}

// ── Helper: convert FactAnchor to GraphNode ──

function anchorToNode(anchor: FactAnchor): GraphNode | null {
  switch (anchor.type) {
    case 'goal':
      return { nodeType: 'Goal', label: anchor.value, importance: Math.round(anchor.confidence * 10) };
    case 'person':
      return { nodeType: 'Person', role: anchor.slot, label: anchor.value };
    case 'barrier':
      return { nodeType: 'Barrier', label: anchor.value, intensity: anchor.confidence };
    case 'event':
    case 'decision':
    case 'identity':
      // These don't have a direct 1:1 node type in the graph schema.
      // Store as ContextCategory for now — will be refined in Component 8+.
      return { nodeType: 'ContextCategory', label: anchor.value as never };
    default:
      return null;
  }
}

function minimalNode(type: string, value: string): GraphNode | null {
  switch (type) {
    case 'goal':
      return { nodeType: 'Goal', label: value, importance: 5 };
    case 'person':
      return { nodeType: 'Person', role: 'unknown', label: value };
    case 'barrier':
      return { nodeType: 'Barrier', label: value, intensity: 0.5 };
    case 'event':
    case 'decision':
    case 'identity':
      return { nodeType: 'ContextCategory', label: value as never };
    default:
      return null;
  }
}
