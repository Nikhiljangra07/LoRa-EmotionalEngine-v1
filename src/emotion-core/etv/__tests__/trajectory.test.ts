/**
 * Trajectory observability tests:
 * - Repeated high-z sessions should increase mean.
 * - High volatility sessions decrease z and slow growth.
 * - Log records contain all extended fields.
 */

import { ETVEngineV1, formatTrajectorySnapshot } from '../engine';
import { ETVStorage } from '../storage';
import { toFullState } from '../betaUpdate';
import { computeEvidenceScore } from '../evidenceScore';
import type { SessionSummaryV1 } from '../types';
import * as fs from 'fs';
import * as path from 'path';

const ETV_DIR = path.resolve(process.cwd(), '.lora', 'etv');

function cleanUser(userId: string) {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const fp = path.join(ETV_DIR, `${safe}.json`);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
}

function makeSummary(userId: string, overrides: Partial<SessionSummaryV1> = {}): SessionSummaryV1 {
  return {
    sessionId: `sess-traj-1`,
    userId,
    startedAt: Date.now() - 60_000,
    endedAt: Date.now(),
    messageCount: 10,
    eivMean: 0.4,
    eivMax: 0.6,
    aviMean: 0.05,
    aviMax: 0.1,
    hasViolation: false,
    ...overrides,
  };
}

const USER = 'trajectory_test';

beforeEach(() => cleanUser(USER));
afterAll(() => cleanUser(USER));

describe('trajectory monotonicity', () => {
  test('repeated stable sessions increase mean', () => {
    const means: number[] = [];
    for (let i = 0; i < 10; i++) {
      const { state } = ETVEngineV1.updateFromSession(
        makeSummary(USER, {
          sessionId: `stable-${i}`,
          aviMean: 0.02,
          aviMax: 0.05,
          eivMean: 0.3,
          hasViolation: false,
          endedAt: Date.now() + i * 1000,
        }),
      );
      means.push(state.etvMean);
    }
    expect(means[9]).toBeGreaterThan(means[0]);
    // Each step should be non-decreasing (monotonic for consistently positive evidence)
    for (let i = 1; i < means.length; i++) {
      expect(means[i]).toBeGreaterThanOrEqual(means[i - 1] - 0.001);
    }
  });

  test('high volatility sessions produce lower z_t and slower trust growth', () => {
    cleanUser(USER);
    const stableMeans: number[] = [];
    for (let i = 0; i < 5; i++) {
      const { state } = ETVEngineV1.updateFromSession(
        makeSummary(USER, {
          sessionId: `s-${i}`,
          aviMean: 0.02,
          aviMax: 0.05,
          endedAt: Date.now() + i * 1000,
        }),
      );
      stableMeans.push(state.etvMean);
    }

    cleanUser(USER);
    const volatileMeans: number[] = [];
    for (let i = 0; i < 5; i++) {
      const { state } = ETVEngineV1.updateFromSession(
        makeSummary(USER, {
          sessionId: `v-${i}`,
          aviMean: 0.7,
          aviMax: 0.9,
          endedAt: Date.now() + i * 1000,
        }),
      );
      volatileMeans.push(state.etvMean);
    }

    // Stable sessions should reach higher mean after 5 rounds
    expect(stableMeans[4]).toBeGreaterThan(volatileMeans[4]);
  });
});

describe('ETVUpdateLog extended fields', () => {
  test('log contains effectiveN, riskAdjusted, conf, messageCount, eivMean, aviMean', () => {
    const { log } = ETVEngineV1.updateFromSession(makeSummary(USER));

    expect(typeof log.effectiveN).toBe('number');
    expect(log.effectiveN).toBeGreaterThan(0);

    expect(typeof log.riskAdjusted).toBe('number');
    expect(log.riskAdjusted).toBeGreaterThanOrEqual(0);
    expect(log.riskAdjusted).toBeLessThanOrEqual(1);

    expect(typeof log.conf).toBe('number');
    expect(log.conf).toBeGreaterThanOrEqual(0);
    expect(log.conf).toBeLessThanOrEqual(1);

    expect(log.messageCount).toBe(10);
    expect(log.eivMean).toBeCloseTo(0.4, 6);
    expect(log.aviMean).toBeCloseTo(0.05, 6);
  });
});

describe('formatTrajectorySnapshot', () => {
  test('returns correct shape with all fields', () => {
    const summary = makeSummary(USER);
    const z = computeEvidenceScore(summary);

    ETVEngineV1.updateFromSession(summary);
    const stored = ETVStorage.load(USER)!;
    const full = toFullState(stored);

    const snapshot = formatTrajectorySnapshot(full, summary, z);

    expect(snapshot.userId).toBe(USER);
    expect(snapshot.sessionId).toBe(summary.sessionId);
    expect(typeof snapshot.mean).toBe('number');
    expect(typeof snapshot.variance).toBe('number');
    expect(typeof snapshot.effectiveN).toBe('number');
    expect(typeof snapshot.riskAdjusted).toBe('number');
    expect(typeof snapshot.conf).toBe('number');
    expect(typeof snapshot.band).toBe('string');
    expect(snapshot.z).toBe(z);
    expect(snapshot.messageCount).toBe(10);
    expect(snapshot.eivMean).toBeCloseTo(0.4, 6);
    expect(snapshot.aviMean).toBeCloseTo(0.05, 6);
  });
});
