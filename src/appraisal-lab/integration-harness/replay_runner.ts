import { updatePressureWithTime } from "../time-engine";
import { createPressureState, updatePressureState } from "../pressure-engine";
import { createEscalationState, updateEscalationState } from "../escalation-engine";
import {
  CollapseDirection,
  MoodCategory,
  createCollapseState,
  updateCollapseState,
} from "../collapse-engine";
import { createPostClarityState, updatePostClarityState } from "../post-clarity-engine";
import type {
  CollapseDirection as PostCollapseDirection,
  PostClarityInputs,
} from "../post-clarity-engine";
import { DEFAULT_BASELINE_LATENCY_SECONDS } from "./constants";
import type { HarnessEvent, HarnessRunResult, HarnessStepTrace } from "./types";

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function assertFinite(name: string, value: number, i: number): void {
  if (!isFiniteNumber(value)) {
    throw new Error(`Non-finite ${name} at step ${i}: ${String(value)}`);
  }
}

function chooseMood(valence: number, arousal: number): MoodCategory {
  if (valence <= -0.45 && arousal >= 0.6) {
    return MoodCategory.AVERSIVE;
  }
  if (valence <= -0.45) {
    return MoodCategory.ANXIOUS;
  }
  if (valence >= 0.45 && arousal <= 0.4) {
    return MoodCategory.POSITIVE;
  }
  return MoodCategory.NEUTRAL;
}

function sortStableByTs(events: HarnessEvent[]): HarnessEvent[] {
  const indexed = events.map((event, idx) => ({ event, idx }));
  indexed.sort((a, b) => {
    const at = finiteOrZero(a.event.tsSeconds);
    const bt = finiteOrZero(b.event.tsSeconds);
    if (at !== bt) {
      return at - bt;
    }
    return a.idx - b.idx;
  });
  return indexed.map((x) => x.event);
}

