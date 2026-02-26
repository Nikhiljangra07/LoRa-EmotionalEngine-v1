import { computeSalience } from '../salience';
import { MEMORY_V1_CONFIG } from '../constants';
import type { SalienceInput } from '../types';

const {
  SALIENCE_FLOOR,
  W_EIV_BASELINE, W_AVI_BASELINE,
  W_EIV_ENHANCED, W_AVI_ENHANCED, W_ESC_ENHANCED,
} = MEMORY_V1_CONFIG;

describe('salience – baseline formula', () => {
  it('uses only EIV and AVI weights in baseline mode', () => {
    const input: SalienceInput = {
      eivValue: 1.0,
      avi: 1.0,
      appraisalBridgeEnabled: false,
      hasViolation: false,
      collapseEvent: false,
    };
    const result = computeSalience(input);
    expect(result.salience).toBeCloseTo(W_EIV_BASELINE + W_AVI_BASELINE, 8);
  });

  it('computes correct weighted sum for partial values', () => {
    const input: SalienceInput = {
      eivValue: 0.5,
      avi: 0.3,
      appraisalBridgeEnabled: false,
      hasViolation: false,
      collapseEvent: false,
    };
    const expected = W_EIV_BASELINE * 0.5 + W_AVI_BASELINE * 0.3;
    expect(computeSalience(input).salience).toBeCloseTo(expected, 8);
  });

  it('ignores escalationScore in baseline mode', () => {
    const withEsc: SalienceInput = {
      eivValue: 0.5,
      avi: 0.3,
      escalationScore: 0.9,
      appraisalBridgeEnabled: false,
      hasViolation: false,
      collapseEvent: false,
    };
    const withoutEsc: SalienceInput = {
      eivValue: 0.5,
      avi: 0.3,
      appraisalBridgeEnabled: false,
      hasViolation: false,
      collapseEvent: false,
    };
    expect(computeSalience(withEsc).salience).toBeCloseTo(
      computeSalience(withoutEsc).salience, 8,
    );
  });
});

describe('salience – enhanced formula', () => {
  it('includes escalation weight in enhanced mode', () => {
    const input: SalienceInput = {
      eivValue: 1.0,
      avi: 1.0,
      escalationScore: 1.0,
      appraisalBridgeEnabled: true,
      hasViolation: false,
      collapseEvent: false,
    };
    const expected = W_EIV_ENHANCED + W_AVI_ENHANCED + W_ESC_ENHANCED;
    expect(computeSalience(input).salience).toBeCloseTo(expected, 8);
  });

  it('defaults escalationScore to 0 when missing', () => {
    const input: SalienceInput = {
      eivValue: 0.5,
      avi: 0.5,
      appraisalBridgeEnabled: true,
      hasViolation: false,
      collapseEvent: false,
    };
    const expected = W_EIV_ENHANCED * 0.5 + W_AVI_ENHANCED * 0.5;
    expect(computeSalience(input).salience).toBeCloseTo(expected, 8);
  });

  it('enhanced with escalation produces higher salience than without', () => {
    const base: SalienceInput = {
      eivValue: 0.5,
      avi: 0.5,
      appraisalBridgeEnabled: true,
      hasViolation: false,
      collapseEvent: false,
    };
    const withEsc: SalienceInput = { ...base, escalationScore: 0.8 };
    expect(computeSalience(withEsc).salience).toBeGreaterThan(
      computeSalience(base).salience,
    );
  });
});

describe('salience – override conditions', () => {
  it('VIOLATION forces shouldWrite=true even below floor', () => {
    const input: SalienceInput = {
      eivValue: 0.0,
      avi: 0.0,
      appraisalBridgeEnabled: false,
      hasViolation: true,
      collapseEvent: false,
    };
    const result = computeSalience(input);
    expect(result.salience).toBeLessThan(SALIENCE_FLOOR);
    expect(result.shouldWrite).toBe(true);
    expect(result.overrideReason).toBe('VIOLATION');
  });

  it('COLLAPSE forces shouldWrite=true even below floor', () => {
    const input: SalienceInput = {
      eivValue: 0.0,
      avi: 0.0,
      appraisalBridgeEnabled: false,
      hasViolation: false,
      collapseEvent: true,
    };
    const result = computeSalience(input);
    expect(result.salience).toBeLessThan(SALIENCE_FLOOR);
    expect(result.shouldWrite).toBe(true);
    expect(result.overrideReason).toBe('COLLAPSE');
  });

  it('COLLAPSE takes priority over VIOLATION', () => {
    const input: SalienceInput = {
      eivValue: 0.5,
      avi: 0.5,
      appraisalBridgeEnabled: false,
      hasViolation: true,
      collapseEvent: true,
    };
    const result = computeSalience(input);
    expect(result.overrideReason).toBe('COLLAPSE');
  });

  it('NONE when below floor and no override', () => {
    const input: SalienceInput = {
      eivValue: 0.01,
      avi: 0.01,
      appraisalBridgeEnabled: false,
      hasViolation: false,
      collapseEvent: false,
    };
    const result = computeSalience(input);
    expect(result.salience).toBeLessThan(SALIENCE_FLOOR);
    expect(result.shouldWrite).toBe(false);
    expect(result.overrideReason).toBe('NONE');
  });
});

describe('salience – bounds and safety', () => {
  it('salience is always in [0,1]', () => {
    const inputs: SalienceInput[] = [
      { eivValue: 0, avi: 0, appraisalBridgeEnabled: false, hasViolation: false, collapseEvent: false },
      { eivValue: 1, avi: 1, appraisalBridgeEnabled: false, hasViolation: false, collapseEvent: false },
      { eivValue: 1, avi: 1, escalationScore: 1, appraisalBridgeEnabled: true, hasViolation: false, collapseEvent: false },
      { eivValue: 5, avi: 5, appraisalBridgeEnabled: false, hasViolation: false, collapseEvent: false },
    ];
    for (const input of inputs) {
      const result = computeSalience(input);
      expect(result.salience).toBeGreaterThanOrEqual(0);
      expect(result.salience).toBeLessThanOrEqual(1);
      expect(Number.isFinite(result.salience)).toBe(true);
    }
  });

  it('handles NaN eivValue gracefully', () => {
    const input: SalienceInput = {
      eivValue: NaN as any,
      avi: 0.5,
      appraisalBridgeEnabled: false,
      hasViolation: false,
      collapseEvent: false,
    };
    const result = computeSalience(input);
    expect(Number.isFinite(result.salience)).toBe(true);
    expect(result.salience).toBeGreaterThanOrEqual(0);
    expect(result.salience).toBeLessThanOrEqual(1);
  });

  it('shouldWrite=true when salience equals exactly SALIENCE_FLOOR', () => {
    // Construct so salience = 0.15 exactly: 0.60*eiv + 0.40*avi = 0.15
    // eiv=0.25, avi=0 => 0.60*0.25 = 0.15
    const input: SalienceInput = {
      eivValue: 0.25,
      avi: 0.0,
      appraisalBridgeEnabled: false,
      hasViolation: false,
      collapseEvent: false,
    };
    const result = computeSalience(input);
    expect(result.salience).toBeCloseTo(SALIENCE_FLOOR, 8);
    expect(result.shouldWrite).toBe(true);
  });
});
