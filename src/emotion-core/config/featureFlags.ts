export const featureFlags = Object.freeze({
  appraisalBridgeEnabled: process.env.LORA_APPRAISAL_BRIDGE === '1',
  appraisalBridgeModeEnabled: process.env.LORA_APPRAISAL_BRIDGE_MODE === '1',
  appraisalPacingHintEnabled: process.env.LORA_APPRAISAL_PACING_HINT === '1',
  strictGuidanceModeEnabled: process.env.LORA_STRICT_GUIDANCE_MODE === '1',
  driftMonitorEnabled: process.env.LORA_DRIFT_MONITOR === '1',
  validationIntensityEnabled: process.env.LORA_VALIDATION_INTENSITY === '1',
  adaptiveOverrideCooldownEnabled: process.env.LORA_ADAPTIVE_OVERRIDE_COOLDOWN === '1',
  appraisalToneHintEnabled: process.env.LORA_APPRAISAL_TONE_HINT === '1',
  interventionValidationHintEnabled: process.env.LORA_INTERVENTION_VALIDATION_HINT === '1',
});
