const INVARIANT_LOGGING_ENABLED = false;

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
