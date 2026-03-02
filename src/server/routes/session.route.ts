import type { Express, Request, Response } from 'express';
import { TierStorage } from '../../emotion-core/tier/TierState';
import type { SessionEntry } from './chat.route';

function isNonEmptyString(x: unknown): x is string {
  return typeof x === 'string' && x.trim().length > 0;
}

/**
 * Register POST /api/session/end.
 *
 * Accepts { userId, sessionId } and cleanly terminates the active session:
 *   - Calls engine.endSession() (triggers tier update, ETV update, memory consolidation)
 *   - Removes the session entry from the shared sessions map
 *   - Returns { ended: true, tier, sessionCount }
 *
 * When no session exists for the userId, returns { ended: false, reason: "no_active_session" }
 * without crashing.
 *
 * @param sessions - the live sessions Map from registerChatRoute (shared reference)
 */
export function registerSessionEndRoute(
  app: Express,
  sessions: Map<string, SessionEntry>,
): void {
  app.post('/api/session/end', (req: Request, res: Response): void => {
    console.log('[LoRa] SESSION END API CALLED');

    const body = req.body as Record<string, unknown>;
    const userId    = isNonEmptyString(body?.userId)    ? body.userId.trim()    : '';
    const sessionId = isNonEmptyString(body?.sessionId) ? body.sessionId.trim() : '';

    if (!userId || !sessionId) {
      res.status(400).json({ error: 'userId and sessionId are required.' });
      return;
    }

    // End ALL sessions belonging to this userId (handles sessionId mismatch gracefully).
    const userPrefix = `${userId}::`;
    let found = false;
    for (const [k, entry] of sessions.entries()) {
      if (k.startsWith(userPrefix)) {
        entry.engine.endSession();
        sessions.delete(k);
        found = true;
      }
    }

    if (!found) {
      res.status(200).json({ ended: false, reason: 'no_active_session' });
      return;
    }

    const tierState = TierStorage.load(userId);
    res.status(200).json({
      ended: true,
      tier: tierState?.currentTier ?? 'TIER_1',
      sessionCount: tierState?.sessionCount ?? 0,
    });
  });
}
