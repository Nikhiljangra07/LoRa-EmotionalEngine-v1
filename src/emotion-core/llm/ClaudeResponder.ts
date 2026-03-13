import Anthropic from '@anthropic-ai/sdk';
import { recordLLMSuccess } from '../../server/llmTelemetry';
import { debugEnabled } from '../debug/debugGate';
import type { ChatTurn } from '../prompt/PromptTemplateBuilder';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 800;
const TEMPERATURE = 0.6;

export type GenerateResponseOptions = {
  signal?: AbortSignal;
  requestId?: string;
  /** Prior turns (chronological). Current user message is passed separately and appended. */
  sessionHistory?: ChatTurn[];
};

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

    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not set');
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

    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      ...priorTurns.map((t) => ({
        role: t.role as 'user' | 'assistant',
        content: t.text,
      })),
      { role: 'user' as const, content: userMessage },
    ];

    if (debugEnabled) {
      console.log('[LoRa::Debug][ClaudeResponder] role separation', {
        requestId,
        systemPromptLength: systemPrompt.length,
        userMessageLength: userMessage.length,
        priorTurnsCount: priorTurns.length,
      });
    }

    if (process.env.LORA_DEBUG_LLM_PAYLOAD === '1') {
      console.log('[LoRa] LLM PAYLOAD:');
      console.log(JSON.stringify({ system: systemPrompt.slice(0, 200) + '...', messages }, null, 2));
    }

    const response = await this.client.messages.create(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        system: systemPrompt,
        messages,
      },
      options?.signal ? { signal: options.signal } : {}
    );

    const latencyMs = Date.now() - startTime;

    const firstBlock = response.content[0];
    const text =
      firstBlock && firstBlock.type === 'text' ? firstBlock.text.trim() : '';

    if (!text) {
      throw new Error('Empty response from Claude');
    }

    recordLLMSuccess();

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
}
