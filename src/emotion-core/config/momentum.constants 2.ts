import { MASTER_CONSTANTS } from './master.constants';

/**
 * Momentum constants (v1 runtime-only)
 *
 * These control session-local emotional inertia.
 * They do NOT affect detection or scoring.
 *
 * Governance:
 * - Centralized for audit
 * - Explicitly NOT empirically calibrated yet
 */
export const MOMENTUM_CONSTANTS = MASTER_CONSTANTS.momentum;
