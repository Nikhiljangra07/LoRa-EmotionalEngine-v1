import {
  SYSTEM_CREATOR,
  IDENTITY_FALLBACK_PHRASES,
  applyIdentityRepetitionGuard,
} from '../identityConstants';

describe('identityConstants', () => {
  it('SYSTEM_CREATOR is empty by default (no hardcoded developer name)', () => {
    expect(SYSTEM_CREATOR).toBe('');
  });

  it('IDENTITY_FALLBACK_PHRASES does not contain developer name by default', () => {
    expect(IDENTITY_FALLBACK_PHRASES.some((p) => p.includes('Nikhil'))).toBe(false);
  });

  it('IDENTITY_FALLBACK_PHRASES includes LoRa identity phrase', () => {
    expect(IDENTITY_FALLBACK_PHRASES.some((p) => p.includes('LoRa'))).toBe(true);
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
    expect(result).toContain('LoRa');
  });

  it('rotates through variants on consecutive repetitions', () => {
    const v1 = applyIdentityRepetitionGuard(base, base);
    expect(v1).toContain('LoRa');
    const v2 = applyIdentityRepetitionGuard(v1, v1);
    expect(v2).toContain('LoRa');
    const v3 = applyIdentityRepetitionGuard(v2, v2);
    expect(v3).toBe(base);
  });
});
