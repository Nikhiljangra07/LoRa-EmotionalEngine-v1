/**
 * Validates required LoRa environment variables at startup.
 * Fails loudly with clear instructions instead of silently disabling /api/chat.
 * Only variable names are logged; secret values are never logged.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

/** Required at server startup; missing any causes exit(1). */
const REQUIRED = ['ANTHROPIC_API_KEY', 'CHROMA_HOST', 'FALKOR_HOST'] as const;

function loadEnv(): void {
  const cwd = process.cwd();
  dotenv.config({ path: path.join(cwd, '.env.local') });
  dotenv.config({ path: path.join(cwd, '.env') });
}

/**
 * Validates that all required env vars are set (non-empty).
 * Loads .env.local and .env, then checks. Logs each missing variable by name only, then throws.
 */
export function validateEnv(): void {
  loadEnv();

  const missing: string[] = [];
  for (const key of REQUIRED) {
    const val = process.env[key];
    if (!val || typeof val !== 'string' || !val.trim()) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    for (const name of missing) {
      console.error('[LoRa::ENV_CHECK] Missing required environment variable:', name);
    }
    console.error('Server exiting.');
    throw new Error('Server exiting.');
  }
}

export default validateEnv;
