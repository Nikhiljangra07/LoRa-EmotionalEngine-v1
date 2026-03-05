// src/config/DevRuntimeProfile.ts

import { featureFlags } from '../emotion-core/config/featureFlags';

type FeatureFlags = typeof featureFlags;

/**
 * MVP Runtime Profile for Development.
 * Forces all MVP features to be enabled when NODE_ENV === "development".
 */
export function applyDevRuntimeProfile(flags: FeatureFlags): FeatureFlags {
  return {
    ...flags,
    // ── Memory MVP ──────────────────────────────────────────────────
    memoryServiceEnabled: true,
    factAnchorEnabled: true,
    bootstrapMemoryEnabled: true,
    
    // Disable legacy/shadow memory
    memoryV1Enabled: false,
    memoryV1ShadowEnabled: false,

    // ── Emotion Engine MVP ──────────────────────────────────────────
    etvV1Enabled: true,
    // EIV is always active in the pipeline, but we ensure related flags are on
    appraisalBridgeEnabled: true,
    appraisalBridgeModeEnabled: true,
    
    // ── Policy & Identity ───────────────────────────────────────────
    personaEnforcerEnabled: true,
    responseShapeContractEnabled: true,
    etvPolicyPromptEnabled: true,

    // ── Relational & Narrative ──────────────────────────────────────
    relationalRouterEnabled: true,
    narrativeStateEngineEnabled: true,

    // ── Debug & Analytics ───────────────────────────────────────────
    // These are often controlled by debugGate.ts but we can set them here if they exist in featureFlags
    memoryV1DebugEnabled: true,
  };
}
