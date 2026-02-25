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
  'LORA_INTERVENTION_VALIDATION_HINT',
  'LORA_INTERVENTION_PACING_HINT',
  'LORA_INTERVENTION_TONE_HINT',
  'LORA_INTERVENTION_ACTION_HINT',
  'LORA_INTERVENTION_INTERRUPT_HINT',
  'LORA_INTERVENTION_STEP_HINT',
  'LORA_INTERVENTION_QUESTION_BUDGET',
  'LORA_HINT_RESOLVER',
  'LORA_HINT_STICKINESS',
  'LORA_GUIDANCE_DWELL_LOCK',
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
    expect(flags.interventionValidationHintEnabled).toBe(false);
    expect(flags.interventionPacingHintEnabled).toBe(false);
    expect(flags.interventionToneHintEnabled).toBe(false);
    expect(flags.interventionActionHintEnabled).toBe(false);
    expect(flags.interventionInterruptHintEnabled).toBe(false);
    expect(flags.interventionStepHintEnabled).toBe(false);
    expect(flags.interventionQuestionBudgetEnabled).toBe(false);
    expect(flags.hintResolverEnabled).toBe(false);
    expect(flags.hintStickinessEnabled).toBe(false);
    expect(flags.guidanceDwellLockEnabled).toBe(false);
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

  // F) Intervention validation hint only
  test('LORA_INTERVENTION_VALIDATION_HINT=1 → interventionValidationHintEnabled true', () => {
    clearAllFlags();
    process.env.LORA_INTERVENTION_VALIDATION_HINT = '1';
    const flags = loadFlags();
    expect(flags.interventionValidationHintEnabled).toBe(true);
    expect(flags.appraisalToneHintEnabled).toBe(false);
    expect(flags.validationIntensityEnabled).toBe(false);
  });

  // G) Intervention pacing hint only
  test('LORA_INTERVENTION_PACING_HINT=1 → interventionPacingHintEnabled true', () => {
    clearAllFlags();
    process.env.LORA_INTERVENTION_PACING_HINT = '1';
    const flags = loadFlags();
    expect(flags.interventionPacingHintEnabled).toBe(true);
    expect(flags.appraisalPacingHintEnabled).toBe(false);
    expect(flags.interventionValidationHintEnabled).toBe(false);
  });

  // H) Intervention tone hint only
  test('LORA_INTERVENTION_TONE_HINT=1 → interventionToneHintEnabled true', () => {
    clearAllFlags();
    process.env.LORA_INTERVENTION_TONE_HINT = '1';
    const flags = loadFlags();
    expect(flags.interventionToneHintEnabled).toBe(true);
    expect(flags.appraisalToneHintEnabled).toBe(false);
    expect(flags.interventionPacingHintEnabled).toBe(false);
  });

  // I) Intervention action hint only
  test('LORA_INTERVENTION_ACTION_HINT=1 → interventionActionHintEnabled true', () => {
    clearAllFlags();
    process.env.LORA_INTERVENTION_ACTION_HINT = '1';
    const flags = loadFlags();
    expect(flags.interventionActionHintEnabled).toBe(true);
    expect(flags.interventionToneHintEnabled).toBe(false);
    expect(flags.interventionPacingHintEnabled).toBe(false);
  });

  // J) Intervention interrupt hint only
  test('LORA_INTERVENTION_INTERRUPT_HINT=1 → interventionInterruptHintEnabled true', () => {
    clearAllFlags();
    process.env.LORA_INTERVENTION_INTERRUPT_HINT = '1';
    const flags = loadFlags();
    expect(flags.interventionInterruptHintEnabled).toBe(true);
    expect(flags.interventionActionHintEnabled).toBe(false);
    expect(flags.interventionToneHintEnabled).toBe(false);
  });

  // K) Intervention step hint only
  test('LORA_INTERVENTION_STEP_HINT=1 → interventionStepHintEnabled true', () => {
    clearAllFlags();
    process.env.LORA_INTERVENTION_STEP_HINT = '1';
    const flags = loadFlags();
    expect(flags.interventionStepHintEnabled).toBe(true);
    expect(flags.interventionInterruptHintEnabled).toBe(false);
    expect(flags.interventionActionHintEnabled).toBe(false);
  });

  // L) Intervention question budget only
  test('LORA_INTERVENTION_QUESTION_BUDGET=1 → interventionQuestionBudgetEnabled true', () => {
    clearAllFlags();
    process.env.LORA_INTERVENTION_QUESTION_BUDGET = '1';
    const flags = loadFlags();
    expect(flags.interventionQuestionBudgetEnabled).toBe(true);
    expect(flags.interventionStepHintEnabled).toBe(false);
    expect(flags.interventionInterruptHintEnabled).toBe(false);
  });

  // M) Hint resolver only
  test('LORA_HINT_RESOLVER=1 → hintResolverEnabled true', () => {
    clearAllFlags();
    process.env.LORA_HINT_RESOLVER = '1';
    const flags = loadFlags();
    expect(flags.hintResolverEnabled).toBe(true);
    expect(flags.interventionQuestionBudgetEnabled).toBe(false);
    expect(flags.interventionStepHintEnabled).toBe(false);
  });

  // N) Hint stickiness only
  test('LORA_HINT_STICKINESS=1 → hintStickinessEnabled true', () => {
    clearAllFlags();
    process.env.LORA_HINT_STICKINESS = '1';
    const flags = loadFlags();
    expect(flags.hintStickinessEnabled).toBe(true);
    expect(flags.hintResolverEnabled).toBe(false);
    expect(flags.interventionQuestionBudgetEnabled).toBe(false);
  });

  // O) Guidance dwell lock only
  test('LORA_GUIDANCE_DWELL_LOCK=1 → guidanceDwellLockEnabled true', () => {
    clearAllFlags();
    process.env.LORA_GUIDANCE_DWELL_LOCK = '1';
    const flags = loadFlags();
    expect(flags.guidanceDwellLockEnabled).toBe(true);
    expect(flags.hintStickinessEnabled).toBe(false);
    expect(flags.hintResolverEnabled).toBe(false);
  });

  // Existing flags are unaffected by new flag env vars
  test('setting new flags does not alter existing flags', () => {
    clearAllFlags();
    process.env.LORA_VALIDATION_INTENSITY = '1';
    process.env.LORA_ADAPTIVE_OVERRIDE_COOLDOWN = '1';
    process.env.LORA_APPRAISAL_TONE_HINT = '1';
    process.env.LORA_INTERVENTION_VALIDATION_HINT = '1';
    process.env.LORA_INTERVENTION_PACING_HINT = '1';
    process.env.LORA_INTERVENTION_TONE_HINT = '1';
    process.env.LORA_INTERVENTION_ACTION_HINT = '1';
    process.env.LORA_INTERVENTION_INTERRUPT_HINT = '1';
    process.env.LORA_INTERVENTION_STEP_HINT = '1';
    process.env.LORA_INTERVENTION_QUESTION_BUDGET = '1';
    process.env.LORA_HINT_RESOLVER = '1';
    process.env.LORA_HINT_STICKINESS = '1';
    process.env.LORA_GUIDANCE_DWELL_LOCK = '1';
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
