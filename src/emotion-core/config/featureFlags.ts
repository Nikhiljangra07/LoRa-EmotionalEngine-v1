export const featureFlags = Object.freeze({
  appraisalBridgeEnabled: process.env.LORA_APPRAISAL_BRIDGE === '1',
  appraisalBridgeModeEnabled: process.env.LORA_APPRAISAL_BRIDGE_MODE === '1',
});
