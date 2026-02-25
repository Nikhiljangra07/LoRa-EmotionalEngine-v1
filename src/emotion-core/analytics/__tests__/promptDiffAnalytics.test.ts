// src/emotion-core/analytics/__tests__/promptDiffAnalytics.test.ts

import {
  analyzePromptDiffs,
  renderReport,
  DRIFT_THRESHOLDS,
  type PromptDiffAnalyticsReport,
} from '../promptDiffAnalytics';
import type { PromptProfileDiffPayload } from '../../logging/DecisionLogger';

function makePayload(overrides: Partial<PromptProfileDiffPayload> = {}): PromptProfileDiffPayload {
  return {
    messageId: 'msg-1',
    userId: 'user-a',
    oldRelationshipStyle: 'Professional — polite, calm, and respectful',
    newRelationshipStyle: 'Friendly — warm, open, and conversational',
    band: 'BAND_2',
    maxInitiative: 0.50,
    maxDepth: 0.55,
    assertiveness: 0.40,
    clarificationBias: 0.40,
    maxResponseTokens: 320,
    promptSignature: 'BAND_2:FRIENDLY:init=MOD:depth=MOD:assert=BALANCED:pers=MOD:clar=MOD:len=MEDIUM',
    ...overrides,
  };
}

describe('analyzePromptDiffs — aggregation', () => {
  it('returns correct totalPayloads', () => {
    const report = analyzePromptDiffs([makePayload(), makePayload(), makePayload()]);
    expect(report.totalPayloads).toBe(3);
  });

  it('counts by signature', () => {
    const report = analyzePromptDiffs([
      makePayload({ promptSignature: 'SIG_A' }),
      makePayload({ promptSignature: 'SIG_A' }),
      makePayload({ promptSignature: 'SIG_B' }),
    ]);
    expect(report.countsBySignature['SIG_A']).toBe(2);
    expect(report.countsBySignature['SIG_B']).toBe(1);
  });

  it('counts by band', () => {
    const report = analyzePromptDiffs([
      makePayload({ band: 'BAND_0' }),
      makePayload({ band: 'BAND_0' }),
      makePayload({ band: 'BAND_2' }),
    ]);
    expect(report.countsByBand['BAND_0']).toBe(2);
    expect(report.countsByBand['BAND_2']).toBe(1);
  });

  it('computes transitions from old→new style tokens', () => {
    const report = analyzePromptDiffs([
      makePayload({
        oldRelationshipStyle: 'Professional — polite',
        newRelationshipStyle: 'Friendly — warm',
      }),
      makePayload({
        oldRelationshipStyle: 'Professional — polite',
        newRelationshipStyle: 'Friendly — warm',
      }),
    ]);
    expect(report.topTransitions).toHaveLength(1);
    expect(report.topTransitions[0]).toEqual({ from: 'PROFESSIONAL', to: 'FRIENDLY', count: 2 });
  });

  it('populates perUser stats', () => {
    const report = analyzePromptDiffs([
      makePayload({ userId: 'u1' }),
      makePayload({ userId: 'u1' }),
      makePayload({ userId: 'u2' }),
    ]);
    expect(report.perUser['u1'].totalDiffs).toBe(2);
    expect(report.perUser['u2'].totalDiffs).toBe(1);
  });

  it('handles empty input', () => {
    const report = analyzePromptDiffs([]);
    expect(report.totalPayloads).toBe(0);
    expect(report.flags).toHaveLength(0);
    expect(report.topTransitions).toHaveLength(0);
  });

  it('handles missing promptSignature gracefully', () => {
    const p = makePayload();
    delete (p as any).promptSignature;
    const report = analyzePromptDiffs([p]);
    expect(report.countsBySignature['UNKNOWN']).toBe(1);
  });
});

