import Anthropic from '@anthropic-ai/sdk';
import { recordLLMSuccess } from '../../server/llmTelemetry';
import { debugEnabled } from '../debug/debugGate';

export interface AnthropicResponderOptions {
  apiKey?: string;
}

/**
 * LLM responder that uses Anthropic Messages API. Satisfies the same
 * generateResponse(prompt, options?) contract as OpenAIResponder.
 */
export class AnthropicResponder {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(options?: AnthropicResponderOptions) {
    const apiKey = options?.apiKey ?? process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic');
    }
    this.client = new Anthropic({ apiKey });
    this.model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

    if (debugEnabled) {
      console.log('[LoRa::Debug][AnthropicResponder] config', {
        provider: 'anthropic',
        model: this.model,
        apiKeyPresent: true,
      });
    }
  }

  async generateResponse(
    prompt: string,
    options?: { signal?: AbortSignal; requestId?: string }
  ): Promise<string> {
    const startTime = Date.now();
    const requestId = options?.requestId ?? 'unknown';

    const message = await this.client.messages.create(
      {
        max_tokens: 400,
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.6,
      },
      options?.signal ? { signal: options.signal } : {}
    );

    const latencyMs = Date.now() - startTime;

    const content = message.content ?? [];
    let text = '';
    for (const block of content) {
      if (block.type === 'text' && 'text' in block) {
        text += (block as { text: string }).text;
      }
    }
    text = text.trim();

    if (!text) {
      throw new Error('Empty response from Anthropic');
    }

    recordLLMSuccess();

    if (debugEnabled) {
      console.log('[LoRa::Debug][AnthropicResponder] success', {
        requestId,
        model: this.model,
        latencyMs,
        outputLength: text.length,
      });
    }

    return text;
  }
}
