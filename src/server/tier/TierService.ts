import type { TierLevel, TierRecord } from './TierTypes';
import { getFalkorClient } from '../../emotion-core/memory-v1/db/falkorClient';
import { trackTierChanged } from '../analytics/posthogClient';

const TIER_2_THRESHOLD = 3;
const TIER_3_THRESHOLD = 10;

const REDIS_PREFIX = 'lora:tier:';

function redisKey(userId: string): string {
  return `${REDIS_PREFIX}${userId}`;
}

async function getClient() {
  const c = getFalkorClient();
  if (c.status === 'wait') await c.connect();
  return c;
}

function defaultRecord(userId: string): TierRecord {
  return { userId, sessionCount: 0, tier: 'TIER_1' };
}

/**
 * Tier promotion service backed by Redis.
 *
 * Tier is based ONLY on completed sessions:
 *   TIER_1 → default (0–2 sessions)
 *   TIER_2 → 3+ completed sessions
 *   TIER_3 → 10+ completed sessions
 *
 * Redis key format: lora:tier:{userId}
 * Stored as a Redis hash with fields: sessionCount, tier.
 *
 * Falls back to in-memory Map if Redis is unavailable.
 */
export class TierService {
  private fallback = new Map<string, TierRecord>();
  private countedSessions = new Set<string>();

  async getTierAsync(userId: string): Promise<TierRecord> {
    try {
      const c = await getClient();
      const data = await c.hgetall(redisKey(userId));
      if (data && data.sessionCount !== undefined) {
        const sessionCount = parseInt(data.sessionCount, 10) || 0;
        const tier = (data.tier as TierLevel) || this.computeTier(sessionCount);
        const record: TierRecord = { userId, sessionCount, tier };
        this.fallback.set(userId, record);
        return record;
      }
    } catch (err) {
      console.warn('[LoRa::TierService] Redis read failed, using fallback', (err as Error).message);
    }
    return this.getTierFromFallback(userId);
  }

  getTier(userId: string): TierRecord {
    const cached = this.fallback.get(userId);
    if (cached) return { ...cached };
    return defaultRecord(userId);
  }

  async recordSessionCompletionAsync(userId: string, sessionId?: string): Promise<TierRecord> {
    if (sessionId && this.countedSessions.has(sessionId)) {
      return this.getTierAsync(userId);
    }
    if (sessionId) this.countedSessions.add(sessionId);
    let record: TierRecord;
    try {
      const c = await getClient();
      const data = await c.hgetall(redisKey(userId));
      if (data && data.sessionCount !== undefined) {
        record = {
          userId,
          sessionCount: (parseInt(data.sessionCount, 10) || 0) + 1,
          tier: 'TIER_1',
        };
      } else {
        const cached = this.fallback.get(userId);
        record = {
          userId,
          sessionCount: (cached?.sessionCount ?? 0) + 1,
          tier: 'TIER_1',
        };
      }
      const previousTier = this.fallback.get(userId)?.tier ?? 'TIER_1';
      record.tier = this.computeTier(record.sessionCount);
      await c.hset(redisKey(userId), 'sessionCount', String(record.sessionCount), 'tier', record.tier);
      this.fallback.set(userId, record);
      if (record.tier !== previousTier) {
        trackTierChanged(userId, { previousTier, newTier: record.tier, sessionCount: record.sessionCount });
      }
      return { ...record };
    } catch (err) {
      console.warn('[LoRa::TierService] Redis write failed, using fallback', (err as Error).message);
    }
    return this.recordSessionFromFallback(userId);
  }

  recordSessionCompletion(userId: string, sessionId?: string): TierRecord {
    if (sessionId && this.countedSessions.has(sessionId)) {
      return this.getTier(userId);
    }
    if (sessionId) this.countedSessions.add(sessionId);
    const record = this.recordSessionFromFallback(userId);
    this.recordSessionCompletionAsync(userId, sessionId).then(
      (r) => { this.fallback.set(userId, r); },
      () => {},
    );
    return record;
  }

  computeTier(sessionCount: number): TierLevel {
    if (sessionCount >= TIER_3_THRESHOLD) return 'TIER_3';
    if (sessionCount >= TIER_2_THRESHOLD) return 'TIER_2';
    return 'TIER_1';
  }

  private getTierFromFallback(userId: string): TierRecord {
    let record = this.fallback.get(userId);
    if (!record) {
      record = defaultRecord(userId);
      this.fallback.set(userId, record);
    }
    return { ...record };
  }

  private recordSessionFromFallback(userId: string): TierRecord {
    let record = this.fallback.get(userId);
    if (!record) {
      record = defaultRecord(userId);
    }
    record.sessionCount += 1;
    record.tier = this.computeTier(record.sessionCount);
    this.fallback.set(userId, record);
    return { ...record };
  }
}

/** Module-level shared instance so session lifecycle and chat routes see the same tier state. */
export const sharedTierService = new TierService();
