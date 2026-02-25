import { ETVEngineV1 } from '../engine';
import { ETVStorage } from '../storage';
import { SHORT_SESSION, ETV_CONFIG } from '../constants';
import type { SessionSummaryV1 } from '../types';
import * as fs from 'fs';
import * as path from 'path';

const ETV_DIR = path.resolve(process.cwd(), '.lora', 'etv');

function cleanStorage() {
  const fp = path.join(ETV_DIR, 'short_session_test.json');
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
}

function makeSummary(
  overrides: Partial<SessionSummaryV1> = {},
): SessionSummaryV1 {
  return {
    sessionId: 'sess-short',
    userId: 'short_session_test',
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

describe('short-session bias correction', () => {
  test('short session (messageCount < minMessages) uses reduced mass', () => {
    const { log } = ETVEngineV1.updateFromSession(
      makeSummary({ messageCount: 2 }),
    );
    expect(log.evidenceMass).toBe(SHORT_SESSION.reducedMass);
  });

  test('normal session (messageCount >= minMessages) uses full mass', () => {
    const { log } = ETVEngineV1.updateFromSession(
      makeSummary({ messageCount: 10 }),
    );
    expect(log.evidenceMass).toBe(ETV_CONFIG.evidenceMass);
  });

  test('boundary: messageCount = minMessages - 1 → reduced mass', () => {
    const { log } = ETVEngineV1.updateFromSession(
      makeSummary({ messageCount: SHORT_SESSION.minMessages - 1 }),
    );
    expect(log.evidenceMass).toBe(SHORT_SESSION.reducedMass);
  });

  test('boundary: messageCount = minMessages → full mass', () => {
    const { log } = ETVEngineV1.updateFromSession(
      makeSummary({ messageCount: SHORT_SESSION.minMessages }),
    );
    expect(log.evidenceMass).toBe(ETV_CONFIG.evidenceMass);
  });

  test('short sessions move counts less than full sessions', () => {
    cleanStorage();
    const { state: stateShort } = ETVEngineV1.updateFromSession(
      makeSummary({ messageCount: 1, sessionId: 's1' }),
    );
    const deltaShort = Math.abs(stateShort.r - ETV_CONFIG.initR) +
      Math.abs(stateShort.s - ETV_CONFIG.initS);

    cleanStorage();
    const { state: stateFull } = ETVEngineV1.updateFromSession(
      makeSummary({ messageCount: 10, sessionId: 's2' }),
    );
    const deltaFull = Math.abs(stateFull.r - ETV_CONFIG.initR) +
      Math.abs(stateFull.s - ETV_CONFIG.initS);

    expect(deltaShort).toBeLessThan(deltaFull);
  });

  test('repeated short sessions converge slower than full sessions', () => {
    cleanStorage();
    for (let i = 0; i < 5; i++) {
      ETVEngineV1.updateFromSession(
        makeSummary({ messageCount: 1, sessionId: `short-${i}`, endedAt: Date.now() + i * 1000 }),
      );
    }
    const shortFinal = ETVStorage.load('short_session_test')!;

    cleanStorage();
    for (let i = 0; i < 5; i++) {
      ETVEngineV1.updateFromSession(
        makeSummary({ messageCount: 10, sessionId: `full-${i}`, endedAt: Date.now() + i * 1000 }),
      );
    }
    const fullFinal = ETVStorage.load('short_session_test')!;

    const shortN = shortFinal.r + shortFinal.s;
    const fullN = fullFinal.r + fullFinal.s;
    expect(shortN).toBeLessThan(fullN);
  });
});
