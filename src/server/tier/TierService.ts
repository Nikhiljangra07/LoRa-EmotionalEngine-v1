import type { TierLevel, TierRecord } from './TierTypes';

const TIER_2_THRESHOLD = 3;
const TIER_3_THRESHOLD = 10;

/**
 * In-memory tier promotion service.
 *
 * Tier is based ONLY on completed sessions:
 *   TIER_1 → default (0–2 sessions)
 *   TIER_2 → 3+ completed sessions
 *   TIER_3 → 10+ completed sessions
 *
 * No file storage. No database. No engine coupling.
 * No ETV. No memory. Pure promotion logic.
 */
export class TierService {
  private records = new Map<string, TierRecord>();

  getTier(userId: string): TierRecord {
    let record = this.records.get(userId);
    if (!record) {
      record = { userId, sessionCount: 0, tier: 'TIER_1' };
      this.records.set(userId, record);
    }
    return { ...record };
  }

  recordSessionCompletion(userId: string): TierRecord {
    let record = this.records.get(userId);
    if (!record) {
      record = { userId, sessionCount: 0, tier: 'TIER_1' };
    }
    record.sessionCount += 1;
    record.tier = this.computeTier(record.sessionCount);
    this.records.set(userId, record);
    return { ...record };
  }

  computeTier(sessionCount: number): TierLevel {
    if (sessionCount >= TIER_3_THRESHOLD) return 'TIER_3';
    if (sessionCount >= TIER_2_THRESHOLD) return 'TIER_2';
    return 'TIER_1';
  }
}

/** Module-level shared instance so session lifecycle and chat routes see the same tier state. */
export const sharedTierService = new TierService();
