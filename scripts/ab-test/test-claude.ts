/**
 * A/B Test Lab — Claude 3.5 Sonnet
 *
 * Same systemPrompt, userMessage, temperature (0.6) as GPT-4o run.
 * Diagnostic only. Does not modify EngineOrchestrator or production paths.
 */

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import Anthropic from '@anthropic-ai/sdk';
import { generateSystemPrompt } from './generateSystemPrompt';

const userMessage =
  'I messed something important up at work and my chest feels tight.';

async function run() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set. Set it in .env.local or .env');
    process.exit(1);
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const systemPrompt = generateSystemPrompt(userMessage);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    temperature: 0.6,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const firstBlock = response.content[0];
  const text =
    firstBlock && firstBlock.type === 'text' ? firstBlock.text : '';
  console.log('=== Claude 4-6 Sonnet ===');
  console.log(text.trim() || '(no text content)');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
