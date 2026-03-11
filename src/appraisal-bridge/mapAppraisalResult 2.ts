import type { AppraisalResult } from './types';

export interface RawEngineOutputs {
  timestamp: number;

  family: {
    dominantFamily: string;
    weights: Record<string, number>;
    confidence: number;
  };

  pressure: {
    scalar: number;
    slope: number;
    volatility: number;
    isShock: boolean;
    byFamily: Record<string, number>;
  };

  mood: {
    category: string;
    dominance: number;
    confidence: number;
  };

  escalation: {
    level: number;
    score: number;
    flags: {
      warmedUp: boolean;
      isFlapping: boolean;
      enteredCritical: boolean;
    };
  };

  collapse: {
    event: boolean;
    severity: number;
    direction: string;
  };

  postClarity: {
    active: boolean;
    agencyDeficit: number;
    isRelapse: boolean;
    recoveryPath: 'SPIRAL' | 'SUBSTITUTE' | 'UNKNOWN';
  };

  intervention: {
    toneMode: string;
    pacingMode: string;
    validationMode: string;
    actionMode: string;
    interruptionLevel: 0 | 1 | 2 | 3;
    guardrails: string[];
  };
}

export function mapAppraisalResult(raw: RawEngineOutputs): AppraisalResult {
  const result: AppraisalResult = {
    timestamp: raw.timestamp,

    family: Object.freeze({
      dominantFamily: raw.family.dominantFamily,
      weights: Object.freeze({ ...raw.family.weights }),
      confidence: raw.family.confidence,
    }),

    pressure: Object.freeze({
      scalar: raw.pressure.scalar,
      slope: raw.pressure.slope,
      volatility: raw.pressure.volatility,
      isShock: raw.pressure.isShock,
      byFamily: Object.freeze({ ...raw.pressure.byFamily }),
    }),

    mood: Object.freeze({
      category: raw.mood.category,
      dominance: raw.mood.dominance,
      confidence: raw.mood.confidence,
    }),

    escalation: Object.freeze({
      level: raw.escalation.level,
      score: raw.escalation.score,
      flags: Object.freeze({ ...raw.escalation.flags }),
    }),

    collapse: Object.freeze({
      event: raw.collapse.event,
      severity: raw.collapse.severity,
      direction: raw.collapse.direction,
    }),

    postClarity: Object.freeze({
      active: raw.postClarity.active,
      agencyDeficit: raw.postClarity.agencyDeficit,
      isRelapse: raw.postClarity.isRelapse,
      recoveryPath: raw.postClarity.recoveryPath,
    }),

    intervention: Object.freeze({
      toneMode: raw.intervention.toneMode,
      pacingMode: raw.intervention.pacingMode,
      validationMode: raw.intervention.validationMode,
      actionMode: raw.intervention.actionMode,
      interruptionLevel: raw.intervention.interruptionLevel,
      guardrails: Object.freeze([...raw.intervention.guardrails]),
    }),
  };

  return Object.freeze(result);
}
