// src/emotion-core/etv/engine.ts

import type {
  SessionSummaryV1,
  ETVStateStored,
  ETVStateDerived,
  ETVPolicy,
  ETVUpdateLog,
} from './types';
import { ETV_CONFIG, SHORT_SESSION } from './constants';
import { computeEvidenceScore } from './evidenceScore';
import { applyDecay, applyEvidence, toFullState } from './betaUpdate';
import { computePolicy, computeRiskAdjusted, computeConf } from './policyMap';
import { ETVStorage } from './storage';

/**
 * ETV V1 Engine — orchestrates the full session-boundary update cycle:
 *
 *   SessionSummary → z_t → load → decay → update → persist → policy
 *
 * Pure pipeline; all side-effects (storage) are isolated in ETVStorage.
 */
export class ETVEngineV1 {
  /**
   * Full session-boundary update.
   *
   * Short sessions (< SHORT_SESSION.minMessages) use reduced evidence
   * mass to prevent "AVI=0 on 1-msg session => inflated trust" bias.
   *
   * @returns The updated policy AND the log record for observability.
   */
  static updateFromSession(summary: SessionSummaryV1): {
    policy: ETVPolicy;
    log: ETVUpdateLog;
    state: ETVStateDerived;
  } {
    const z_t = computeEvidenceScore(summary);
    const now = summary.endedAt || Date.now();

    // Load or initialize
    let stored: ETVStateStored =
      ETVStorage.load(summary.userId) ??
      ETVStorage.initState(summary.userId);

    const r_before = stored.r;
    const s_before = stored.s;

    // Decay
    const deltaHours =
      stored.lastSessionEndedAt > 0
        ? Math.max(0, (now - stored.lastSessionEndedAt) / 3_600_000)
        : 0;

    const decayResult = applyDecay(stored, deltaHours);
    stored = decayResult.state;

    // Short-session bias correction
    const mass = summary.messageCount < SHORT_SESSION.minMessages
      ? SHORT_SESSION.reducedMass
      : ETV_CONFIG.evidenceMass;

    // Evidence update
    stored = applyEvidence(stored, z_t, mass);

    // Timestamp
    stored = {
      ...stored,
      lastSessionEndedAt: now,
      updatedAt: now,
    };

    // Persist
    ETVStorage.save(stored);

    // Derive + policy
    const fullState = toFullState(stored);
    const policy = computePolicy(fullState);
    const riskAdjusted = computeRiskAdjusted(fullState);
    const conf = computeConf(fullState);

    console.debug('[LoRa::ETV_BAND]', {
      etv: fullState.etvMean,
      riskAdjusted,
      computedBand: policy.band,
    });

    const log: ETVUpdateLog = {
      userId: summary.userId,
      sessionId: summary.sessionId,
      deltaHours,
      decay: decayResult.decay,
      z_t,
      evidenceMass: mass,
      r_before,
      s_before,
      r_after: stored.r,
      s_after: stored.s,
      etvMean: fullState.etvMean,
      etvVar: fullState.etvVar,
      band: policy.band,
      policy,
      timestamp: now,
      effectiveN: fullState.effectiveN,
      riskAdjusted,
      conf,
      messageCount: summary.messageCount,
      eivMean: summary.eivMean,
      aviMean: summary.aviMean,
    };

    return { policy, log, state: fullState };
  }

  /**
   * Read-only policy lookup (no update, no persist).
   */
  static getPolicy(userId: string): ETVPolicy {
    const stored =
      ETVStorage.load(userId) ?? ETVStorage.initState(userId);
    return computePolicy(toFullState(stored));
  }
}

/**
 * Snapshot for trajectory observability — logging only, no side-effects.
 */
export function formatTrajectorySnapshot(
  state: ETVStateDerived,
  summary: SessionSummaryV1,
  z_t: number,
): {
  userId: string;
  sessionId: string;
  mean: number;
  variance: number;
  effectiveN: number;
  riskAdjusted: number;
  conf: number;
  band: string;
  z: number;
  messageCount: number;
  eivMean: number;
  aviMean: number;
} {
  const riskAdjusted = computeRiskAdjusted(state);
  const conf = computeConf(state);
  const policy = computePolicy(state);

  return {
    userId: summary.userId,
    sessionId: summary.sessionId,
    mean: state.etvMean,
    variance: state.etvVar,
    effectiveN: state.effectiveN,
    riskAdjusted,
    conf,
    band: policy.band,
    z: z_t,
    messageCount: summary.messageCount,
    eivMean: summary.eivMean,
    aviMean: summary.aviMean,
  };
}
