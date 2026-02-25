// src/emotion-core/etv/sim/etvSimulator.ts

import type { SessionSummaryV1, ETVStateStored, ETVBand, ETVPolicy } from '../types';
import { ETV_CONFIG, SHORT_SESSION } from '../constants';
import { computeEvidenceScore } from '../evidenceScore';
import { applyDecay, applyEvidence, toFullState } from '../betaUpdate';
import { computePolicy, computeRiskAdjusted, computeConf } from '../policyMap';

export type SimStepResult = {
  sessionId: string;
  z: number;
  mass: number;
  r: number;
  s: number;
  mean: number;
  variance: number;
  effectiveN: number;
  riskAdjusted: number;
  conf: number;
  band: ETVBand;
  policy: ETVPolicy;
  decayApplied: number;
  deltaHours: number;
};

/**
 * Pure, deterministic ETV simulator.
 *
 * Runs the real pipeline (evidenceScore -> decay -> evidence -> derive -> policy)
 * over a sequence of synthetic SessionSummaryV1 objects without touching storage.
 */
export function runSimulation(
  sessions: readonly SessionSummaryV1[],
  initialState?: Partial<Pick<ETVStateStored, 'r' | 's' | 'lastSessionEndedAt'>>,
): SimStepResult[] {
  const userId = sessions.length > 0 ? sessions[0].userId : 'sim';

  let stored: ETVStateStored = {
    userId,
    r: initialState?.r ?? ETV_CONFIG.initR,
    s: initialState?.s ?? ETV_CONFIG.initS,
    lastSessionEndedAt: initialState?.lastSessionEndedAt ?? (sessions.length > 0 ? sessions[0].startedAt : 0),
    updatedAt: 0,
  };

  const results: SimStepResult[] = [];

  for (const summary of sessions) {
    const z = computeEvidenceScore(summary);
    const now = summary.endedAt;

    const deltaHours =
      stored.lastSessionEndedAt > 0
        ? Math.max(0, (summary.startedAt - stored.lastSessionEndedAt) / 3_600_000)
        : 0;

    const decayResult = applyDecay(stored, deltaHours);
    stored = decayResult.state;

    const mass = summary.messageCount < SHORT_SESSION.minMessages
      ? SHORT_SESSION.reducedMass
      : ETV_CONFIG.evidenceMass;

    stored = applyEvidence(stored, z, mass);
    stored = { ...stored, lastSessionEndedAt: now, updatedAt: now };

    const full = toFullState(stored);
    const policy = computePolicy(full);
    const riskAdjusted = computeRiskAdjusted(full);
    const conf = computeConf(full);

    results.push({
      sessionId: summary.sessionId,
      z,
      mass,
      r: stored.r,
      s: stored.s,
      mean: full.etvMean,
      variance: full.etvVar,
      effectiveN: full.effectiveN,
      riskAdjusted,
      conf,
      band: policy.band,
      policy,
      decayApplied: decayResult.decay,
      deltaHours,
    });
  }

  return results;
}
