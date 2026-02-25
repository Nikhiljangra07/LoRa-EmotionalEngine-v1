export const featureFlags = Object.freeze({
  appraisalBridgeEnabled: process.env.LORA_APPRAISAL_BRIDGE === '1',
  appraisalBridgeModeEnabled: process.env.LORA_APPRAISAL_BRIDGE_MODE === '1',
  appraisalPacingHintEnabled: process.env.LORA_APPRAISAL_PACING_HINT === '1',
  strictGuidanceModeEnabled: process.env.LORA_STRICT_GUIDANCE_MODE === '1',
});
