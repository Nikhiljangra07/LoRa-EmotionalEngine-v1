/**
 * InvariantLogger (Phase-3, Dev-Only)
 *
 * Purpose:
 * - Observability for invariant verification
 * - Zero behavioral impact on runtime
 *
 * Activation:
 * - Enabled ONLY when process.env.LORA_DEBUG === 'true'
 *
 * Guarantees:
 * - Read-only logging
 * - No emotion inference
 * - No scoring influence
 * - Safe to strip from production builds
 */

const INVARIANT_LOGGING_ENABLED =
  process.env.LORA_DEBUG === 'true';

export class InvariantLogger {
  static logInvariant(
    name: string,
    payload: Record<string, unknown>
  ): void {
    if (!INVARIANT_LOGGING_ENABLED) {
      return;
    }

    console.log('[LoRa::Invariant]', { name, payload });
  }
}
