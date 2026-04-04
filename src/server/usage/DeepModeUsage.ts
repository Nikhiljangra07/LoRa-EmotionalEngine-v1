/**
 * Deep Mode usage tracking — pay-as-you-go via Stripe.
 *
 * Every user gets FREE_DEEP_USES free deep analyses.
 * After that, each use costs $3 (one-time Stripe Checkout).
 * Paid credits are stored in Redis; free count tracked separately.
 *
 * Redis key: lora:deep:{userId}
 * Fields: freeUsed (int), paidCredits (int)
 */

import { getFalkorClient } from '../../emotion-core/memory-v1/db/falkorClient';

const REDIS_PREFIX = 'lora:deep:';
const FREE_DEEP_USES = 3;

function redisKey(userId: string): string {
  return `${REDIS_PREFIX}${userId}`;
}

async function getClient() {
  const c = getFalkorClient();
  if (c.status === 'wait') await c.connect();
  return c;
}

export interface DeepModeStatus {
  canUse: boolean;
  freeRemaining: number;
  paidCredits: number;
  needsPayment: boolean;
  totalUsed: number;
}

/**
 * Check whether a user can use deep mode right now.
 */
export async function getDeepModeStatus(userId: string): Promise<DeepModeStatus> {
  try {
    const c = await getClient();
    const data = await c.hgetall(redisKey(userId));
    const freeUsed = parseInt(data.freeUsed ?? '0', 10);
    const paidCredits = parseInt(data.paidCredits ?? '0', 10);

    const freeRemaining = Math.max(0, FREE_DEEP_USES - freeUsed);
    const canUse = freeRemaining > 0 || paidCredits > 0;
    const needsPayment = freeRemaining === 0 && paidCredits === 0;

    return {
      canUse,
      freeRemaining,
      paidCredits,
      needsPayment,
      totalUsed: freeUsed + (parseInt(data.paidUsed ?? '0', 10)),
    };
  } catch (err) {
    console.warn('[LoRa::DeepMode] Redis read failed, allowing use', (err as Error).message);
    // Fail open on Redis error — don't block paying users
    return { canUse: true, freeRemaining: 0, paidCredits: 0, needsPayment: false, totalUsed: 0 };
  }
}

/**
 * Consume one deep mode use. Deducts from free uses first, then paid credits.
 * Returns false if user has no uses remaining.
 */
export async function consumeDeepModeUse(userId: string): Promise<boolean> {
  try {
    const c = await getClient();
    const data = await c.hgetall(redisKey(userId));
    const freeUsed = parseInt(data.freeUsed ?? '0', 10);
    const paidCredits = parseInt(data.paidCredits ?? '0', 10);

    if (freeUsed < FREE_DEEP_USES) {
      // Still has free uses
      await c.hincrby(redisKey(userId), 'freeUsed', 1);
      return true;
    }

    if (paidCredits > 0) {
      // Deduct one paid credit
      await c.hincrby(redisKey(userId), 'paidCredits', -1);
      await c.hincrby(redisKey(userId), 'paidUsed', 1);
      return true;
    }

    return false;
  } catch (err) {
    console.warn('[LoRa::DeepMode] Redis write failed', (err as Error).message);
    return false;
  }
}

/**
 * Add one paid credit after successful Stripe payment.
 */
export async function addPaidCredit(userId: string): Promise<void> {
  try {
    const c = await getClient();
    await c.hincrby(redisKey(userId), 'paidCredits', 1);
    console.log(`[LoRa::DeepMode] +1 paid credit for ${userId}`);
  } catch (err) {
    console.error('[LoRa::DeepMode] Failed to add paid credit', (err as Error).message);
    throw err; // Caller must handle — this is payment-critical
  }
}

export { FREE_DEEP_USES };
