// src/emotion-core/etv/storage.ts

import * as fs from 'fs';
import * as path from 'path';
import type { ETVStateStored } from './types';
import { ETV_CONFIG } from './constants';

const ETV_DIR = path.resolve(process.cwd(), '.lora', 'etv');

function ensureDir(): void {
  if (!fs.existsSync(ETV_DIR)) {
    fs.mkdirSync(ETV_DIR, { recursive: true });
  }
}

function userPath(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(ETV_DIR, `${safe}.json`);
}

/**
 * Thin JSON-file adapter for ETV state persistence.
 *
 * Interface is designed to be swappable when the leaky memory
 * architecture provides its own persistence layer.
 */
export class ETVStorage {
  static load(userId: string): ETVStateStored | null {
    const fp = userPath(userId);
    try {
      if (!fs.existsSync(fp)) return null;
      const raw = fs.readFileSync(fp, 'utf-8');
      const parsed = JSON.parse(raw) as ETVStateStored;

      if (
        typeof parsed.r !== 'number' ||
        typeof parsed.s !== 'number' ||
        parsed.r <= 0 ||
        parsed.s <= 0
      ) {
        return null;
      }

      return parsed;
    } catch {
      return null;
    }
  }

  static save(state: ETVStateStored): void {
    ensureDir();
    const fp = userPath(state.userId);
    const tmp = fp + '.tmp';
    const data: ETVStateStored = {
      userId: state.userId,
      r: state.r,
      s: state.s,
      lastSessionEndedAt: state.lastSessionEndedAt,
      updatedAt: state.updatedAt,
    };
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, fp);
  }

  static initState(userId: string): ETVStateStored {
    const now = Date.now();
    return {
      userId,
      r: ETV_CONFIG.initR,
      s: ETV_CONFIG.initS,
      lastSessionEndedAt: now,
      updatedAt: now,
    };
  }
}
