/**
 * HTTP client for the Multi-Perspective Engine (LoRaMaths microservice).
 *
 * Design principles:
 * - Timeout: 8s max. If the engine is slow, LoRa responds without it.
 * - Fallback: Returns null on ANY failure. LoRa works exactly as before.
 * - No retry: One shot. If it fails, skip — don't delay the user.
 * - Logging: Every call logged with timing for shadow validation.
 */

import type {
  PerspectiveAnalyzeRequest,
  PerspectiveAnalyzeResponse,
  PerspectiveConversationTurn,
} from './types';
import type { ChatTurn } from '../prompt/PromptTemplateBuilder';
import { increment as opIncrement } from '../../server/analytics/operationalCounters';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PERSPECTIVE_SERVICE_URL =
  process.env.LORA_PERSPECTIVE_URL || 'http://localhost:8000';

/** Max wait time for the perspective engine (ms).
 *  Vortex-full quick mode (Nano + Haiku + Flash-Lite cooperative handoff +
 *  pattern retriever + Sonnet synthesizer) typically completes in 10-21s.
 *  Set to 60s to align with the UI's "LoRa answers under 60s" promise — the
 *  whole reason Vortex exists is to shape the response, so timing it out and
 *  shipping without its output throws away the work. The 60s ceiling means
 *  Vortex output ALWAYS reaches the prompt (typical case 15-35s end-to-end
 *  including LLM), at the cost of letting rare 50s+ outliers blow past the
 *  UI timer rather than shipping framework-less responses. */
const PERSPECTIVE_TIMEOUT_QUICK_MS = parseInt(
  process.env.LORA_PERSPECTIVE_TIMEOUT_MS || '60000',
  10,
);
/** Deep reasoning gets more time — 5 parallel frameworks + Sonnet synthesis (68-81s typical, peaks at ~90s). */
const PERSPECTIVE_TIMEOUT_DEEP_MS = 120_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map backend ChatTurn[] to the format LoRaMaths expects.
 * Backend uses { role: 'user' | 'assistant', text, ts }.
 * LoRaMaths uses { role: 'user' | 'assistant', content }.
 */
function mapSessionHistory(
  history: ChatTurn[] | undefined,
): PerspectiveConversationTurn[] {
  if (!history || history.length === 0) return [];
  return history.map((turn) => ({
    role: turn.role,
    content: turn.text,
  }));
}

// ---------------------------------------------------------------------------
// Main client
// ---------------------------------------------------------------------------

/**
 * Analyze a user message through the Multi-Perspective Engine.
 *
 * @returns PerspectiveAnalyzeResponse on success, null on any failure.
 *          Null means "engine unavailable" — LoRa proceeds without frameworks.
 */
export async function fetchPerspectiveAnalysis(
  userMessage: string,
  sessionHistory?: ChatTurn[],
  domain?: string | null,
  mode?: 'quick' | 'deep',
): Promise<PerspectiveAnalyzeResponse | null> {
  const url = `${PERSPECTIVE_SERVICE_URL}/api/analyze`;
  const start = Date.now();
  const timeoutMs = mode === 'deep' ? PERSPECTIVE_TIMEOUT_DEEP_MS : PERSPECTIVE_TIMEOUT_QUICK_MS;

  // Map backend vocabulary to LoRaMaths API mode
  const apiMode = mode === 'deep' ? 'deep_reasoning' as const : mode;

  const requestBody: PerspectiveAnalyzeRequest = {
    text: userMessage,
    conversation_context: mapSessionHistory(sessionHistory),
    known_variables: [],
    domain: domain ?? null,
    ...(apiMode ? { mode: apiMode } : {}),
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      timeoutMs,
    );

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    clearTimeout(timeout); // Clear immediately after fetch resolves, before parsing body

    if (!response.ok) {
      const elapsed = Date.now() - start;
      opIncrement('perspective_failure');
      console.warn(
        `[LoRa::Perspective] HTTP ${response.status} from engine (${elapsed}ms)`,
      );
      return null;
    }

    const data: PerspectiveAnalyzeResponse = await response.json();
    const elapsed = Date.now() - start;

    console.log(
      `[LoRa::Perspective] OK — ${data.perspectives.length} perspective(s), ` +
        `frameworks=[${data.frameworks_used.join(',')}], ` +
        `confidence=${data.classification_confidence}, ` +
        `anti_creep=${data.anti_creep_passed ? 'PASS' : 'FAIL'}, ` +
        `engine=${data.processing_time_ms}ms, total=${elapsed}ms`,
    );

    opIncrement('perspective_success');
    return data;
  } catch (err: unknown) {
    const elapsed = Date.now() - start;
    const message =
      err instanceof Error ? err.message : 'Unknown error';

    // AbortError = timeout
    if (message.includes('abort')) {
      opIncrement('perspective_timeout');
      console.warn(
        `[LoRa::Perspective] Timeout after ${elapsed}ms (limit: ${timeoutMs}ms)`,
      );
    } else {
      opIncrement('perspective_failure');
      console.warn(
        `[LoRa::Perspective] Failed: ${message} (${elapsed}ms)`,
      );
    }

    return null;
  }
}
