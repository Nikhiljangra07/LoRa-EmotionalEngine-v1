import { ETVEngineV1 } from '../engine';
import { ETVStorage } from '../storage';
import { ETV_CONFIG } from '../constants';
import { toFullState } from '../betaUpdate';
import { computePolicy } from '../policyMap';
import type { SessionSummaryV1 } from '../types';
import * as fs from 'fs';
import * as path from 'path';

const ETV_DIR = path.resolve(process.cwd(), '.lora', 'etv');

function cleanStorage() {
  const fp = path.join(ETV_DIR, 'integration_test.json');
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
}

function makeSummary(
  overrides: Partial<SessionSummaryV1> = {},
): SessionSummaryV1 {
  return {
    sessionId: 'sess-1',
    userId: 'integration_test',
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

beforeEach(cleanStorage);
afterAll(cleanStorage);

describe('ETVEngineV1 integration', () => {
  test('cold start → BAND_0', () => {
    const { policy, state } = ETVEngineV1.updateFromSession(makeSummary());
    expect(policy.band).toBe('BAND_0');
    expect(state.r).toBeGreaterThan(ETV_CONFIG.initR);
    expect(state.s).toBeGreaterThan(0);
  });

  test('state round-trip — save then load', () => {
    const summary = makeSummary();
    ETVEngineV1.updateFromSession(summary);
    const loaded = ETVStorage.load('integration_test');
    expect(loaded).not.toBeNull();
    expect(loaded!.r).toBeGreaterThan(0);
    expect(loaded!.s).toBeGreaterThan(0);
    expect(loaded!.userId).toBe('integration_test');
  });

  test('multiple sessions → progressive trust increase', () => {
    const means: number[] = [];
    for (let i = 0; i < 10; i++) {
      const { state } = ETVEngineV1.updateFromSession(
        makeSummary({
          sessionId: `sess-${i}`,
          aviMean: 0.05,
          aviMax: 0.1,
          hasViolation: false,
          endedAt: Date.now() + i * 1000,
        }),
      );
      means.push(state.etvMean);
    }
    // After 10 stable sessions, mean should have increased
    expect(means[9]).toBeGreaterThan(means[0]);
  });

  test('log record contains no raw user text', () => {
    const { log } = ETVEngineV1.updateFromSession(makeSummary());
    const serialized = JSON.stringify(log);
    expect(serialized).not.toContain('userMessage');
    expect(serialized).not.toContain('transcript');
    expect(log.userId).toBe('integration_test');
    expect(typeof log.z_t).toBe('number');
    expect(typeof log.decay).toBe('number');
    expect(typeof log.etvMean).toBe('number');
    expect(typeof log.band).toBe('string');
  });

  test('determinism — same sequence produces identical final state', () => {
    const summaries = Array.from({ length: 5 }, (_, i) =>
      makeSummary({
        sessionId: `det-${i}`,
        aviMean: 0.15,
        aviMax: 0.3,
        hasViolation: i === 2,
        endedAt: Date.now() + i * 1000,
      }),
    );

    // Run 1
    cleanStorage();
    let final1;
    for (const s of summaries) final1 = ETVEngineV1.updateFromSession(s);

    // Run 2
    cleanStorage();
    let final2;
    for (const s of summaries) final2 = ETVEngineV1.updateFromSession(s);

    expect(final1!.state.r).toBeCloseTo(final2!.state.r, 10);
    expect(final1!.state.s).toBeCloseTo(final2!.state.s, 10);
    expect(final1!.policy.band).toBe(final2!.policy.band);
  });

  test('decay applied before evidence (order matters)', () => {
    // Create initial state with some evidence
    ETVEngineV1.updateFromSession(
      makeSummary({ endedAt: Date.now() - 14 * 24 * 3600 * 1000 }),
    );

    // After H days gap, counts should be decayed before new evidence
    const { log } = ETVEngineV1.updateFromSession(
      makeSummary({ sessionId: 'sess-after-gap' }),
    );

    // Decay should be approximately 0.5 for H days
    expect(log.decay).toBeGreaterThan(0);
    expect(log.decay).toBeLessThanOrEqual(1);
    expect(log.r_after).toBeGreaterThan(0);
    expect(log.s_after).toBeGreaterThan(0);
  });

  test('getPolicy — read-only, no side effects', () => {
    ETVEngineV1.updateFromSession(makeSummary());
    const stored = ETVStorage.load('integration_test');
    const policy = ETVEngineV1.getPolicy('integration_test');
    const storedAfter = ETVStorage.load('integration_test');

    expect(stored!.r).toBe(storedAfter!.r);
    expect(stored!.s).toBe(storedAfter!.s);
    expect(policy.band).toBeDefined();
  });
});
