import type { Express, Request, Response } from 'express';
import { SessionManager } from '../session/SessionManager';
import { sharedTierService } from '../tier/TierService';
import { trackSessionEnded } from '../analytics/posthogClient';
import type { SessionEntry } from './chat.route';

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
    const { userId } = req.body ?? {};

    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      res.status(400).json({ error: 'userId required' });
      return;
    }

    const session = manager.createSession(userId.trim());
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

    // Evict the engine entry so subsequent messages on a new session get a fresh engine.
    let messagesCount = 0;
    let durationSeconds = 0;
    let tokensUsed = 0;
    if (engineSessions) {
      const engineKey = `${session.userId}::${trimmedId}`;
      const engineEntry = engineSessions.get(engineKey);
      if (engineEntry) {
        messagesCount = engineEntry.history.filter(t => t.role === 'user').length;
        durationSeconds = Math.round((Date.now() - engineEntry.sessionStartedAt) / 1000);
        tokensUsed = engineEntry.tokensUsed;
      }
      const evicted = engineSessions.delete(engineKey);
      console.log('ENGINE EVICTED:', engineKey);
      if (sessionDebug) console.log('[LoRa::Session] engine evicted', { key: engineKey, evicted });
    }

    trackSessionEnded(session.userId, trimmedId, {
      messagesCount,
      durationSeconds,
      tokensUsed,
      reason: 'user_terminate',
    });

    const tierRecord = await tierService.recordSessionCompletionAsync(session.userId, trimmedId);

    res.status(200).json({
      ended: true,
      tier: tierRecord.tier,
      sessionCount: tierRecord.sessionCount,
    });
    return;
  });
}
