/**
 * Default feature flags enabled during local development (NODE_ENV=development).
 * Only the flags listed here are overridden; all other flags remain env-var driven.
 *
 * Production and test environments are unaffected — this map is only consulted
 * when NODE_ENV is exactly 'development'.
 */
export const DEV_FEATURE_FLAGS: Readonly<Record<string, boolean>> = {
  narrativeStateEngineEnabled: true,
  responseShapeContractEnabled: true,
  personaEnforcerEnabled: true,
  bootstrapMemoryEnabled: true,
};
