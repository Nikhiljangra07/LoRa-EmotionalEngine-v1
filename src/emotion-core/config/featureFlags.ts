import { DEV_FEATURE_FLAGS } from '../../config/DevConfig';

const isDev = process.env.NODE_ENV === 'development';
const isTest = process.env.NODE_ENV === 'test';

/**
 * Resolve a boolean feature flag.
 * In development mode, flags listed in DEV_FEATURE_FLAGS default to their
 * dev value. In production and test environments, env vars are the sole source.
 */
function flag(envValue: string | undefined, key: string): boolean {
  if (isDev && key in DEV_FEATURE_FLAGS) {
    return DEV_FEATURE_FLAGS[key];
  }
  return envValue === '1';
}

const rawFlags = Object.freeze({
  appraisalBridgeEnabled: flag(process.env.LORA_APPRAISAL_BRIDGE, 'appraisalBridgeEnabled'),
  appraisalBridgeModeEnabled: flag(process.env.LORA_APPRAISAL_BRIDGE_MODE, 'appraisalBridgeModeEnabled'),
  appraisalPacingHintEnabled: flag(process.env.LORA_APPRAISAL_PACING_HINT, 'appraisalPacingHintEnabled'),
  strictGuidanceModeEnabled: flag(process.env.LORA_STRICT_GUIDANCE_MODE, 'strictGuidanceModeEnabled'),
  driftMonitorEnabled: flag(process.env.LORA_DRIFT_MONITOR, 'driftMonitorEnabled'),
  validationIntensityEnabled: flag(process.env.LORA_VALIDATION_INTENSITY, 'validationIntensityEnabled'),
  adaptiveOverrideCooldownEnabled: flag(process.env.LORA_ADAPTIVE_OVERRIDE_COOLDOWN, 'adaptiveOverrideCooldownEnabled'),
  appraisalToneHintEnabled: flag(process.env.LORA_APPRAISAL_TONE_HINT, 'appraisalToneHintEnabled'),
  interventionValidationHintEnabled: flag(process.env.LORA_INTERVENTION_VALIDATION_HINT, 'interventionValidationHintEnabled'),
  interventionPacingHintEnabled: flag(process.env.LORA_INTERVENTION_PACING_HINT, 'interventionPacingHintEnabled'),
  interventionToneHintEnabled: flag(process.env.LORA_INTERVENTION_TONE_HINT, 'interventionToneHintEnabled'),
  interventionActionHintEnabled: flag(process.env.LORA_INTERVENTION_ACTION_HINT, 'interventionActionHintEnabled'),
  interventionInterruptHintEnabled: flag(process.env.LORA_INTERVENTION_INTERRUPT_HINT, 'interventionInterruptHintEnabled'),
  interventionStepHintEnabled: flag(process.env.LORA_INTERVENTION_STEP_HINT, 'interventionStepHintEnabled'),
  interventionQuestionBudgetEnabled: flag(process.env.LORA_INTERVENTION_QUESTION_BUDGET, 'interventionQuestionBudgetEnabled'),
  hintResolverEnabled: flag(process.env.LORA_HINT_RESOLVER, 'hintResolverEnabled'),
  hintStickinessEnabled: flag(process.env.LORA_HINT_STICKINESS, 'hintStickinessEnabled'),
  guidanceDwellLockEnabled: flag(process.env.LORA_GUIDANCE_DWELL_LOCK, 'guidanceDwellLockEnabled'),
  hintSemanticGuardEnabled: flag(process.env.LORA_HINT_SEMANTIC_GUARD, 'hintSemanticGuardEnabled'),
  etvV1Enabled: flag(process.env.LORA_ETV_V1, 'etvV1Enabled'),
  etvPolicyPromptEnabled: flag(process.env.LORA_ETV_POLICY_PROMPT, 'etvPolicyPromptEnabled'),
  etvPolicyPromptShadowEnabled: flag(process.env.LORA_ETV_POLICY_PROMPT_SHADOW, 'etvPolicyPromptShadowEnabled'),
  memoryV1Enabled: flag(process.env.LORA_MEMORY_V1, 'memoryV1Enabled'),
  memoryV1ShadowEnabled: flag(process.env.LORA_MEMORY_V1_SHADOW, 'memoryV1ShadowEnabled'),
  memoryV1DebugEnabled: flag(process.env.LORA_MEMORY_V1_DEBUG, 'memoryV1DebugEnabled'),
  memoryV1ChromaEnabled: flag(process.env.LORA_MEMORY_V1_CHROMA, 'memoryV1ChromaEnabled'),
  factAnchorEnabled: flag(process.env.LORA_FACT_ANCHOR, 'factAnchorEnabled'),
  memoryServiceEnabled: flag(process.env.LORA_MEMORY_SERVICE, 'memoryServiceEnabled'),
  relationalRouterEnabled: flag(process.env.LORA_RELATIONAL_ROUTER, 'relationalRouterEnabled'),
  personaEnforcerEnabled: flag(process.env.LORA_PERSONA_ENFORCER, 'personaEnforcerEnabled'),
  narrativeStateEngineEnabled: flag(process.env.LORA_NSE, 'narrativeStateEngineEnabled'),
  responseShapeContractEnabled: flag(process.env.LORA_RSC, 'responseShapeContractEnabled'),
  bootstrapMemoryEnabled: flag(process.env.LORA_BOOTSTRAP_MEMORY, 'bootstrapMemoryEnabled'),
  bootstrapMemorySessionThreshold: parseInt(process.env.LORA_BOOTSTRAP_SESSIONS ?? '5', 10),
  memoryV2Enabled: flag(process.env.LORA_MEMORY_V2, 'memoryV2Enabled'),
  memoryV2ShadowEnabled: flag(process.env.LORA_MEMORY_V2_SHADOW, 'memoryV2ShadowEnabled'),
  multiPerspectiveEnabled: flag(process.env.LORA_MULTI_PERSPECTIVE, 'multiPerspectiveEnabled'),
  perspectiveDeepModeEnabled: flag(process.env.LORA_PERSPECTIVE_DEEP_MODE, 'perspectiveDeepModeEnabled'),
});

/**
 * Export the final feature flags.
 * In development, we apply the MVP runtime profile.
 * In tests and production, we use the raw flags (env-driven).
 */
export const featureFlags = (() => {
  if (isTest) {
    return rawFlags;
  }
  if (isDev) {
    // We import this dynamically to avoid circular dependencies if any
    const { applyDevRuntimeProfile } = require('../../config/DevRuntimeProfile');
    return Object.freeze(applyDevRuntimeProfile(rawFlags));
  }
  return rawFlags;
})();