describe('analyzePromptDiffs — deterministic ordering', () => {
  it('countsBySignature sorted by count desc, then name asc', () => {
    const report = analyzePromptDiffs([
      makePayload({ promptSignature: 'ZZZ' }),
      makePayload({ promptSignature: 'AAA' }),
      makePayload({ promptSignature: 'AAA' }),
      makePayload({ promptSignature: 'MMM' }),
    ]);
    const keys = Object.keys(report.countsBySignature);
    expect(keys).toEqual(['AAA', 'MMM', 'ZZZ']);
  });

  it('topTransitions sorted by count desc, then from asc', () => {
    const report = analyzePromptDiffs([
      makePayload({ oldRelationshipStyle: 'Friendly', newRelationshipStyle: 'Professional' }),
      makePayload({ oldRelationshipStyle: 'Professional', newRelationshipStyle: 'Friendly' }),
      makePayload({ oldRelationshipStyle: 'Professional', newRelationshipStyle: 'Friendly' }),
    ]);
    expect(report.topTransitions[0].from).toBe('PROFESSIONAL');
    expect(report.topTransitions[0].count).toBe(2);
    expect(report.topTransitions[1].from).toBe('FRIENDLY');
    expect(report.topTransitions[1].count).toBe(1);
  });
});

describe('analyzePromptDiffs — drift flag rules', () => {
  describe('STYLE_OUTSIDE_ALLOWED', () => {
    it('flags HIGH when newRelationshipStyle contains CASUAL', () => {
      const report = analyzePromptDiffs([
        makePayload({ newRelationshipStyle: 'Casual — relaxed' }),
      ]);
      const flag = report.flags.find(f => f.code === 'STYLE_OUTSIDE_ALLOWED');
      expect(flag).toBeDefined();
      expect(flag!.severity).toBe('HIGH');
    });

    it('does not flag PROFESSIONAL or FRIENDLY', () => {
      const report = analyzePromptDiffs([
        makePayload({ newRelationshipStyle: 'Professional — polite' }),
        makePayload({ newRelationshipStyle: 'Friendly — warm' }),
      ]);
      expect(report.flags.filter(f => f.code === 'STYLE_OUTSIDE_ALLOWED')).toHaveLength(0);
    });

    it('flags unknown styles', () => {
      const report = analyzePromptDiffs([
        makePayload({ newRelationshipStyle: 'Intimate — deeply bonded' }),
      ]);
      const flag = report.flags.find(f => f.code === 'STYLE_OUTSIDE_ALLOWED');
      expect(flag).toBeDefined();
      expect(flag!.severity).toBe('HIGH');
    });
  });

  describe('SIGNATURE_FORBIDDEN_TOKEN', () => {
    it('flags HIGH when signature contains CASUAL', () => {
      const report = analyzePromptDiffs([
        makePayload({ promptSignature: 'BAND_4:CASUAL:init=STD:depth=FULL' }),
      ]);
      const flag = report.flags.find(f => f.code === 'SIGNATURE_FORBIDDEN_TOKEN');
      expect(flag).toBeDefined();
      expect(flag!.severity).toBe('HIGH');
    });

    it('does not flag clean signatures', () => {
      const report = analyzePromptDiffs([
        makePayload({ promptSignature: 'BAND_2:FRIENDLY:init=MOD:depth=MOD' }),
      ]);
      expect(report.flags.filter(f => f.code === 'SIGNATURE_FORBIDDEN_TOKEN')).toHaveLength(0);
    });
  });

  describe('BAND_JUMP_TOO_LARGE', () => {
    it('flags MED when same user jumps > 2 bands', () => {
      const report = analyzePromptDiffs([
        makePayload({ userId: 'u1', band: 'BAND_0', messageId: 'msg-1' }),
        makePayload({ userId: 'u1', band: 'BAND_4', messageId: 'msg-2' }),
      ]);
      const flag = report.flags.find(f => f.code === 'BAND_JUMP_TOO_LARGE');
      expect(flag).toBeDefined();
      expect(flag!.severity).toBe('MED');
      expect(flag!.detail).toContain('delta=4');
    });

    it('does not flag jump of exactly 2', () => {
      const report = analyzePromptDiffs([
        makePayload({ userId: 'u1', band: 'BAND_0', messageId: 'msg-1' }),
        makePayload({ userId: 'u1', band: 'BAND_2', messageId: 'msg-2' }),
      ]);
      expect(report.flags.filter(f => f.code === 'BAND_JUMP_TOO_LARGE')).toHaveLength(0);
    });

    it('does not flag when band decreases', () => {
      const report = analyzePromptDiffs([
        makePayload({ userId: 'u1', band: 'BAND_4', messageId: 'msg-1' }),
        makePayload({ userId: 'u1', band: 'BAND_0', messageId: 'msg-2' }),
      ]);
      expect(report.flags.filter(f => f.code === 'BAND_JUMP_TOO_LARGE')).toHaveLength(0);
    });

    it('tracks bands per user independently', () => {
      const report = analyzePromptDiffs([
        makePayload({ userId: 'u1', band: 'BAND_0' }),
        makePayload({ userId: 'u2', band: 'BAND_4' }),
        makePayload({ userId: 'u1', band: 'BAND_4' }),
        makePayload({ userId: 'u2', band: 'BAND_0' }),
      ]);
      const jumpFlags = report.flags.filter(f => f.code === 'BAND_JUMP_TOO_LARGE');
      expect(jumpFlags).toHaveLength(1);
      expect(jumpFlags[0].detail).toContain('u1');
    });
  });

  describe('USER_EXCESSIVE_DIFFS', () => {
    it('flags MED when user exceeds threshold', () => {
      const payloads = Array.from({ length: DRIFT_THRESHOLDS.perUserMaxDiffs + 1 }, (_, i) =>
        makePayload({ userId: 'heavy-user', messageId: `msg-${i}` }),
      );
      const report = analyzePromptDiffs(payloads);
      const flag = report.flags.find(f => f.code === 'USER_EXCESSIVE_DIFFS');
      expect(flag).toBeDefined();
      expect(flag!.severity).toBe('MED');
      expect(flag!.detail).toContain('heavy-user');
    });

    it('does not flag at exactly the threshold', () => {
      const payloads = Array.from({ length: DRIFT_THRESHOLDS.perUserMaxDiffs }, (_, i) =>
        makePayload({ userId: 'normal-user', messageId: `msg-${i}` }),
      );
      const report = analyzePromptDiffs(payloads);
      expect(report.flags.filter(f => f.code === 'USER_EXCESSIVE_DIFFS')).toHaveLength(0);
    });
  });
});

describe('renderReport', () => {
  it('produces valid markdown', () => {
    const report = analyzePromptDiffs([
      makePayload({ userId: 'u1', band: 'BAND_0' }),
      makePayload({ userId: 'u1', band: 'BAND_2' }),
      makePayload({ userId: 'u2', band: 'BAND_2' }),
    ]);
    const md = renderReport(report);
    expect(md).toContain('# Prompt Diff Shadow Report');
    expect(md).toContain('Total payloads analyzed: 3');
    expect(md).toContain('BAND_0');
    expect(md).toContain('BAND_2');
    expect(md).toContain('u1');
    expect(md).toContain('u2');
  });

  it('shows "No flags raised" when clean', () => {
    const report = analyzePromptDiffs([makePayload()]);
    const md = renderReport(report);
    expect(md).toContain('No flags raised');
  });

  it('renders flag table when flags exist', () => {
    const report = analyzePromptDiffs([
      makePayload({ newRelationshipStyle: 'Casual — bad' }),
    ]);
    const md = renderReport(report);
    expect(md).toContain('STYLE_OUTSIDE_ALLOWED');
    expect(md).toContain('HIGH');
  });
});
