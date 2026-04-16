import Anthropic from '@anthropic-ai/sdk';
import type { ConversationTurn, SessionSummary } from '../types';
import { parseLLMJson } from '../utils/json-parse';
import {
  SESSION_SUMMARY_SYSTEM_PROMPT,
  SESSION_SUMMARY_USER_PROMPT,
} from './template';

// ──────────────────────────────────────────────────────
// Session Summarizer — conversation history → structured summary
// The summary is TRANSIENT: exists only in memory, never persisted.
// This is the single source of truth for both extraction paths.
// ──────────────────────────────────────────────────────

export interface SummarizerConfig {
  model: string;
  apiKey: string;
}

/**
 * Format conversation turns into a readable transcript for the LLM.
 * Labels are "User:" and "LoRa:" — no raw content leaks into stored data
 * because the summary is discarded after extraction.
 */
function formatConversation(history: ConversationTurn[]): string {
  return history
    .map((turn) => {
      const label = turn.role === 'user' ? 'User' : 'LoRa';
      return `${label}: ${turn.content}`;
    })
    .join('\n\n');
}

/**
 * Validate that a parsed object matches the SessionSummary shape.
 * Throws if the structure is invalid.
 */
function validateSummary(raw: unknown): SessionSummary {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Summary is not an object');
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj['primaryTopic'] !== 'string' || obj['primaryTopic'].length === 0) {
    throw new Error('Missing or empty primaryTopic');
  }

  if (!Array.isArray(obj['keyFacts'])) {
    throw new Error('keyFacts must be an array');
  }

  const arc = obj['emotionalArc'];
  if (
    typeof arc !== 'object' || arc === null ||
    typeof (arc as Record<string, unknown>)['start'] !== 'string' ||
    typeof (arc as Record<string, unknown>)['middle'] !== 'string' ||
    typeof (arc as Record<string, unknown>)['end'] !== 'string'
  ) {
    throw new Error('emotionalArc must have start, middle, end strings');
  }

  const link = obj['causeExpressionLink'];
  if (
    typeof link !== 'object' || link === null ||
    typeof (link as Record<string, unknown>)['cause'] !== 'string' ||
    typeof (link as Record<string, unknown>)['expression'] !== 'string'
  ) {
    throw new Error('causeExpressionLink must have cause and expression strings');
  }

  if (obj['currentDirection'] !== null && typeof obj['currentDirection'] !== 'string') {
    throw new Error('currentDirection must be string or null');
  }

  if (!Array.isArray(obj['unresolved'])) {
    throw new Error('unresolved must be an array');
  }

  // §7 — structuralShape is optional (backward-compat + LLM may omit it)
  let structuralShape: SessionSummary['structuralShape'];
  const rawShape = obj['structuralShape'];
  if (rawShape && typeof rawShape === 'object' && rawShape !== null) {
    const shape = rawShape as Record<string, unknown>;
    if (
      typeof shape['dominantPattern'] === 'string' && shape['dominantPattern'].length > 0 &&
      Array.isArray(shape['namedAvoidances']) &&
      Array.isArray(shape['reframeAttempts'])
    ) {
      structuralShape = {
        dominantPattern: shape['dominantPattern'] as string,
        namedAvoidances: (shape['namedAvoidances'] as unknown[]).filter(
          (v): v is string => typeof v === 'string',
        ),
        reframeAttempts: (shape['reframeAttempts'] as unknown[])
          .filter((v): v is { turn: number; accepted: boolean } =>
            typeof v === 'object' && v !== null &&
            typeof (v as Record<string, unknown>)['turn'] === 'number' &&
            typeof (v as Record<string, unknown>)['accepted'] === 'boolean',
          ),
      };
    }
  }

  return {
    primaryTopic: obj['primaryTopic'] as string,
    keyFacts: obj['keyFacts'] as string[],
    emotionalArc: arc as SessionSummary['emotionalArc'],
    causeExpressionLink: link as SessionSummary['causeExpressionLink'],
    currentDirection: obj['currentDirection'] as string | null,
    unresolved: obj['unresolved'] as string[],
    ...(structuralShape ? { structuralShape } : {}),
  };
}

/**
 * Summarize a conversation session into a structured SessionSummary.
 *
 * The returned summary is TRANSIENT — callers must discard it after extraction.
 * It must never be persisted to any database.
 */
export async function summarizeSession(
  history: ConversationTurn[],
  config: SummarizerConfig,
): Promise<SessionSummary> {
  if (history.length === 0) {
    throw new Error('Cannot summarize an empty conversation');
  }

  const client = new Anthropic({ apiKey: config.apiKey, timeout: 15_000 });

  const transcript = formatConversation(history);

  const response = await client.messages.create({
    model: config.model,
    max_tokens: 1024,
    system: SESSION_SUMMARY_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: SESSION_SUMMARY_USER_PROMPT + transcript,
      },
    ],
  });

  // Detect truncation — incomplete JSON will fail parsing downstream
  if (response.stop_reason === 'max_tokens') {
    console.warn('[LoRa::MemoryV2::Summarizer] response truncated (max_tokens)');
  }

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from model');
  }

  const parsed: unknown = parseLLMJson(textBlock.text);
  return validateSummary(parsed);
}

// Export for testing
export { formatConversation, validateSummary };
