import Anthropic from '@anthropic-ai/sdk';
import { recordLLMSuccess } from '../../server/llmTelemetry';
import { increment as opIncrement } from '../../server/analytics/operationalCounters';
import { debugEnabled } from '../debug/debugGate';
import { CACHE_BOUNDARY, type ChatTurn } from '../prompt/PromptTemplateBuilder';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1024;
const TEMPERATURE = 0.6;

/**
 * Split the combined system prompt on CACHE_BOUNDARY sentinel and return
 * the Anthropic `system` param. When the sentinel is present and the prefix
 * is substantial, returns a two-block array with cache_control on the
 * static prefix. Otherwise returns the original string (no caching).
 *
 * Anthropic's prefix-based prompt cache requires the cached prefix to be
 * >= 1024 tokens (~4000 chars) to activate. Below that threshold we fall
 * back to the string form so we don't pay overhead for a no-op cache.
 */
function buildSystemParam(
  systemPrompt: string,
): string | Anthropic.Messages.MessageCreateParams['system'] {
  const idx = systemPrompt.indexOf(CACHE_BOUNDARY);
  if (idx === -1) return systemPrompt;

  const rawPrefix = systemPrompt.slice(0, idx);
  const rawSuffix = systemPrompt.slice(idx + CACHE_BOUNDARY.length);

  // Trim only the sentinel-adjacent whitespace, preserve internal formatting.
  const prefix = rawPrefix.replace(/\s+$/, '');
  const suffix = rawSuffix.replace(/^\s+/, '');

  // Cache only when prefix clears Anthropic's ~1024-token minimum. Rough
  // 4-char-per-token estimate — safely conservative for our mixed content.
  if (prefix.length < 4000) return `${prefix}\n\n${suffix}`;

  // Anthropic concatenates text blocks with no separator, so the suffix
  // carries the paragraph break. Keeping the separator on the suffix (not
  // the prefix) preserves cache-key stability: the prefix bytes stay
  // identical across (tier, band) replays.
  return [
    { type: 'text', text: prefix, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: `\n\n${suffix}` },
  ];
}

/**
 * Log Anthropic prompt-cache usage per request so Railway logs expose the
 * real cache hit rate. Without this, there's no way to verify caching is
 * actually hitting without manually checking the Anthropic Console. Cheap
 * side effect — one log line per LLM call.
 */
function logCacheUsage(
  requestId: string,
  usage: Anthropic.Messages.Usage | null | undefined,
  latencyMs: number,
): void {
  if (!usage) return;
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const totalInput = input + cacheRead + cacheWrite;
  const hitPercent = totalInput > 0 ? Math.round((cacheRead / totalInput) * 100) : 0;

  console.log('[LoRa::Cache]', {
    requestId,
    input,
    cacheRead,
    cacheWrite,
    output,
    hitPercent,
    latencyMs,
  });
}

/** Image or document attachment for multimodal messages. */
export type LLMAttachment = {
  type: 'image' | 'document';
  mimeType: string;
  data: string; // base64
};

export type GenerateResponseOptions = {
  signal?: AbortSignal;
  requestId?: string;
  /** Prior turns (chronological). Current user message is passed separately and appended. */
  sessionHistory?: ChatTurn[];
  /** Attachments (images, PDFs) to include with the user message. */
  attachments?: LLMAttachment[];
};

/**
 * Build the messages array for the Anthropic API.
 * Handles multimodal content (images, PDFs) when attachments are present.
 */
function buildMessages(
  priorTurns: ChatTurn[],
  userMessage: string,
  attachments?: LLMAttachment[],
): Anthropic.MessageCreateParams['messages'] {
  // Build the current user message — multimodal if attachments present
  let userContent: string | Anthropic.ContentBlockParam[];
  if (attachments && attachments.length > 0) {
    const blocks: Anthropic.ContentBlockParam[] = [];
    for (const att of attachments) {
      if (att.type === 'image') {
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: att.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: att.data },
        });
      } else if (att.type === 'document') {
        blocks.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: att.data },
        });
      }
    }
    if (userMessage) blocks.push({ type: 'text', text: userMessage });
    userContent = blocks;
  } else {
    userContent = userMessage;
  }

  return [
    ...priorTurns.map((t) => ({
      role: t.role as 'user' | 'assistant',
      content: t.text,
    })),
    { role: 'user' as const, content: userContent },
  ];
}

/**
 * Claude Sonnet 4-6 responder — sole LLM runtime for LoRa.
 * Implements the same contract as the former OpenAIResponder:
 * generateResponse(systemPrompt, userMessage, options?) → Promise<string>
 * When sessionHistory is provided, builds messages array for conversational continuity.
 */
export class ClaudeResponder {
  private client: Anthropic;

