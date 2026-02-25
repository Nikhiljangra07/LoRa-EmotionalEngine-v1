/**
 * Identity isolation tests:
 * - userA and userB must not share stored state.
 * - Updating A must not modify B's file.
 */

import { ETVEngineV1 } from '../engine';
import { ETVStorage } from '../storage';
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
    sessionId: `sess-${userId}-1`,
    userId,
    startedAt: Date.now() - 60_000,
    endedAt: Date.now(),
    messageCount: 10,
    eivMean: 0.5,
    eivMax: 0.7,
    aviMean: 0.1,
    aviMax: 0.2,
    hasViolation: false,
    ...overrides,
  };
}

const USER_A = 'identity_test_alice';
const USER_B = 'identity_test_bob';

beforeEach(() => { cleanUser(USER_A); cleanUser(USER_B); });
afterAll(() => { cleanUser(USER_A); cleanUser(USER_B); });

describe('ETV identity isolation', () => {
  test('two users produce separate storage files', () => {
    ETVEngineV1.updateFromSession(makeSummary(USER_A));
    ETVEngineV1.updateFromSession(makeSummary(USER_B));

    const aPath = path.join(ETV_DIR, `${USER_A}.json`);
    const bPath = path.join(ETV_DIR, `${USER_B}.json`);

    expect(fs.existsSync(aPath)).toBe(true);
    expect(fs.existsSync(bPath)).toBe(true);
  });

  test('updating user A does not modify user B state', () => {
    ETVEngineV1.updateFromSession(makeSummary(USER_A));
    ETVEngineV1.updateFromSession(makeSummary(USER_B));

    const bBefore = ETVStorage.load(USER_B)!;

    // Run 5 more updates for A only
    for (let i = 0; i < 5; i++) {
      ETVEngineV1.updateFromSession(
        makeSummary(USER_A, { sessionId: `sess-a-${i}`, endedAt: Date.now() + i * 1000 }),
      );
    }

    const bAfter = ETVStorage.load(USER_B)!;
    expect(bAfter.r).toBe(bBefore.r);
    expect(bAfter.s).toBe(bBefore.s);
    expect(bAfter.updatedAt).toBe(bBefore.updatedAt);
  });

  test('states evolve independently with different evidence', () => {
    // A gets all stable sessions, B gets volatile + violation sessions
    for (let i = 0; i < 5; i++) {
      ETVEngineV1.updateFromSession(
        makeSummary(USER_A, {
          sessionId: `stable-${i}`,
          aviMean: 0.02,
          aviMax: 0.05,
          hasViolation: false,
          endedAt: Date.now() + i * 1000,
        }),
      );
      ETVEngineV1.updateFromSession(
        makeSummary(USER_B, {
          sessionId: `volatile-${i}`,
          aviMean: 0.8,
          aviMax: 0.95,
          hasViolation: i === 2,
          endedAt: Date.now() + i * 1000,
        }),
      );
    }

    const aState = ETVStorage.load(USER_A)!;
    const bState = ETVStorage.load(USER_B)!;

    const aMean = aState.r / (aState.r + aState.s);
    const bMean = bState.r / (bState.r + bState.s);

    expect(aMean).toBeGreaterThan(bMean);
  });
});
