import type { Express, Request, Response } from 'express';
import { SessionManager } from '../session/SessionManager';

/**
 * Register session lifecycle endpoints:
 *   POST /api/session/start      — create a new session
 *   POST /api/session/terminate  — cleanly end a session
 *
 * Pure lifecycle — no tier, no ETV, no engine coupling.
 */
export function registerSessionLifecycleRoute(app: Express): void {
  const manager = new SessionManager();

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

  app.post('/api/session/terminate', (req: Request, res: Response): void => {
    const { sessionId } = req.body ?? {};

    if (!sessionId || typeof sessionId !== 'string' || !sessionId.trim()) {
      res.status(400).json({ error: 'sessionId required' });
      return;
    }

    const ended = manager.endSession(sessionId.trim());
    console.log('[LoRa] SESSION TERMINATE:', { sessionId, ended });

    res.status(200).json({ ended });
    return;
  });
}
