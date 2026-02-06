/**
 * Bootstrap: load .env.local (or .env) at process start.
 * Import this ONCE at the top of each entrypoint before any other imports.
 */
import dotenv from 'dotenv';
import path from 'path';

// Prefer .env.local (gitignored), fall back to .env
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
