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
// The server MUST have an OpenAI API key to function.
// Fail fast with a clear message rather than crashing later at runtime.
if (!process.env.OPENAI_API_KEY) {
  console.error(
    '[LoRa::Fatal] OPENAI_API_KEY is missing or empty. Server cannot start.'
  );
  process.exit(1);
}
