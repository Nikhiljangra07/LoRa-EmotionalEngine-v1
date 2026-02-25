export {};

const FLAG_KEYS = [
  'LORA_APPRAISAL_BRIDGE',
  'LORA_APPRAISAL_BRIDGE_MODE',
  'LORA_APPRAISAL_PACING_HINT',
  'LORA_STRICT_GUIDANCE_MODE',
  'LORA_DRIFT_MONITOR',
  'LORA_VALIDATION_INTENSITY',
  'LORA_ADAPTIVE_OVERRIDE_COOLDOWN',
  'LORA_APPRAISAL_TONE_HINT',
] as const;
const origEnv: Record<string, string | undefined> = {};
for (const k of FLAG_KEYS) origEnv[k] = process.env[k];

function clearAllFlags() {
  for (const k of FLAG_KEYS) delete process.env[k];
}

function restoreEnv() {
  for (const k of FLAG_KEYS) {
    if (origEnv[k] === undefined) delete process.env[k];
    else process.env[k] = origEnv[k];
  }
}

function loadFlags() {
  jest.resetModules();
  return require('../../config/featureFlags').featureFlags;
}

describe('FeatureFlags contract matrix', () => {
  afterEach(() => {
    restoreEnv();
  });

  // A) Baseline: no env vars → all additive flags false
  test('baseline: validationIntensityEnabled, adaptiveOverrideCooldownEnabled, appraisalToneHintEnabled are false', () => {
    clearAllFlags();
    const flags = loadFlags();
    expect(flags.validationIntensityEnabled).toBe(false);
    expect(flags.adaptiveOverrideCooldownEnabled).toBe(false);
    expect(flags.appraisalToneHintEnabled).toBe(false);
  });

  // B) Validation only
  test('LORA_VALIDATION_INTENSITY=1 → validationIntensityEnabled true', () => {
    clearAllFlags();
    process.env.LORA_VALIDATION_INTENSITY = '1';
    const flags = loadFlags();
    expect(flags.validationIntensityEnabled).toBe(true);
    expect(flags.adaptiveOverrideCooldownEnabled).toBe(false);
  });

  // C) Cooldown only (without bridge mode) — flag itself is true
  test('LORA_ADAPTIVE_OVERRIDE_COOLDOWN=1 without bridge mode → flag true', () => {
    clearAllFlags();
    process.env.LORA_ADAPTIVE_OVERRIDE_COOLDOWN = '1';
    const flags = loadFlags();
    expect(flags.adaptiveOverrideCooldownEnabled).toBe(true);
    expect(flags.appraisalBridgeModeEnabled).toBe(false);
  });

  // D) Cooldown + bridge mode + bridge
  test('cooldown + bridge + mode all set → all three flags true', () => {
    clearAllFlags();
    process.env.LORA_ADAPTIVE_OVERRIDE_COOLDOWN = '1';
    process.env.LORA_APPRAISAL_BRIDGE = '1';
    process.env.LORA_APPRAISAL_BRIDGE_MODE = '1';
    const flags = loadFlags();
    expect(flags.adaptiveOverrideCooldownEnabled).toBe(true);
    expect(flags.appraisalBridgeEnabled).toBe(true);
    expect(flags.appraisalBridgeModeEnabled).toBe(true);
  });

  // E) Tone hint only
  test('LORA_APPRAISAL_TONE_HINT=1 → appraisalToneHintEnabled true', () => {
    clearAllFlags();
    process.env.LORA_APPRAISAL_TONE_HINT = '1';
    const flags = loadFlags();
    expect(flags.appraisalToneHintEnabled).toBe(true);
    expect(flags.validationIntensityEnabled).toBe(false);
    expect(flags.adaptiveOverrideCooldownEnabled).toBe(false);
  });

  // Existing flags are unaffected by new flag env vars
  test('setting new flags does not alter existing flags', () => {
    clearAllFlags();
    process.env.LORA_VALIDATION_INTENSITY = '1';
    process.env.LORA_ADAPTIVE_OVERRIDE_COOLDOWN = '1';
    process.env.LORA_APPRAISAL_TONE_HINT = '1';
    const flags = loadFlags();
    expect(flags.appraisalBridgeEnabled).toBe(false);
    expect(flags.appraisalBridgeModeEnabled).toBe(false);
    expect(flags.appraisalPacingHintEnabled).toBe(false);
    expect(flags.strictGuidanceModeEnabled).toBe(false);
    expect(flags.driftMonitorEnabled).toBe(false);
  });

  // Frozen: cannot mutate
  test('featureFlags object is frozen', () => {
    clearAllFlags();
    const flags = loadFlags();
    expect(Object.isFrozen(flags)).toBe(true);
  });
});
