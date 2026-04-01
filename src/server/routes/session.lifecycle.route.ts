import type { Express, Request, Response } from 'express';
import { SessionManager } from '../session/SessionManager';
import { sharedTierService } from '../tier/TierService';
import type { SessionEntry } from './chat.route';
import { getSessionFinalizer } from './chat.route';
import { getEffectiveUserId } from '../auth/supabaseAuth';
import { getFalkorClient } from '../../emotion-core/memory-v1/db/falkorClient';

const sessionDebug = process.env.LORA_DEBUG_SESSION === '1';

/**
 * Register session lifecycle endpoints:
 *   POST /api/session/start      — create a new session
 *   POST /api/session/terminate  — cleanly end a session, evict engine, update tier
 *
 * @param engineSessions - the live engine Map from registerChatRoute (shared reference).
 *   When provided, terminate evicts the engine entry so subsequent messages get a fresh engine.
 */
export function registerSessionLifecycleRoute(
  app: Express,
  engineSessions?: Map<string, SessionEntry>,
): void {
  const manager = new SessionManager();
  const tierService = sharedTierService;

  app.post('/api/session/start', (req: Request, res: Response): void => {
    const userId = getEffectiveUserId(req, req.body?.userId);

    if (!userId) {
      res.status(400).json({ error: 'userId required' });
      return;
    }

    const session = manager.createSession(userId);
    console.log('[LoRa] SESSION START:', { sessionId: session.sessionId, userId: session.userId });

    res.status(200).json({
      sessionId: session.sessionId,
      startedAt: session.startedAt,
    });
    return;
  });

  app.post('/api/session/terminate', async (req: Request, res: Response): Promise<void> => {
    const { sessionId } = req.body ?? {};
    const requesterId = getEffectiveUserId(req, req.body?.userId);

    if (!sessionId || typeof sessionId !== 'string' || !sessionId.trim()) {
      res.status(400).json({ error: 'sessionId required' });
      return;
    }

    const trimmedId = sessionId.trim();
    const session = manager.getSession(trimmedId);

    // Verify the requester owns this session
    if (session && requesterId && session.userId !== requesterId) {
      res.status(403).json({ error: 'session_not_owned', message: 'Cannot terminate another user\'s session.' });
      return;
    }

    const ended = manager.endSession(trimmedId);
    console.log('[LoRa] SESSION TERMINATE:', { sessionId: trimmedId, ended });

    if (!ended || !session) {
      res.status(200).json({ ended: false });
      return;
    }

    // Use the shared finalizeSession — single code path for all session-end reasons.
    // Handles: engagement logging, PostHog, tier increment (if ≥2 msgs), Memory V2 (if ≥3 msgs).
    const finalizer = getSessionFinalizer();
    const engineKey = `${session.userId}::${trimmedId}`;
    const engineEntry = engineSessions?.get(engineKey);

    let tierRecord: { tier: string; sessionCount: number } | null = null;

    if (finalizer && engineEntry) {
      tierRecord = await finalizer(session.userId, trimmedId, engineEntry, 'user_terminate');
      engineSessions!.delete(engineKey);
      if (sessionDebug) console.log('[LoRa::Session] engine evicted via finalizer', { key: engineKey });
    } else if (engineSessions) {
      // Fallback: finalizer not registered yet (shouldn't happen in production)
      engineSessions.delete(engineKey);
      if (sessionDebug) console.log('[LoRa::Session] engine evicted (no finalizer)', { key: engineKey });
    }

    // If finalizer didn't return a tier record (session too short or no engine), get current tier.
    if (!tierRecord) {
      const current = await tierService.getTierAsync(session.userId);
      tierRecord = { tier: current.tier, sessionCount: current.sessionCount };
    }

    res.status(200).json({
      ended: true,
      tier: tierRecord.tier,
      sessionCount: tierRecord.sessionCount,
    });
    return;
  });

  /**
   * POST /api/tier/migrate — migrate tier data from guest userId to authenticated userId.
   *
   * Called once when a guest user signs in for the first time.
   * Copies sessionCount + tier from the guest Redis key to the authenticated key.
   * Only works if:
   *   - Request has a valid JWT (authenticated user)
   *   - guestUserId starts with "guest_"
   *   - Guest has tier data (sessionCount > 0)
   *   - Authenticated user has no existing tier data (fresh account)
   */
  app.post('/api/tier/migrate', async (req: Request, res: Response): Promise<void> => {
    const authenticatedUserId = req.verifiedUserId;
    if (!authenticatedUserId || !req.isAuthenticated) {
      res.status(401).json({ error: 'Authentication required for tier migration.' });
      return;
    }

    const { guestUserId } = req.body ?? {};
    if (!guestUserId || typeof guestUserId !== 'string' || !guestUserId.startsWith('guest_')) {
      res.status(400).json({ error: 'Valid guestUserId required.' });
      return;
    }

    try {
      const c = getFalkorClient();
      if (c.status === 'wait') await c.connect();

      // Read guest tier data
      const guestKey = `lora:tier:${guestUserId}`;
      const guestData = await c.hgetall(guestKey);

      if (!guestData || !guestData.sessionCount || parseInt(guestData.sessionCount, 10) <= 0) {
        res.status(200).json({ migrated: false, reason: 'no_guest_data' });
        return;
      }

      // Check authenticated user doesn't already have tier data
      const authKey = `lora:tier:${authenticatedUserId}`;
      const authData = await c.hgetall(authKey);

      if (authData && authData.sessionCount && parseInt(authData.sessionCount, 10) > 0) {
        res.status(200).json({ migrated: false, reason: 'already_has_data' });
        return;
      }

      // Copy tier data to authenticated key
      const sessionCount = parseInt(guestData.sessionCount, 10);
      const tier = guestData.tier || tierService.computeTier(sessionCount);
      await c.hset(authKey, 'sessionCount', String(sessionCount), 'tier', tier);

      console.log('[LoRa::TierMigrate]', {
        from: guestUserId.slice(0, 12) + '...',
        to: authenticatedUserId.slice(0, 8) + '...',
        sessionCount,
        tier,
      });

      res.status(200).json({ migrated: true, tier, sessionCount });
    } catch (err) {
      console.error('[LoRa::TierMigrate] failed:', (err as Error).message);
      res.status(500).json({ error: 'Migration failed. Please try again.' });
    }
  });
}
