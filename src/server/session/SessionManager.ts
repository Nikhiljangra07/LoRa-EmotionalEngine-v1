import crypto from 'crypto';

export interface SessionState {
  sessionId: string;
  userId: string;
  startedAt: number;
  endedAt?: number;
  active: boolean;
}

/**
 * Pure lifecycle manager for sessions.
 *
 * No tier logic. No ETV logic. No engine coupling.
 * Tracks creation, termination, and lookup of sessions in-memory.
 */
export class SessionManager {
  private sessions = new Map<string, SessionState>();

  createSession(userId: string): SessionState {
    const session: SessionState = {
      sessionId: crypto.randomUUID(),
      userId,
      startedAt: Date.now(),
      active: true,
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  endSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !session.active) return false;

    session.active = false;
    session.endedAt = Date.now();
    return true;
  }

  getSession(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId);
  }
}
