/**
 * JSON file-based persistence for bootstrap memory state.
 * Files stored at: {baseDir}/{userId}.json
 * Atomic writes via rename. TTL-based stale purge.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { BootstrapMemoryState, BootstrapStorage } from './bootstrapMemory';
import { BOOTSTRAP_TTL_MS } from './bootstrapMemory';

export interface BootstrapStorageOptions {
  baseDir: string;
  ttlMs?: number;
}

function sanitizeUserId(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
}

export function createBootstrapFileStorage(opts: BootstrapStorageOptions): BootstrapStorage {
  const { baseDir, ttlMs = BOOTSTRAP_TTL_MS } = opts;

  function filePath(userId: string): string {
    return path.join(baseDir, `${sanitizeUserId(userId)}.json`);
  }

  function ensureDir(): void {
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }
  }

  return {
    load(userId: string): BootstrapMemoryState | null {
      const fp = filePath(userId);
      try {
        if (!fs.existsSync(fp)) return null;
        const raw = fs.readFileSync(fp, 'utf-8');
        const parsed = JSON.parse(raw) as BootstrapMemoryState;

        if (parsed.version !== 1) return null;

        if (ttlMs > 0 && Date.now() - parsed.lastUpdatedAt > ttlMs) {
          try { fs.unlinkSync(fp); } catch { /* best-effort cleanup */ }
          return null;
        }

        return parsed;
      } catch {
        return null;
      }
    },

    save(state: BootstrapMemoryState): void {
      ensureDir();
      const fp = filePath(state.userId);
      const tmpFp = fp + '.tmp';
      try {
        fs.writeFileSync(tmpFp, JSON.stringify(state, null, 2), 'utf-8');
        fs.renameSync(tmpFp, fp);
      } catch {
        try { fs.unlinkSync(tmpFp); } catch { /* ignore cleanup failure */ }
      }
    },

    purge(userId: string): void {
      const fp = filePath(userId);
      try {
        if (fs.existsSync(fp)) {
          fs.unlinkSync(fp);
        }
      } catch { /* best-effort */ }
    },

    exists(userId: string): boolean {
      return fs.existsSync(filePath(userId));
    },
  };
}

/**
 * In-memory storage adapter for testing. No filesystem access.
 */
export function createInMemoryBootstrapStorage(): BootstrapStorage & { _store: Map<string, BootstrapMemoryState> } {
  const store = new Map<string, BootstrapMemoryState>();
  return {
    _store: store,
    load(userId) {
      return store.get(userId) ?? null;
    },
    save(state) {
      store.set(state.userId, JSON.parse(JSON.stringify(state)));
    },
    purge(userId) {
      store.delete(userId);
    },
    exists(userId) {
      return store.has(userId);
    },
  };
}
