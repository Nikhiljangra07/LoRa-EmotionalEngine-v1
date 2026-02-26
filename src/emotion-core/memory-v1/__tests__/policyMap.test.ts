import { getMemoryV1Policy } from '../policyMap';
import type { ETVBandHint, MemoryV1Policy } from '../policyTypes';

describe('policyMap — band→policy mapping', () => {
  it('B0: no prompt injection', () => {
    const p = getMemoryV1Policy('B0');
    expect(p.allowPromptInjection).toBe(false);
    expect(p.maxSchemasInPrompt).toBe(0);
  });

  it('B1: no prompt injection', () => {
    const p = getMemoryV1Policy('B1');
    expect(p.allowPromptInjection).toBe(false);
    expect(p.maxSchemasInPrompt).toBe(0);
  });

  it('B2: minimal — 1 schema, trajectory allowed, tendency blocked', () => {
    const p = getMemoryV1Policy('B2');
    expect(p.allowPromptInjection).toBe(true);
    expect(p.maxSchemasInPrompt).toBe(1);
    expect(p.allowTrajectoryLabel).toBe(true);
    expect(p.allowTendencyLabel).toBe(false);
    expect(p.allowSessionPattern).toBe(false);
  });

  it('B3: moderate — 2 schemas, trajectory allowed, tendency blocked, sessionPattern allowed', () => {
    const p = getMemoryV1Policy('B3');
    expect(p.allowPromptInjection).toBe(true);
    expect(p.maxSchemasInPrompt).toBe(2);
    expect(p.allowTrajectoryLabel).toBe(true);
    expect(p.allowTendencyLabel).toBe(false);
    expect(p.allowSessionPattern).toBe(true);
  });

  it('B4: full — 3 schemas, all labels allowed', () => {
    const p = getMemoryV1Policy('B4');
    expect(p.allowPromptInjection).toBe(true);
    expect(p.maxSchemasInPrompt).toBe(3);
    expect(p.allowTrajectoryLabel).toBe(true);
    expect(p.allowTendencyLabel).toBe(true);
    expect(p.allowSessionPattern).toBe(true);
  });

  it('forbidCompanionship is always true for all bands', () => {
    const bands: ETVBandHint[] = ['B0', 'B1', 'B2', 'B3', 'B4'];
    for (const band of bands) {
      expect(getMemoryV1Policy(band).forbidCompanionship).toBe(true);
    }
  });

  it('band field matches the input for all bands', () => {
    const bands: ETVBandHint[] = ['B0', 'B1', 'B2', 'B3', 'B4'];
    for (const band of bands) {
      expect(getMemoryV1Policy(band).band).toBe(band);
    }
  });

  it('B0 and B1 have identical restriction profile', () => {
    const b0 = getMemoryV1Policy('B0');
    const b1 = getMemoryV1Policy('B1');
    expect(b0.allowPromptInjection).toBe(b1.allowPromptInjection);
    expect(b0.maxSchemasInPrompt).toBe(b1.maxSchemasInPrompt);
    expect(b0.allowTendencyLabel).toBe(b1.allowTendencyLabel);
    expect(b0.allowTrajectoryLabel).toBe(b1.allowTrajectoryLabel);
    expect(b0.allowSessionPattern).toBe(b1.allowSessionPattern);
  });

  it('maxSchemasInPrompt increases monotonically B2→B3→B4', () => {
    const b2 = getMemoryV1Policy('B2').maxSchemasInPrompt;
    const b3 = getMemoryV1Policy('B3').maxSchemasInPrompt;
    const b4 = getMemoryV1Policy('B4').maxSchemasInPrompt;
    expect(b3).toBeGreaterThan(b2);
    expect(b4).toBeGreaterThan(b3);
  });

  it('tendency label only allowed at B4', () => {
    expect(getMemoryV1Policy('B2').allowTendencyLabel).toBe(false);
    expect(getMemoryV1Policy('B3').allowTendencyLabel).toBe(false);
    expect(getMemoryV1Policy('B4').allowTendencyLabel).toBe(true);
  });
});
