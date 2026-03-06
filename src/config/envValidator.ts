/**
 * Validates required LoRa environment variables at startup.
 * Fails loudly with clear instructions instead of silently disabling /api/chat.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

const REQUIRED = ['LORA_FALKOR_URL', 'LORA_CHROMA_URL'] as const;

function loadEnv(): void {
  const cwd = process.cwd();
  dotenv.config({ path: path.join(cwd, '.env.local') });
  dotenv.config({ path: path.join(cwd, '.env') });
}

/**
 * Validates that LORA_FALKOR_URL and LORA_CHROMA_URL are set.
 * Loads .env.local and .env, then checks. Throws if any required variable is missing.
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
    const message =
      'LoRa startup failed: missing LORA_FALKOR_URL or LORA_CHROMA_URL. ' +
      'Ensure Docker services are running and .env.local is configured.';
    throw new Error(message);
  }
}

export default validateEnv;
