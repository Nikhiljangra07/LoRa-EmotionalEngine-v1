/**
 * Subscription management — Stripe-backed monthly subscriptions ($19.99 CAD/mo).
 *
 * Users subscribe to "LoRa Depth" for unlimited Deep Mode access.
 * Subscription state is mirrored into Redis from Stripe webhook events
 * (customer.subscription.{created,updated,deleted}). Stripe is the source of
 * truth; Redis is a cached projection for fast per-request checks.
 *
 * Redis key: lora:sub:{userId}
 * Fields:
 *   status               — 'active' | 'canceled' | 'past_due' | 'incomplete' | 'none'
 *   stripeCustomerId     — Stripe customer ID (needed for Customer Portal)
 *   stripeSubscriptionId — Stripe subscription ID
 *   currentPeriodEnd     — ISO date of next billing (or access expiry after cancel)
 *   cancelAtPeriodEnd    — '1' when user canceled but access continues until period end
 *   canceledAt           — ISO date when cancellation was scheduled
 *   updatedAt            — ISO date of last webhook sync
 *
 * Fail-open on Redis errors — don't block users if Redis blips. Subscription
 * will be re-checked on the next message; worst case is one ungated deep call.
 */

import { getFalkorClient } from '../../emotion-core/memory-v1/db/falkorClient';

const REDIS_PREFIX = 'lora:sub:';

// Founder/ops bypass — comma-separated Supabase user IDs, supplied via the
// UNLIMITED_USER_IDS env var. Never hardcode IDs here: this repo is public,
// and a published ID combined with the guest body-userId path would let anyone
// claim the bypass. Unset env var = no bypass (secure default).
const UNLIMITED_USERS = new Set<string>(
  (process.env.UNLIMITED_USER_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
);

function redisKey(userId: string): string {
  return `${REDIS_PREFIX}${userId}`;
}

async function getClient() {
  const c = getFalkorClient();
  if (c.status === 'wait') await c.connect();
  return c;
}

export type SubscriptionStatusCode =
  | 'active'
  | 'canceled'
  | 'past_due'
  | 'incomplete'
  | 'none';

export interface SubscriptionStatus {
  isActive: boolean;
  status: SubscriptionStatusCode;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd: boolean;
  canceledAt?: string;
}

/**
 * Read a user's subscription state from Redis.
 * Returns { isActive: false, status: 'none' } if no record exists.
 *
 * `isActive` includes users whose subscription is `canceled` but still within
 * the paid period (Stripe sends cancel_at_period_end=true during this window).
 */
export async function getSubscription(userId: string): Promise<SubscriptionStatus> {
  if (UNLIMITED_USERS.has(userId)) {
    return { isActive: true, status: 'active', cancelAtPeriodEnd: false };
  }
  try {
    const c = await getClient();
    const data = await c.hgetall(redisKey(userId));
    if (!data || Object.keys(data).length === 0) {
      return { isActive: false, status: 'none', cancelAtPeriodEnd: false };
    }
    const status = (data.status as SubscriptionStatusCode) ?? 'none';
    const cancelAtPeriodEnd = data.cancelAtPeriodEnd === '1';
    const currentPeriodEnd = data.currentPeriodEnd || undefined;
    // Active OR canceled-but-still-in-paid-period both grant access.
    const stillWithinPaidPeriod =
      status === 'canceled' &&
      currentPeriodEnd &&
      new Date(currentPeriodEnd) > new Date();
    const isActive = status === 'active' || Boolean(stillWithinPaidPeriod);
    return {
      isActive,
      status,
      stripeCustomerId: data.stripeCustomerId || undefined,
      stripeSubscriptionId: data.stripeSubscriptionId || undefined,
      currentPeriodEnd,
      cancelAtPeriodEnd,
      canceledAt: data.canceledAt || undefined,
    };
  } catch (err) {
    console.warn(
      '[LoRa::Subscription] Redis read failed, treating as no subscription:',
      (err as Error).message,
    );
    return { isActive: false, status: 'none', cancelAtPeriodEnd: false };
  }
}

/**
 * Quick helper — returns true if the user has an active subscription
 * (or is in the always-active bypass set). Use this in hot paths like
 * the chat route deep-mode gate.
 */
export async function isActiveSubscriber(
  userId: string,
  verified: boolean = false,
): Promise<boolean> {
  // Bypass only for JWT-verified identities. Guests can put any string in
  // body.userId, so an unverified match must never unlock the bypass.
  if (verified && UNLIMITED_USERS.has(userId)) return true;
  const sub = await getSubscription(userId);
  return sub.isActive;
}

/**
 * Webhook payload — subset of Stripe subscription fields we care about.
 */
export interface SubscriptionWebhookPayload {
  userId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: SubscriptionStatusCode;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd?: boolean;
  canceledAt?: Date | null;
}

/**
 * Mirror a Stripe subscription event into Redis. Idempotent — safe to call
 * multiple times with the same payload. Called from the webhook handler.
 */
export async function upsertSubscription(payload: SubscriptionWebhookPayload): Promise<void> {
  if (!payload.userId) {
    console.warn('[LoRa::Subscription] upsert called with empty userId, skipping');
    return;
  }
  try {
    const c = await getClient();
    const fields: Record<string, string> = {
      status: payload.status,
      stripeCustomerId: payload.stripeCustomerId,
      stripeSubscriptionId: payload.stripeSubscriptionId,
      cancelAtPeriodEnd: payload.cancelAtPeriodEnd ? '1' : '0',
      updatedAt: new Date().toISOString(),
    };
    if (payload.currentPeriodEnd) {
      fields.currentPeriodEnd = payload.currentPeriodEnd.toISOString();
    }
    if (payload.canceledAt) {
      fields.canceledAt = payload.canceledAt.toISOString();
    }
    await c.hset(redisKey(payload.userId), fields);
    console.log(
      `[LoRa::Subscription] upsert userId=${payload.userId} status=${payload.status} ` +
        `cancelAtPeriodEnd=${payload.cancelAtPeriodEnd ? 1 : 0}`,
    );
  } catch (err) {
    console.error('[LoRa::Subscription] Redis write failed:', (err as Error).message);
    throw err; // Caller (webhook) should retry via Stripe's built-in retry
  }
}
