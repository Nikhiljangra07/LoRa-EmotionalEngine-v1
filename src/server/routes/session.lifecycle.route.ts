import type { Express, Request, Response } from 'express';
import { SessionManager } from '../session/SessionManager';
import { sharedTierService } from '../tier/TierService';
import type { SessionEntry } from './chat.route';
import { getSessionFinalizer } from './chat.route';
import { getEffectiveUserId } from '../auth/supabaseAuth';

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

    if (!sessionId || typeof sessionId !== 'string' || !sessionId.trim()) {
      res.status(400).json({ error: 'sessionId required' });
      return;
    }

    const trimmedId = sessionId.trim();
    const session = manager.getSession(trimmedId);
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
}
