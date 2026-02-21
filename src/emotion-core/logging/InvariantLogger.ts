// ═══════════════════════════════════════════════════════════════════
// ORPHAN / NOT WIRED — DO NOT USE IN RUNTIME
// This logger is not imported by any runtime code path. It exists as
// a dev-only instrumentation stub for Phase-3 verification. Do not
// import into production modules.
// ═══════════════════════════════════════════════════════════════════

/**
 * DEV-ONLY INSTRUMENTATION
 * -----------------------
 * This logger is gated by process.env.LORA_DEBUG.
 * It must never affect production behavior or logic flow.
 *
 * Required by Phase-3 Opus verification.
 */

export class InvariantLogger {
  static logInvariant(
    name: string,
    payload: Record<string, unknown>
  ): void {
    if (!process.env.LORA_DEBUG) {
      return;
    }

    console.log('[LoRa::Invariant]', { name, payload });
  }
}
