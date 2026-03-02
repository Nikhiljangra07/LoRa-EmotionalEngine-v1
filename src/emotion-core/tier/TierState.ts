import * as fs from 'fs';
import * as path from 'path';
import type { RelationalTier } from './RelationalTier';
import type { OnboardingPreferences } from '../onboarding/onboardingQuiz';
import { tierDebugEnabled } from '../debug/debugGate';

export interface TierStateStored {
  userId: string;
  currentTier: RelationalTier;
  sessionCount: number;
  etvTrajectory: number[];
  escalationCount: number;
  lastTransitionAt: number;
  onboardingComplete?: boolean;
  onboardingPreferences?: OnboardingPreferences;
}

const TIER_DIR = path.resolve(process.cwd(), '.lora', 'tier');

function ensureDir(): void {
  if (!fs.existsSync(TIER_DIR)) {
    fs.mkdirSync(TIER_DIR, { recursive: true });
  }
}

function userPath(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(TIER_DIR, `${safe}.json`);
}

export const TierStorage = {
  load(userId: string): TierStateStored | null {
    const fp = userPath(userId);
    if (tierDebugEnabled) console.log('[LoRa::Tier] load', { userId, path: fp });
    try {
      if (!fs.existsSync(fp)) {
        if (tierDebugEnabled) console.log('[LoRa::Tier] load: file not found');
        return null;
      }
      const raw = fs.readFileSync(fp, 'utf-8');
      const parsed = JSON.parse(raw) as TierStateStored;

      if (
        typeof parsed.userId !== 'string' ||
        typeof parsed.sessionCount !== 'number' ||
        !Array.isArray(parsed.etvTrajectory)
      ) {
        return null;
      }

      return {
        ...parsed,
        currentTier: parsed.currentTier ?? 'TIER_1',
        escalationCount: parsed.escalationCount ?? 0,
        lastTransitionAt: parsed.lastTransitionAt ?? Date.now(),
      } as TierStateStored;
    } catch {
      return null;
    }
  },

  save(state: TierStateStored): void {
    ensureDir();
    const fp = userPath(state.userId);
    if (tierDebugEnabled) console.log('[LoRa::Tier] save', { userId: state.userId, path: fp, sessionCount: state.sessionCount, tier: state.currentTier });
    const tmp = fp + '.tmp';
    const data: TierStateStored = {
      userId: state.userId,
      currentTier: state.currentTier,
      sessionCount: state.sessionCount,
      etvTrajectory: state.etvTrajectory,
      escalationCount: state.escalationCount,
      lastTransitionAt: state.lastTransitionAt,
      ...(state.onboardingComplete !== undefined ? { onboardingComplete: state.onboardingComplete } : {}),
      ...(state.onboardingPreferences ? { onboardingPreferences: state.onboardingPreferences } : {}),
    };
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, fp);
  },

  initState(userId: string): TierStateStored {
    return {
      userId,
      currentTier: 'TIER_1',
      sessionCount: 0,
      etvTrajectory: [],
      escalationCount: 0,
      lastTransitionAt: Date.now(),
    };
  },

  /** Merge onboarding into existing tier state; creates state if missing. */
  saveOnboarding(userId: string, preferences: OnboardingPreferences): void {
    const existing = this.load(userId) ?? this.initState(userId);
    const updated: TierStateStored = {
      ...existing,
      onboardingComplete: true,
      onboardingPreferences: preferences,
    };
    this.save(updated);
  },
};
