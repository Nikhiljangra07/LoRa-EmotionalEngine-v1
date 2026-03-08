import { EngineOrchestrator } from '../../emotion-core/engines/EngineOrchestrator';

/**
 * SessionManager
 * ──────────────
 * Minimal adapter-layer class that holds EngineOrchestrator instances
 * keyed by session ID so that HTTP requests can share stateful engine
 * behavior across calls (ETV, momentum, cooldown, message count).
 *
 * IMPORTANT:
 *  - In-memory only. All state is ephemeral and lost on process restart.
 *  - No TTL, no cleanup, no persistence. These are explicitly deferred.
 *  - This class is an adapter concern. It must never be imported by
 *    the emotional engine, analyzers, scorers, or prompt builders.
 */
export class SessionManager {
  private readonly sessions = new Map<string, EngineOrchestrator>();

  /**
   * Return the engine for `sessionId`, creating one lazily if needed.
   */
  getEngine(sessionId: string): EngineOrchestrator {
    let engine = this.sessions.get(sessionId);
    if (!engine) {
      engine = new EngineOrchestrator();
      this.sessions.set(sessionId, engine);
      console.log(`[LoRa::Session] created session ${sessionId}`);
    }
    return engine;
  }
}
