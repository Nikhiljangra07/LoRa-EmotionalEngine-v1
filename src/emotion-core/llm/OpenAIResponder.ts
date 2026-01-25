import OpenAI from 'openai';

export interface LLMResponseMeta {
  model: string;
  outputTokens?: number;
  latencyMs: number;
}

export class OpenAIResponder {
  private client: OpenAI;

  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not set');
    }

    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
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
  async generateResponse(prompt: string): Promise<string> {
    const startTime = Date.now();

    const res = await this.client.responses.create({
      model: 'gpt-4o',

      // 🔒 HARD DISCIPLINE
      max_output_tokens: 400,

      // Emotional but restrained
      temperature: 0.6,

      // Single-turn, no memory bleed
      input: prompt,
    });

    const latencyMs = Date.now() - startTime;

    // Defensive extraction
    const text = res.output_text?.trim();

    if (!text) {
      throw new Error('Empty response from OpenAI');
    }

    // Optional: expose metadata later without breaking API
    // const meta: LLMResponseMeta = {
    //   model: 'gpt-4o',
    //   outputTokens: res.usage?.output_tokens,
    //   latencyMs,
    // };

    return text;
  }
}
