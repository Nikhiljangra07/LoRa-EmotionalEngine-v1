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
