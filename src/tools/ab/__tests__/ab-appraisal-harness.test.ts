/**
 * Minimal structural test for the A/B appraisal harness.
 *
 * Mocks the Anthropic SDK so no API key is needed, then verifies:
 *   1. Both A and B runs produce 10 assistant messages.
 *   2. The only flag difference is appraisal bridge ON vs OFF.
 *   3. The report JSON contains all required fields.
 */

jest.mock('@anthropic-ai/sdk', () => {
  let callCount = 0;
  return {
    __esModule: true,
    default: class MockAnthropic {
      messages = {
        create: jest.fn().mockImplementation(async () => {
          callCount++;
          return {
            content: [
              {
                type: 'text',
                text: `Mock response #${callCount}`,
              },
            ],
          };
        }),
      };
    },
  };
});

process.env.ANTHROPIC_API_KEY = 'test-key-not-real';

import {
  runConversation,
  computeDiffs,
  buildReportJSON,
  SCRIPT,
} from '../ab-appraisal-harness';
import type {
  RunResult,
  TurnResult,
  HarnessReport,
} from '../ab-appraisal-harness';

describe('AB Appraisal Harness', () => {
  let runA: RunResult;
  let runB: RunResult;

  beforeAll(async () => {
    runA = await runConversation('A (Appraisal ON)', true);
    runB = await runConversation('B (Appraisal OFF)', false);
  }, 60_000);

  it('both runs produce exactly 10 assistant messages', () => {
    expect(runA.turns).toHaveLength(10);
    expect(runB.turns).toHaveLength(10);

    for (const t of runA.turns) {
      expect(t.assistantResponse).toBeTruthy();
    }
    for (const t of runB.turns) {
      expect(t.assistantResponse).toBeTruthy();
    }
  });

  it('each turn uses the correct scripted user message', () => {
    for (let i = 0; i < SCRIPT.length; i++) {
      expect(runA.turns[i].userMessage).toBe(SCRIPT[i]);
      expect(runB.turns[i].userMessage).toBe(SCRIPT[i]);
    }
  });

  it('every turn has the required signal fields', () => {
    const checkTurn = (t: TurnResult) => {
      expect(t).toHaveProperty('turn');
      expect(t).toHaveProperty('userMessage');
      expect(t).toHaveProperty('assistantResponse');
      expect(t).toHaveProperty('guidanceMode');
      expect(t).toHaveProperty('ekmanDominant');
      expect(t).toHaveProperty('volatilityState');
      expect(t).toHaveProperty('escalationLevel');
      expect(t).toHaveProperty('hints');
      expect(Array.isArray(t.hints)).toBe(true);
    };

    for (const t of runA.turns) checkTurn(t);
    for (const t of runB.turns) checkTurn(t);
  });

  it('report JSON contains required top-level fields', () => {
    const diffs = computeDiffs(runA, runB);
    const report: HarnessReport = buildReportJSON(runA, runB, diffs);

    expect(report).toHaveProperty('runA');
    expect(report).toHaveProperty('runB');
    expect(report).toHaveProperty('diffs');
    expect(report).toHaveProperty('summary');
    expect(report.diffs).toHaveLength(10);
    expect(report.summary).toHaveProperty('responsesChanged');
    expect(report.summary).toHaveProperty('avgFieldsChanged');
    expect(report.summary).toHaveProperty('wiringGaps');
  });

  it('diff entries have the expected shape', () => {
    const diffs = computeDiffs(runA, runB);
    for (const d of diffs) {
      expect(d).toHaveProperty('turn');
      expect(d).toHaveProperty('fieldsChanged');
      expect(d).toHaveProperty('responseChanged');
      expect(d).toHaveProperty('changedFields');
      expect(d).toHaveProperty('signalWithNoOverlay');
      expect(typeof d.fieldsChanged).toBe('number');
      expect(typeof d.responseChanged).toBe('boolean');
    }
  });
});
