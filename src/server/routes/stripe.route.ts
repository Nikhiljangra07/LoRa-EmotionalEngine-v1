/**
 * Stripe routes for deep mode pay-as-you-go.
 *
 * POST /api/deep/check     — check if user can use deep mode
 * POST /api/deep/checkout   — create Stripe Checkout session ($3)
 * POST /api/stripe/webhook  — handle payment confirmation (raw body)
 */

import express, { Router, Request, Response } from 'express';
import { getDeepModeStatus, addPaidCredit } from '../usage/DeepModeUsage';
import { getEffectiveUserId } from '../auth/supabaseAuth';
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

function getPriceId(): string {
  return process.env.STRIPE_DEEP_PRICE_ID || '';
}

function getSuccessUrl(): string {
  return process.env.STRIPE_SUCCESS_URL || 'https://asklora.io?deep=success';
}

function getCancelUrl(): string {
  return process.env.STRIPE_CANCEL_URL || 'https://asklora.io?deep=cancelled';
}

// ── API routes (JSON body) ─────────────────────────────────────────
export function createStripeRouter(): Router {
  const router = Router();

  /**
   * POST /api/deep/check
   * Returns whether user can use deep mode, free uses remaining, etc.
   */
  router.post('/api/deep/check', async (req: Request, res: Response) => {
    try {
      const userId = getEffectiveUserId(req, req.body?.userId);
      if (!userId) {
        res.json({
          canUse: false,
          freeRemaining: 0,
          paidCredits: 0,
          needsPayment: true,
          totalUsed: 0,
          requiresAuth: true,
        });
        return;
      }

      const status = await getDeepModeStatus(userId);
      res.json(status);
    } catch (err) {
      console.error('[LoRa::Stripe] /api/deep/check failed', err);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  /**
   * POST /api/deep/checkout
   * Creates a Stripe Checkout Session for one deep analysis ($3).
   * Returns { url } for the frontend to redirect to.
   */
  router.post('/api/deep/checkout', async (req: Request, res: Response) => {
    try {
      const userId = getEffectiveUserId(req, req.body?.userId);
      if (!userId) {
        res.status(401).json({ error: 'auth_required', message: 'Sign in to use Deep Analysis' });
        return;
      }

      const priceId = getPriceId();
      if (!priceId) {
        console.error('[LoRa::Stripe] STRIPE_DEEP_PRICE_ID not configured');
        res.status(500).json({ error: 'payment_not_configured' });
        return;
      }

      const stripe = getStripe();
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: getSuccessUrl(),
        cancel_url: getCancelUrl(),
        metadata: { userId, purpose: 'deep_analysis' },
      });

      res.json({ url: session.url });
    } catch (err) {
      console.error('[LoRa::Stripe] Checkout creation failed', err);
      res.status(500).json({ error: 'checkout_failed' });
    }
  });

  return router;
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

      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const userId = session.metadata?.userId;

        // Legacy $3/use path — only when mode is 'payment' (not 'subscription').
        // Subscriptions are handled by customer.subscription.* events below.
        if (userId && session.mode === 'payment' && session.payment_status === 'paid') {
          try {
            await addPaidCredit(userId);
            console.log(`[LoRa::Stripe] Payment confirmed → +1 credit for ${userId}`);
          } catch (err) {
            console.error(`[LoRa::Stripe] Credit failed for ${userId}`, err);
            res.status(500).json({ error: 'credit_failed' });
            return;
          }
        }
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
