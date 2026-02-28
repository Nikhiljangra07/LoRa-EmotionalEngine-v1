/**
 * A/B Test Lab — GPT-4o
 *
 * Same systemPrompt, userMessage, temperature (0.6) as production.
 * Diagnostic only. Does not modify EngineOrchestrator or production paths.
 */

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import OpenAI from 'openai';
import { generateSystemPrompt } from './generateSystemPrompt';

const userMessage =
  'I messed something important up at work and my chest feels tight.';

async function run() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY is not set. Set it in .env.local or .env');
    process.exit(1);
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const systemPrompt = generateSystemPrompt(userMessage);

  const response = await client.responses.create({
    model: 'gpt-4o',
    max_output_tokens: 400,
    temperature: 0.6,
    input: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  });

  const text = (response as { output_text?: string }).output_text ?? '';
  console.log('=== GPT-4o ===');
  console.log(text.trim() || '(no output_text)');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
