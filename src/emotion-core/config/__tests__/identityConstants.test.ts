import {
  SYSTEM_CREATOR,
  IDENTITY_FALLBACK_PHRASES,
  applyIdentityRepetitionGuard,
} from '../identityConstants';

describe('identityConstants', () => {
  it('SYSTEM_CREATOR is Nikhil', () => {
    expect(SYSTEM_CREATOR).toBe('Nikhil');
  });

  it('IDENTITY_FALLBACK_PHRASES includes canonical creator phrase', () => {
    expect(IDENTITY_FALLBACK_PHRASES.some((p) => p.includes('Nikhil'))).toBe(
      true
    );
  });
});

describe('applyIdentityRepetitionGuard', () => {
  const base = IDENTITY_FALLBACK_PHRASES[0];

  it('returns override when lastOutput is empty', () => {
    expect(applyIdentityRepetitionGuard(base, undefined)).toBe(base);
    expect(applyIdentityRepetitionGuard(base, '')).toBe(base);
  });

  it('returns override when lastOutput differs', () => {
    expect(applyIdentityRepetitionGuard(base, 'hello world')).toBe(base);
  });

  it('returns variant when lastOutput equals override (repetition)', () => {
    const result = applyIdentityRepetitionGuard(base, base);
    expect(result).not.toBe(base);
    expect(result).toContain('Nikhil');
    expect(result).toContain('LoRa');
  });

  it('rotates through variants on consecutive repetitions', () => {
    const v1 = applyIdentityRepetitionGuard(base, base);
    expect(v1).toContain('My framework was built by Nikhil');
    const v2 = applyIdentityRepetitionGuard(v1, v1);
    expect(v2).toContain('I run on a system architected by Nikhil');
    const v3 = applyIdentityRepetitionGuard(v2, v2);
    expect(v3).toBe(base);
  });
});
