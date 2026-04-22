/**
 * Stripe webhook — subscription lifecycle events.
 *
 * POST /api/stripe/webhook  — handle subscription events (raw body)
 *
 * The legacy $3/use flow (/api/deep/check, /api/deep/checkout) was removed
 * in favour of the monthly subscription model (see subscription.route.ts).
 */

import express, { Request, Response } from 'express';
import {
  upsertSubscription,
  SubscriptionStatusCode,
} from '../subscription/SubscriptionService';

// ── Stripe client (lazy singleton) ─────────────────────────────────
// Use require() to avoid subpath export issues with stripe v22 on Node 18
let _stripe: any = null;
function getStripe(): any {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY not set');
    const Stripe = require('stripe');
    _stripe = new Stripe(key);
  }
  return _stripe;
}

/**
 * Register the Stripe webhook endpoint.
 *
 * MUST be called BEFORE app.use(express.json()) because Stripe
 * signature verification requires the raw request body.
 */
export function registerStripeWebhook(app: express.Express): void {
  app.post(
    '/api/stripe/webhook',
    express.raw({ type: 'application/json' }),
    async (req: Request, res: Response) => {
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!webhookSecret) {
        console.warn('[LoRa::Stripe] STRIPE_WEBHOOK_SECRET not set');
        res.status(400).json({ error: 'webhook_not_configured' });
        return;
      }

      const sig = req.headers['stripe-signature'] as string;
      if (!sig) {
        res.status(400).json({ error: 'missing_signature' });
        return;
      }

      let event: any;
      try {
        const stripe = getStripe();
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
      } catch (err) {
        console.error('[LoRa::Stripe] Webhook signature failed:', (err as Error).message);
        res.status(400).json({ error: 'invalid_signature' });
        return;
      }

      // ── Subscription lifecycle events ─────────────────────────────
      // customer.subscription.{created,updated,deleted} mirror Stripe state into
      // Redis via SubscriptionService.upsertSubscription. Metadata.userId was
      // set during checkout creation (see subscription.route.ts → subscription_data).
      if (event.type.startsWith('customer.subscription.')) {
        const sub = event.data.object;
        const userId = sub.metadata?.userId;

        if (!userId) {
          console.warn(
            `[LoRa::Stripe] ${event.type} missing metadata.userId — subscriptionId=${sub.id}`,
          );
        } else {
          const status = mapStripeStatusToLora(event.type, sub.status);
          try {
            await upsertSubscription({
              userId,
              stripeCustomerId: sub.customer,
              stripeSubscriptionId: sub.id,
              status,
              currentPeriodEnd: sub.current_period_end
                ? new Date(sub.current_period_end * 1000)
                : undefined,
              cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
              canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
            });
            console.log(
              `[LoRa::Stripe] ${event.type} → mirrored to Redis for ${userId} (${status})`,
            );
          } catch (err) {
            console.error(`[LoRa::Stripe] Subscription mirror failed for ${userId}`, err);
            // Return 500 so Stripe retries the webhook (built-in exponential backoff).
            res.status(500).json({ error: 'subscription_mirror_failed' });
            return;
          }
        }
      }

      res.json({ received: true });
    }
  );
}

/**
 * Map a Stripe subscription `status` field + event type to our internal
 * SubscriptionStatusCode. customer.subscription.deleted always maps to
 * 'canceled' regardless of the status field (which can be stale at delete time).
 */
function mapStripeStatusToLora(
  eventType: string,
  stripeStatus: string | undefined,
): SubscriptionStatusCode {
  if (eventType === 'customer.subscription.deleted') return 'canceled';
  switch (stripeStatus) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
      return 'canceled';
    case 'incomplete':
    case 'incomplete_expired':
      return 'incomplete';
    default:
      return 'none';
  }
}
