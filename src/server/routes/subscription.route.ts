/**
 * Subscription routes — Stripe-backed monthly subscriptions ($19.99 CAD/mo).
 *
 *   POST /api/subscription/status    → current subscription state
 *   POST /api/subscription/checkout  → create Checkout Session (mode: 'subscription')
 *   POST /api/subscription/portal    → create Customer Portal session
 *
 * Webhook handling lives in stripe.route.ts (registerStripeWebhook). Subscription
 * state is mirrored to Redis on customer.subscription.{created,updated,deleted}.
 *
 * All three routes accept `userId` in the request body as a fallback for
 * clients that aren't sending the Authorization header yet. The JWT-derived
 * userId takes precedence when both are present (see getEffectiveUserId).
 */

import { Router, Request, Response } from 'express';
import { getEffectiveUserId } from '../auth/supabaseAuth';
import { getSubscription } from '../subscription/SubscriptionService';
import { featureFlags } from '../../emotion-core/config/featureFlags';

// ── Stripe client (lazy singleton) ─────────────────────────────────
// Use require() to avoid subpath export issues with stripe v22 on Node 18.
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

function getSubPriceId(): string {
  return process.env.STRIPE_SUB_PRICE_ID || '';
}

function getSuccessUrl(): string {
  return (
    process.env.STRIPE_SUB_SUCCESS_URL ||
    process.env.STRIPE_SUCCESS_URL?.replace(/deep=success/, 'sub=success') ||
    'https://asklora.io?sub=success'
  );
}

function getCancelUrl(): string {
  return (
    process.env.STRIPE_SUB_CANCEL_URL ||
    process.env.STRIPE_CANCEL_URL?.replace(/deep=cancelled/, 'sub=cancelled') ||
    'https://asklora.io?sub=cancelled'
  );
}

function getPortalReturnUrl(): string {
  return process.env.STRIPE_PORTAL_RETURN_URL || 'https://asklora.io/chat';
}

export function createSubscriptionRouter(): Router {
  const router = Router();

  /**
   * POST /api/subscription/status
   * Returns the user's current subscription state. Safe to poll — reads Redis only.
   */
  router.post('/api/subscription/status', async (req: Request, res: Response) => {
    try {
      const userId = getEffectiveUserId(req, req.body?.userId);
      if (!userId) {
        res.json({
          isActive: false,
          status: 'none',
          cancelAtPeriodEnd: false,
          requiresAuth: true,
        });
        return;
      }
      const sub = await getSubscription(userId);
      res.json(sub);
    } catch (err) {
      console.error('[LoRa::Subscription] /status failed', err);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  /**
   * POST /api/subscription/checkout
   * Creates a Stripe Checkout Session in subscription mode ($19.99/mo).
   * Returns { url } for the frontend to redirect to.
   *
   * Gated by LORA_SUBSCRIPTION_ENABLED — returns 503 when feature flag is off,
   * so the frontend can fall back gracefully.
   */
  router.post('/api/subscription/checkout', async (req: Request, res: Response) => {
    try {
      if (!featureFlags.subscriptionEnabled) {
        res.status(503).json({
          error: 'subscription_disabled',
          message: 'Subscriptions are not currently available',
        });
        return;
      }

      const userId = getEffectiveUserId(req, req.body?.userId);
      if (!userId) {
        res.status(401).json({ error: 'auth_required', message: 'Sign in to subscribe' });
        return;
      }

      const priceId = getSubPriceId();
      if (!priceId) {
        console.error('[LoRa::Subscription] STRIPE_SUB_PRICE_ID not configured');
        res.status(500).json({ error: 'payment_not_configured' });
        return;
      }

      // If already subscribed, don't create a duplicate — send user to portal.
      const existing = await getSubscription(userId);
      if (existing.isActive) {
        res.status(409).json({
          error: 'already_subscribed',
          message: 'You already have an active subscription',
        });
        return;
      }

      const stripe = getStripe();
      // Reuse existing customer if we have one (edge case: expired/canceled user resubscribes).
      const customerParam: Record<string, unknown> = {};
      if (existing.stripeCustomerId) {
        customerParam.customer = existing.stripeCustomerId;
      }

      const session = await stripe.checkout.sessions.create({
        ...customerParam,
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: getSuccessUrl(),
        cancel_url: getCancelUrl(),
        // Metadata is propagated onto the Subscription object (via subscription_data)
        // so webhook events arrive with userId already attached.
        subscription_data: {
          metadata: { userId, purpose: 'lora_depth_subscription' },
        },
        metadata: { userId, purpose: 'lora_depth_subscription' },
      });

      res.json({ url: session.url });
    } catch (err) {
      console.error('[LoRa::Subscription] /checkout failed', err);
      res.status(500).json({ error: 'checkout_failed' });
    }
  });

  /**
   * POST /api/subscription/portal
   * Creates a Stripe Customer Portal session — user manages / cancels subscription there.
   * Stripe hosts the page; we just generate the link.
   */
  router.post('/api/subscription/portal', async (req: Request, res: Response) => {
    try {
      const userId = getEffectiveUserId(req, req.body?.userId);
      if (!userId) {
        res.status(401).json({ error: 'auth_required' });
        return;
      }

      const sub = await getSubscription(userId);
      if (!sub.stripeCustomerId) {
        res.status(404).json({
          error: 'no_subscription',
          message: 'No subscription found for this account',
        });
        return;
      }

      const stripe = getStripe();
      const session = await stripe.billingPortal.sessions.create({
        customer: sub.stripeCustomerId,
        return_url: getPortalReturnUrl(),
      });

      res.json({ url: session.url });
    } catch (err) {
      console.error('[LoRa::Subscription] /portal failed', err);
      res.status(500).json({ error: 'portal_failed' });
    }
  });

  return router;
}
