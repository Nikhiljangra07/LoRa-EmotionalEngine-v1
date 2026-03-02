import * as fs from 'fs';
import * as path from 'path';
import { TierStorage, type TierStateStored } from '../TierState';

const TIER_DIR = path.resolve(process.cwd(), '.lora', 'tier');

function cleanup(userId: string): void {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const fp = path.join(TIER_DIR, `${safe}.json`);
  try { fs.unlinkSync(fp); } catch { /* noop */ }
  try { fs.unlinkSync(fp + '.tmp'); } catch { /* noop */ }
}

describe('TierStorage', () => {
  const testUser = '__tier_test_user__';

  afterEach(() => cleanup(testUser));

  it('initState returns TIER_1 defaults', () => {
    const state = TierStorage.initState(testUser);
    expect(state.userId).toBe(testUser);
    expect(state.currentTier).toBe('TIER_1');
    expect(state.sessionCount).toBe(0);
    expect(state.etvTrajectory).toEqual([]);
    expect(state.escalationCount).toBe(0);
    expect(typeof state.lastTransitionAt).toBe('number');
  });

  it('load returns null when no file exists', () => {
    cleanup(testUser);
    expect(TierStorage.load(testUser)).toBeNull();
  });

  it('save + load round-trips correctly', () => {
    const state: TierStateStored = {
      userId: testUser,
      currentTier: 'TIER_2',
      sessionCount: 3,
      etvTrajectory: [0.3, 0.4, 0.5],
      escalationCount: 1,
      lastTransitionAt: 1000000,
    };
    TierStorage.save(state);

    const loaded = TierStorage.load(testUser);
    expect(loaded).not.toBeNull();
    expect(loaded!.userId).toBe(testUser);
    expect(loaded!.currentTier).toBe('TIER_2');
    expect(loaded!.sessionCount).toBe(3);
    expect(loaded!.etvTrajectory).toEqual([0.3, 0.4, 0.5]);
    expect(loaded!.escalationCount).toBe(1);
    expect(loaded!.lastTransitionAt).toBe(1000000);
  });

  it('saveOnboarding merges onboarding into state', () => {
    cleanup(testUser);
    TierStorage.saveOnboarding(testUser, {
      name: 'TestUser',
      preferredTone: 'direct',
      goalOrientation: 'growth',
    });
    const loaded = TierStorage.load(testUser);
    expect(loaded).not.toBeNull();
    expect(loaded!.onboardingComplete).toBe(true);
    expect(loaded!.onboardingPreferences).toEqual({
      name: 'TestUser',
      preferredTone: 'direct',
      goalOrientation: 'growth',
    });
  });

  it('load returns null for corrupted JSON', () => {
    const safe = testUser.replace(/[^a-zA-Z0-9_-]/g, '_');
    const fp = path.join(TIER_DIR, `${safe}.json`);
    if (!fs.existsSync(TIER_DIR)) {
      fs.mkdirSync(TIER_DIR, { recursive: true });
    }
    fs.writeFileSync(fp, '{{invalid json}}', 'utf-8');
    expect(TierStorage.load(testUser)).toBeNull();
  });
});
