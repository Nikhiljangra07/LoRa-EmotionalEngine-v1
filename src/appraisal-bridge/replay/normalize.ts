import type { AppraisalResult } from '../types';

const PRECISION = 1e6;

function roundN(x: number): number {
  return Math.round(x * PRECISION) / PRECISION;
}

function normalizeRecord(rec: Readonly<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of Object.keys(rec).sort()) {
    out[k] = roundN(rec[k]);
  }
  return out;
}

export function normalizeAppraisalResult(r: AppraisalResult): unknown {
  return {
    timestamp: r.timestamp,
    family: {
      dominantFamily: r.family.dominantFamily,
      weights: normalizeRecord(r.family.weights),
      confidence: roundN(r.family.confidence),
    },
    pressure: {
      scalar: roundN(r.pressure.scalar),
      slope: roundN(r.pressure.slope),
      volatility: roundN(r.pressure.volatility),
      isShock: r.pressure.isShock,
      byFamily: normalizeRecord(r.pressure.byFamily),
    },
    mood: {
      category: r.mood.category,
      dominance: roundN(r.mood.dominance),
      confidence: roundN(r.mood.confidence),
    },
    escalation: {
      level: r.escalation.level,
      score: roundN(r.escalation.score),
      flags: {
        warmedUp: r.escalation.flags.warmedUp,
        isFlapping: r.escalation.flags.isFlapping,
        enteredCritical: r.escalation.flags.enteredCritical,
      },
    },
    collapse: {
      event: r.collapse.event,
      severity: roundN(r.collapse.severity),
      direction: r.collapse.direction,
    },
    postClarity: {
      active: r.postClarity.active,
      agencyDeficit: roundN(r.postClarity.agencyDeficit),
      isRelapse: r.postClarity.isRelapse,
      recoveryPath: r.postClarity.recoveryPath,
    },
    intervention: {
      toneMode: r.intervention.toneMode,
      pacingMode: r.intervention.pacingMode,
      validationMode: r.intervention.validationMode,
      actionMode: r.intervention.actionMode,
      interruptionLevel: r.intervention.interruptionLevel,
      guardrails: [...r.intervention.guardrails].sort(),
    },
  };
}
