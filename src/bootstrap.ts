/**
 * Bootstrap: load .env.local (or .env) at process start.
 * Import this ONCE at the top of each entrypoint before any other imports.
 */
import dotenv from 'dotenv';
import path from 'path';

// Prefer .env.local (gitignored), fall back to .env
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// ── Environment invariant guard ──────────────────────────────────────
// Require the API key for the selected LLM provider only.
const provider = (process.env.LLM_PROVIDER || 'anthropic').toLowerCase();
if (provider === 'openai' && !process.env.OPENAI_API_KEY?.trim()) {
  console.error(
    '[LoRa::Fatal] OPENAI_API_KEY is required when LLM_PROVIDER=openai'
  );
  process.exit(1);
}
if (provider === 'anthropic' && !process.env.ANTHROPIC_API_KEY?.trim()) {
  console.error(
    '[LoRa::Fatal] ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic'
  );
  process.exit(1);
}
console.log(`[LoRa] LLM Provider: ${provider}`);
