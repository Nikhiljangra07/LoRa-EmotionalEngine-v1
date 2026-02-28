/**
 * Structural test for the A/B wave harness.
 *
 * Mocks the Anthropic SDK — no API key needed.
 * Verifies:
 *   1. Both runs produce 20 assistant messages.
 *   2. The wave script is exactly 20 turns.
 *   3. Extended diff fields (guidance/escalation/pacing changed, trends) are present.
 *   4. The JSON report contains the full summary structure including early navigation.
 *   5. V2 script loads 20 turns and can be selected via env.
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
            content: [{ type: 'text', text: `Mock wave response #${callCount}` }],
          };
        }),
      };
    },
  };
});

process.env.ANTHROPIC_API_KEY = 'test-key-not-real';

import { runConversation } from '../ab-appraisal-harness';
import type { RunResult } from '../ab-appraisal-harness';
import {
  WAVE_SCRIPT,
  computeWaveDiffs,
  buildWaveReportJSON,
  computeEarlyNavigation,
} from '../ab-wave-harness';
import type { WaveTurnDiff, WaveReport, EarlyNavigation } from '../ab-wave-harness';
import { WAVE_SCRIPT_V1, WAVE_SCRIPT_V2, getWaveScript } from '../waveScripts';

describe('AB Wave Harness', () => {
  let runA: RunResult;
  let runB: RunResult;

  beforeAll(async () => {
    runA = await runConversation('A', true, WAVE_SCRIPT);
    runB = await runConversation('B', false, WAVE_SCRIPT);
  }, 120_000);

  it('wave script has exactly 20 turns', () => {
    expect(WAVE_SCRIPT).toHaveLength(20);
  });

  it('both runs produce exactly 20 assistant messages', () => {
    expect(runA.turns).toHaveLength(20);
    expect(runB.turns).toHaveLength(20);
    for (const t of runA.turns) expect(t.assistantResponse).toBeTruthy();
    for (const t of runB.turns) expect(t.assistantResponse).toBeTruthy();
  });

  it('extended diff entries have wave-specific fields', () => {
    const diffs = computeWaveDiffs(runA, runB);
    expect(diffs).toHaveLength(20);

    for (const d of diffs) {
      expect(d).toHaveProperty('guidanceChanged');
      expect(d).toHaveProperty('escalationChanged');
      expect(d).toHaveProperty('pacingChanged');
      expect(d).toHaveProperty('escalationTrendA');
      expect(d).toHaveProperty('escalationTrendB');
      expect(d).toHaveProperty('guidanceModeChangedFromPrevA');
      expect(d).toHaveProperty('guidanceModeChangedFromPrevB');
      expect(d).toHaveProperty('volatilityTierA');
      expect(d).toHaveProperty('volatilityTierB');
      expect(d).toHaveProperty('questionBudgetChangedA');
      expect(d).toHaveProperty('questionBudgetChangedB');
      expect(d).toHaveProperty('pacingChangedFromPrevA');
      expect(d).toHaveProperty('pacingChangedFromPrevB');
      expect(['UP', 'DOWN', 'FLAT']).toContain(d.escalationTrendA);
      expect(['UP', 'DOWN', 'FLAT']).toContain(d.escalationTrendB);
    }
  });

  it('report JSON has full summary structure including early navigation', () => {
    const diffs = computeWaveDiffs(runA, runB);
    const report: WaveReport = buildWaveReportJSON(runA, runB, diffs);

    expect(report).toHaveProperty('scriptVersion');
    expect(report).toHaveProperty('runA');
    expect(report).toHaveProperty('runB');
    expect(report).toHaveProperty('diffs');
    expect(report.diffs).toHaveLength(20);

    expect(report).toHaveProperty('earlyNavigation');
    const en = report.earlyNavigation;
    expect(en).toHaveProperty('guidanceTransitions');
    expect(en.guidanceTransitions).toHaveProperty('a');
    expect(en.guidanceTransitions).toHaveProperty('b');
    expect(en).toHaveProperty('qBudgetChanges');
    expect(en).toHaveProperty('pacingChanges');
    expect(en).toHaveProperty('firstEscalatedTurnA');
    expect(en).toHaveProperty('earlyNavEngaged');
    expect(typeof en.earlyNavEngaged).toBe('boolean');

    const s = report.summary;
    expect(s).toHaveProperty('responsesChanged');
    expect(s).toHaveProperty('avgFieldsChanged');
    expect(s).toHaveProperty('guidanceTransitions');
    expect(s).toHaveProperty('pacingChanges');
    expect(s).toHaveProperty('escalationTransitions');
    expect(s).toHaveProperty('volatilitySpikes');
    expect(s).toHaveProperty('turnsADeescBEsc');
    expect(s).toHaveProperty('turnsANarrowBBroad');
    expect(s).toHaveProperty('turnsAReducedIntensity');
    expect(s).toHaveProperty('wiringGaps');
    expect(s).toHaveProperty('navigationWeak');
  });

  it('first turn has FLAT escalation trend (no previous turn)', () => {
    const diffs = computeWaveDiffs(runA, runB);
    expect(diffs[0].escalationTrendA).toBe('FLAT');
    expect(diffs[0].escalationTrendB).toBe('FLAT');
    expect(diffs[0].guidanceModeChangedFromPrevA).toBe(false);
    expect(diffs[0].guidanceModeChangedFromPrevB).toBe(false);
  });

  it('early navigation computes over first 8 turns only', () => {
    const diffs = computeWaveDiffs(runA, runB);
    const en = computeEarlyNavigation(runA, diffs);
    expect(typeof en.guidanceTransitions.a).toBe('number');
    expect(typeof en.qBudgetChanges.a).toBe('number');
    expect(typeof en.pacingChanges.a).toBe('number');
    expect(en.firstEscalatedTurnA === null || (en.firstEscalatedTurnA >= 1 && en.firstEscalatedTurnA <= 8)).toBe(true);
  });
});

describe('Wave Scripts', () => {
  it('WAVE_SCRIPT_V1 has exactly 20 turns', () => {
    expect(WAVE_SCRIPT_V1).toHaveLength(20);
  });

  it('WAVE_SCRIPT_V2 has exactly 20 turns', () => {
    expect(WAVE_SCRIPT_V2).toHaveLength(20);
  });

  it('V1 and V2 are different scripts', () => {
    expect(WAVE_SCRIPT_V1).not.toEqual(WAVE_SCRIPT_V2);
  });

  it('getWaveScript("v1") returns V1', () => {
    expect(getWaveScript('v1')).toBe(WAVE_SCRIPT_V1);
  });

  it('getWaveScript("v2") returns V2', () => {
    expect(getWaveScript('v2')).toBe(WAVE_SCRIPT_V2);
  });

  it('getWaveScript defaults to V1 for unknown version', () => {
    expect(getWaveScript('unknown')).toBe(WAVE_SCRIPT_V1);
  });

  it('V2 starts with "I\'m behind again." and ends with "Now."', () => {
    expect(WAVE_SCRIPT_V2[0]).toBe("I'm behind again.");
    expect(WAVE_SCRIPT_V2[19]).toBe('Now.');
  });
});

describe('AB Wave Harness V2 integration', () => {
  let runV2A: RunResult;
  let runV2B: RunResult;

  beforeAll(async () => {
    runV2A = await runConversation('A-v2', true, WAVE_SCRIPT_V2);
    runV2B = await runConversation('B-v2', false, WAVE_SCRIPT_V2);
  }, 120_000);

  it('V2 runs produce exactly 20 assistant messages', () => {
    expect(runV2A.turns).toHaveLength(20);
    expect(runV2B.turns).toHaveLength(20);
    for (const t of runV2A.turns) expect(t.assistantResponse).toBeTruthy();
    for (const t of runV2B.turns) expect(t.assistantResponse).toBeTruthy();
  });

  it('V2 diffs compute correctly', () => {
    const diffs = computeWaveDiffs(runV2A, runV2B);
    expect(diffs).toHaveLength(20);
    for (const d of diffs) {
      expect(typeof d.fieldsChanged).toBe('number');
      expect(typeof d.responseChanged).toBe('boolean');
    }
  });
});
