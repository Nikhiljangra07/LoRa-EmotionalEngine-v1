/**
 * llmTelemetry — Passive LLM health tracking.
 *
 * Records the timestamp of the last successful *real* LLM response.
 * Consumed exclusively by GET /health/llm.
 *
 * Rules:
 *  - Do NOT count fallback responses as success.
 *  - Do NOT add polling, retries, or side-effects here.
 *  - This module is internal bookkeeping only.
 */

let _lastSuccessTs: number | null = null;

/** Call ONCE per successful real LLM response. */
export function recordLLMSuccess(): void {
  _lastSuccessTs = Date.now();
}

/** Read-only snapshot for the health endpoint. */
export function getLLMHealth(): {
  openai: 'ok' | 'down';
  lastSuccess: number | null;
} {
  return {
    openai: _lastSuccessTs !== null ? 'ok' : 'down',
    lastSuccess: _lastSuccessTs,
  };
}