export function runReplay(events: HarnessEvent[]): HarnessRunResult {
  const sortedEvents = sortStableByTs(events);
  for (let i = 1; i < sortedEvents.length; i += 1) {
    if (finiteOrZero(sortedEvents[i].tsSeconds) < finiteOrZero(sortedEvents[i - 1].tsSeconds)) {
      throw new Error("Event timestamps are not monotonic after stable sort.");
    }
  }

  let pressureState = createPressureState(0);
  let escalationState = createEscalationState();
  let collapseState = createCollapseState();
  let postClarityState = createPostClarityState();

  const steps: HarnessStepTrace[] = [];
  let previousTs: number | null = null;

  for (let i = 0; i < sortedEvents.length; i += 1) {
    const event = sortedEvents[i];
    const harnessTags: string[] = [];

    const tsSecondsRaw = event.tsSeconds;
    const tsSeconds = finiteOrZero(tsSecondsRaw);
    if (!Number.isFinite(tsSecondsRaw)) {
      harnessTags.push("HARNESS_SANITIZED_INPUT");
    }

    const activationRaw = event.activation;
    const activation = clamp(finiteOrZero(activationRaw), -2, 2);
    if (!Number.isFinite(activationRaw)) {
      harnessTags.push("HARNESS_SANITIZED_INPUT");
    }

    const valenceRaw = event.valence;
    const valence = clamp(finiteOrZero(valenceRaw), -1, 1);
    if (!Number.isFinite(valenceRaw)) {
      harnessTags.push("HARNESS_SANITIZED_INPUT");
    }

    const arousalRaw = event.arousal;
    const arousal = clamp(finiteOrZero(arousalRaw), 0, 1);
    if (!Number.isFinite(arousalRaw)) {
      harnessTags.push("HARNESS_SANITIZED_INPUT");
    }

    const expressionRaw = event.expressionStrength;
    const expressionStrength = clamp(finiteOrZero(expressionRaw), 0, 1);
    if (!Number.isFinite(expressionRaw)) {
      harnessTags.push("HARNESS_SANITIZED_INPUT");
    }

    const repetitionRaw = event.pattern.repetitionScore ?? 0;
    const repetitionScore = clamp(finiteOrZero(repetitionRaw), 0, 1);
    if (!Number.isFinite(repetitionRaw)) {
      harnessTags.push("HARNESS_SANITIZED_INPUT");
    }

    const validationRaw = event.substituteEvidence?.validationSeekingScore ?? 0;
    const topicShiftRaw = event.substituteEvidence?.topicShiftScore ?? 0;
    const reframeRaw = event.substituteEvidence?.positiveReframeScore ?? 0;
    const validationSeekingScore = clamp(finiteOrZero(validationRaw), 0, 1);
    const topicShiftScore = clamp(finiteOrZero(topicShiftRaw), 0, 1);
    const positiveReframeScore = clamp(finiteOrZero(reframeRaw), 0, 1);
    if (!Number.isFinite(validationRaw) || !Number.isFinite(topicShiftRaw) || !Number.isFinite(reframeRaw)) {
      harnessTags.push("HARNESS_SANITIZED_INPUT");
    }

    const effectiveTs: number =
      previousTs === null ? tsSeconds : Math.max(previousTs, tsSeconds);
    const deltaMessageSeconds =
      previousTs === null ? 0 : Math.max(0, effectiveTs - previousTs);
    const deltaSessionSeconds = deltaMessageSeconds;

    const timeResult = updatePressureWithTime(
      pressureState.pressure,
      deltaMessageSeconds,
      deltaSessionSeconds,
      DEFAULT_BASELINE_LATENCY_SECONDS
    );
    const gain = finiteOrZero(timeResult.gainModifier);

    const pressureInputs = {
      pressureAfterDecay: timeResult.pressureAfterDecay,
      gain,
      activation: activation * (0.65 + 0.35 * expressionStrength),
      deltaMessageSeconds,
    };
    const pressureResult = updatePressureState(pressureState, pressureInputs);
    pressureState = pressureResult.state;

    const escalationInputs = {
      slope: pressureResult.outputs.slope,
      volatility: pressureResult.outputs.volatility,
      isShock: pressureResult.outputs.isShock,
      gain,
      deltaMessageSeconds,
      pressure: pressureResult.outputs.pressure,
    };
    const escalationResult = updateEscalationState(escalationState, escalationInputs);
    escalationState = escalationResult.state;

    const collapseTraceInputs = {
      escalationLevel: escalationResult.outputs.level,
      escalationScore: escalationResult.outputs.score,
      pressure: pressureResult.outputs.pressure,
      pressureSlope: pressureResult.outputs.slope,
      volatility: pressureResult.outputs.volatility,
      isShock: pressureResult.outputs.isShock,
      deltaMessageSeconds,
    };
    const collapseResult = updateCollapseState(collapseState, {
      escalationLevel: collapseTraceInputs.escalationLevel,
      escalationScore: collapseTraceInputs.escalationScore,
      pressure: collapseTraceInputs.pressure,
      pressureSlope: collapseTraceInputs.pressureSlope,
      moodCategory: chooseMood(valence, arousal),
      gain,
      deltaMessageSeconds,
      burstFlag: gain > 1,
      silenceFlag: gain < 1,
      negValenceHint: valence,
    });
    collapseState = collapseResult.state;

    const collapseDirection: PostCollapseDirection =
      collapseResult.outputs.collapseDirection === CollapseDirection.NONE
        ? "NONE"
        : collapseResult.outputs.collapseDirection;
    const postClarityInputsForTrace = {
      collapseEvent: collapseResult.outputs.collapseEvent,
      collapseDirection,
      escalationLevel: escalationResult.outputs.level,
      escalationScore: escalationResult.outputs.score,
      pressure: pressureResult.outputs.pressure,
      pressureSlope: pressureResult.outputs.slope,
      valence,
      deltaMessageSeconds,
      repetitionScore,
      gain,
      validationSeekingScore,
      topicShiftScore,
      positiveReframeScore,
    };
    const postClarityInputs: PostClarityInputs = postClarityInputsForTrace;
    const postClarityResult = updatePostClarityState(postClarityState, postClarityInputs);
    postClarityState = postClarityResult.state;

    const trace: HarnessStepTrace = {
      i,
      tsSeconds: effectiveTs,
      harnessTags,
      time: {
        deltaMessageSeconds,
        deltaSessionSeconds,
        pressureAfterDecay: timeResult.pressureAfterDecay,
        gain,
      },
      pressure: {
        inputs: pressureInputs,
        outputs: {
          pressure: pressureResult.outputs.pressure,
          deltaPressure: pressureResult.outputs.deltaPressure,
          slope: pressureResult.outputs.slope,
          volatility: pressureResult.outputs.volatility,
          isShock: pressureResult.outputs.isShock,
        },
      },
      escalation: {
        inputs: {
          slope: escalationInputs.slope,
          volatility: escalationInputs.volatility,
          isShock: escalationInputs.isShock,
          gain,
          deltaMessageSeconds,
        },
        outputs: {
          escalationLevel: escalationResult.outputs.level,
          escalationScore: escalationResult.outputs.score,
          reasons: [...escalationResult.outputs.reasons],
        },
      },
      collapse: {
        inputs: collapseTraceInputs,
        outputs: {
          collapseEvent: collapseResult.outputs.collapseEvent,
          collapseDirection: collapseResult.outputs.collapseDirection,
          reasons: [...collapseResult.outputs.reasons],
        },
      },
      postClarity: {
        inputs: postClarityInputsForTrace,
        outputs: {
          postModeActive: postClarityResult.outputs.postModeActive,
          recoveryPath: postClarityResult.outputs.recoveryPath,
          reasons: [...postClarityResult.outputs.reasons],
          agencyDeficit: postClarityResult.outputs.agencyDeficit,
        },
      },
    };

    assertFinite("time.pressureAfterDecay", trace.time.pressureAfterDecay, i);
    assertFinite("time.gain", trace.time.gain, i);
    assertFinite("pressure.pressure", trace.pressure.outputs.pressure, i);
    assertFinite("pressure.slope", trace.pressure.outputs.slope, i);
    assertFinite("pressure.volatility", trace.pressure.outputs.volatility, i);
    assertFinite("escalation.score", trace.escalation.outputs.escalationScore, i);
    assertFinite("postClarity.agencyDeficit", trace.postClarity.outputs.agencyDeficit, i);

    if (trace.pressure.outputs.pressure < 0) {
      throw new Error(`Negative pressure at step ${i}: ${trace.pressure.outputs.pressure}`);
    }
    if (
      trace.escalation.outputs.escalationScore < 0 ||
      trace.escalation.outputs.escalationScore > 1
    ) {
      throw new Error(
        `Escalation score out of bounds at step ${i}: ${trace.escalation.outputs.escalationScore}`
      );
    }
    if (
      trace.postClarity.outputs.agencyDeficit < 0 ||
      trace.postClarity.outputs.agencyDeficit > 1
    ) {
      throw new Error(
        `Agency deficit out of bounds at step ${i}: ${trace.postClarity.outputs.agencyDeficit}`
      );
    }

    steps.push(trace);
    previousTs = effectiveTs;
  }

  let maxEscLevel = 0;
  let maxEscScore = 0;
  let collapseCount = 0;
  let firstCollapseIndex: number | null = null;
  let everPostMode = false;
  let everSubstitute = false;

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (step.escalation.outputs.escalationLevel > maxEscLevel) {
      maxEscLevel = step.escalation.outputs.escalationLevel;
    }
    if (step.escalation.outputs.escalationScore > maxEscScore) {
      maxEscScore = step.escalation.outputs.escalationScore;
    }
    if (step.collapse.outputs.collapseEvent) {
      collapseCount += 1;
      if (firstCollapseIndex === null) {
        firstCollapseIndex = i;
      }
    }
    if (step.postClarity.outputs.postModeActive) {
      everPostMode = true;
    }
    if (step.postClarity.outputs.recoveryPath === "SUBSTITUTE") {
      everSubstitute = true;
    }
  }

  return {
    steps,
    summary: {
      maxEscLevel,
      maxEscScore,
      collapseCount,
      firstCollapseIndex,
      everPostMode,
      everSubstitute,
    },
  };
}