  constructor() {
    if (debugEnabled) {
      console.log('[LoRa::Debug][ClaudeResponder] config', {
        provider: 'anthropic',
        model: MODEL,
        apiKeyPresent: !!process.env.ANTHROPIC_API_KEY,
      });
    }

    if (!process.env.ANTHROPIC_API_KEY?.trim()) {
      throw new Error('ANTHROPIC_API_KEY not set or empty');
    }

    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  /**
   * Generate a response from LoRa
   * Uses Claude Sonnet 4-6 with the same constraints as the prior OpenAI responder:
   * - temperature: 0.6
   * - max_tokens: 400
   * - Returns clean text only
   */
  async generateResponse(
    systemPrompt: string,
    userMessage: string,
    options?: GenerateResponseOptions
  ): Promise<string> {
    const startTime = Date.now();
    const requestId = options?.requestId ?? 'unknown';

    const history = options?.sessionHistory ?? [];
    const priorTurns = history.length > 0 && history[history.length - 1]?.role === 'user'
      ? history.slice(0, -1)
      : history;

    const messages = buildMessages(priorTurns, userMessage, options?.attachments);

    if (debugEnabled) {
      console.log('[LoRa::Debug][ClaudeResponder] role separation', {
        requestId,
        systemPromptLength: systemPrompt.length,
        userMessageLength: userMessage.length,
        priorTurnsCount: priorTurns.length,
        attachments: options?.attachments?.length ?? 0,
      });
    }

    if (process.env.LORA_DEBUG_LLM_PAYLOAD === '1') {
      console.log('[LoRa] LLM PAYLOAD:');
      console.log(JSON.stringify({ system: systemPrompt.slice(0, 200) + '...', messageCount: messages.length }, null, 2));
    }

    const response = await this.client.messages.create(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        system: buildSystemParam(systemPrompt),
        messages,
      },
      options?.signal ? { signal: options.signal } : {}
    );

    const latencyMs = Date.now() - startTime;
    logCacheUsage(requestId, response.usage, latencyMs);

    const firstBlock = response.content[0];
    const text =
      firstBlock && firstBlock.type === 'text' ? firstBlock.text.trim() : '';

    if (!text) {
      throw new Error('Empty response from Claude');
    }

    recordLLMSuccess();
    opIncrement('llm_success');

    if (debugEnabled) {
      console.log('[LoRa::Debug][ClaudeResponder] success', {
        requestId,
        model: MODEL,
        latencyMs,
        outputLength: text.length,
      });
    }

    return text;
  }

  /**
   * Stream a response from LoRa token-by-token.
   * Calls onToken for each text chunk as it arrives from the API.
   * Returns the complete accumulated text when done.
   *
   * The caller is responsible for buffering + identity guard.
   * This method only handles the Anthropic streaming API.
   */
  async generateResponseStream(
    systemPrompt: string,
    userMessage: string,
    onToken: (chunk: string) => void,
    options?: GenerateResponseOptions,
  ): Promise<string> {
    const startTime = Date.now();
    const requestId = options?.requestId ?? 'unknown';

    const history = options?.sessionHistory ?? [];
    const priorTurns = history.length > 0 && history[history.length - 1]?.role === 'user'
      ? history.slice(0, -1)
      : history;

    const messages = buildMessages(priorTurns, userMessage, options?.attachments);

    if (process.env.LORA_DEBUG_LLM_PAYLOAD === '1') {
      console.log('[LoRa] LLM STREAM PAYLOAD:');
      console.log(JSON.stringify({ system: systemPrompt.slice(0, 200) + '...', messageCount: messages.length }, null, 2));
    }

    let accumulated = '';

    const stream = this.client.messages.stream(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        system: buildSystemParam(systemPrompt),
        messages,
      },
      options?.signal ? { signal: options.signal } : {},
    );

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        const chunk = event.delta.text;
        accumulated += chunk;
        onToken(chunk);
      }
    }

    const text = accumulated.trim();
    const latencyMs = Date.now() - startTime;

    // finalMessage() resolves after the stream completes with the full
    // message (including usage). Wrapped in a best-effort try/catch so a
    // telemetry-only failure never breaks the response path.
    try {
      const finalMessage = await stream.finalMessage();
      logCacheUsage(requestId, finalMessage.usage, latencyMs);
    } catch {
      /* telemetry only */
    }

    if (!text) {
      throw new Error('Empty streaming response from Claude');
    }

    recordLLMSuccess();
    opIncrement('llm_success');

    if (debugEnabled) {
      console.log('[LoRa::Debug][ClaudeResponder] stream complete', {
        requestId,
        model: MODEL,
        latencyMs,
        outputLength: text.length,
      });
    }

    return text;
  }
}
