import OpenAI from 'openai';
import { recordLLMSuccess } from '../../server/llmTelemetry';

const _debug = process.env.LORA_DEBUG === '1';

export interface LLMResponseMeta {
  model: string;
  outputTokens?: number;
  latencyMs: number;
}

export class OpenAIResponder {
  private client: OpenAI;
  private readonly model: string;
  private readonly baseURL: string | undefined;

  constructor() {
    this.model = process.env.OPENAI_MODEL || 'gpt-4o';
    this.baseURL = process.env.OPENAI_BASE_URL || undefined;

    if (_debug) {
      console.log('[LoRa::Debug][OpenAIResponder] config', {
        provider: 'openai',
        model: this.model,
        baseURL: this.baseURL ?? '(default)',
        apiKeyPresent: !!process.env.OPENAI_API_KEY,
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not set');
    }

    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      ...(this.baseURL ? { baseURL: this.baseURL } : {}),
    });
  }

  /**
   * Generate a response from LoRa
   * --------------------------------
   * - Uses GPT-4o (primary emotional model)
   * - Hard caps output tokens (cost safety)
   * - Controlled temperature (no rambling)
   * - Returns clean text only (no chain-of-thought)
   */
  async generateResponse(
    prompt: string,
    options?: { signal?: AbortSignal; requestId?: string }
  ): Promise<string> {
    const startTime = Date.now();
    const requestId = options?.requestId ?? 'unknown';

    const res = await this.client.responses.create(
      {
        model: this.model,

        // 🔒 HARD DISCIPLINE
        max_output_tokens: 400,

        // Emotional but restrained
        temperature: 0.6,

        // Single-turn, no memory bleed
        input: prompt,
      },
      // Pass AbortSignal so timeout actually cancels the HTTP request
      options?.signal ? { signal: options.signal } : {}
    );

    const latencyMs = Date.now() - startTime;

    // Defensive extraction
    const text = res.output_text?.trim();

    if (!text) {
      throw new Error('Empty response from OpenAI');
    }

    // Passive telemetry — record real LLM success (not fallback)
    recordLLMSuccess();

    if (_debug) {
      console.log('[LoRa::Debug][OpenAIResponder] success', {
        requestId,
        model: this.model,
        latencyMs,
        outputLength: text.length,
      });
    }

    return text;
  }
}
