import type { RuntimeScenario, RuntimeMessage } from './runtimeTypes';
import type { EncoderInput } from './types';

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const BASE_TS = 1_700_000_000_000;
const STEP = 60_000;

function msg(
  idx: number,
  prefix: string,
  tsBase: number,
  enc: EncoderInput,
): RuntimeMessage {
  const ts = tsBase + idx * STEP;
  return {
    messageId: `${prefix}_m${idx}`,
    tsMs: ts,
    input: {
      encoderInput: enc,
      eventId: `${prefix}_e${idx}`,
      timestampMs: ts,
    },
  };
}

// ---------------------------------------------------------------------------
// 1) calmStable – low avi, moderate eiv, CONTENTMENT-dominated
//    Salience baseline: 0.60*0.35 + 0.40*0.10 = 0.25 → shouldWrite
//    Similar vectors → ≥1 schema after consolidation
// ---------------------------------------------------------------------------

export const calmStable: RuntimeScenario = {
  name: 'calmStable',
  userId: 'calm-user',
  sessionId: 'sess-calm-1',
  nowMs: BASE_TS,
  endSessionAtMs: BASE_TS + 9 * STEP,
  messages: [
    msg(0, 'cs', BASE_TS, { eivValue: 0.35, avi: 0.10, valenceScore: 0.30, arousalScore: 0.20, expressionStrength: 0.3, dominantEmotion: 'CONTENTMENT' }),
    msg(1, 'cs', BASE_TS, { eivValue: 0.30, avi: 0.12, valenceScore: 0.25, arousalScore: 0.18, expressionStrength: 0.25, dominantEmotion: 'CONTENTMENT' }),
    msg(2, 'cs', BASE_TS, { eivValue: 0.33, avi: 0.11, valenceScore: 0.28, arousalScore: 0.19, expressionStrength: 0.28, dominantEmotion: 'CONTENTMENT' }),
    msg(3, 'cs', BASE_TS, { eivValue: 0.32, avi: 0.10, valenceScore: 0.30, arousalScore: 0.20, expressionStrength: 0.30, dominantEmotion: 'CONTENTMENT' }),
    msg(4, 'cs', BASE_TS, { eivValue: 0.34, avi: 0.13, valenceScore: 0.27, arousalScore: 0.17, expressionStrength: 0.27, dominantEmotion: 'CONTENTMENT' }),
    msg(5, 'cs', BASE_TS, {
      eivValue: 0.31, avi: 0.10, valenceScore: 0.29, arousalScore: 0.19, expressionStrength: 0.29, dominantEmotion: 'CONTENTMENT',
      appraisalBridgeEnabled: true, pressureScalar: 5, pressureSlope: 2, moodDominance: 0.3,
    }),
    msg(6, 'cs', BASE_TS, { eivValue: 0.33, avi: 0.11, valenceScore: 0.26, arousalScore: 0.16, expressionStrength: 0.26, dominantEmotion: 'CONTENTMENT' }),
    msg(7, 'cs', BASE_TS, { eivValue: 0.35, avi: 0.12, valenceScore: 0.30, arousalScore: 0.20, expressionStrength: 0.30, dominantEmotion: 'CONTENTMENT' }),
  ],
};

// ---------------------------------------------------------------------------
// 2) volatileModerate – alternating JOY / ANGER with very different signals
//    JOY: high valence, high expression, low arousal, low avi
//    ANGER: neg valence, low expression, high arousal, high avi
//    Cosine between clusters < 0.65 → ≥2 schemas after consolidation
// ---------------------------------------------------------------------------

export const volatileModerate: RuntimeScenario = {
  name: 'volatileModerate',
  userId: 'volatile-user',
  sessionId: 'sess-vol-1',
  nowMs: BASE_TS,
  endSessionAtMs: BASE_TS + 9 * STEP,
  messages: [
    msg(0, 'vm', BASE_TS, { eivValue: 0.30, avi: 0.10, valenceScore: 0.70, arousalScore: 0.20, expressionStrength: 0.80, dominantEmotion: 'JOY' }),
    msg(1, 'vm', BASE_TS, { eivValue: 0.60, avi: 0.65, valenceScore: -0.70, arousalScore: 0.90, expressionStrength: 0.10, dominantEmotion: 'ANGER' }),
    msg(2, 'vm', BASE_TS, { eivValue: 0.28, avi: 0.08, valenceScore: 0.75, arousalScore: 0.15, expressionStrength: 0.85, dominantEmotion: 'JOY' }),
    msg(3, 'vm', BASE_TS, { eivValue: 0.55, avi: 0.60, valenceScore: -0.75, arousalScore: 0.85, expressionStrength: 0.05, dominantEmotion: 'ANGER' }),
    msg(4, 'vm', BASE_TS, { eivValue: 0.32, avi: 0.12, valenceScore: 0.68, arousalScore: 0.22, expressionStrength: 0.78, dominantEmotion: 'JOY' }),
    msg(5, 'vm', BASE_TS, {
      eivValue: 0.58, avi: 0.62, valenceScore: -0.72, arousalScore: 0.88, expressionStrength: 0.08, dominantEmotion: 'ANGER',
      appraisalBridgeEnabled: true, pressureScalar: 40, pressureSlope: 20, escalationScore: 0.6,
    }),
    msg(6, 'vm', BASE_TS, { eivValue: 0.29, avi: 0.09, valenceScore: 0.72, arousalScore: 0.18, expressionStrength: 0.82, dominantEmotion: 'JOY' }),
    msg(7, 'vm', BASE_TS, { eivValue: 0.62, avi: 0.68, valenceScore: -0.78, arousalScore: 0.92, expressionStrength: 0.12, dominantEmotion: 'ANGER' }),
  ],
};

// ---------------------------------------------------------------------------
// 3) intenseStable – high eiv, low avi, ANGER consistently
//    Salience baseline: 0.60*0.80 + 0.40*0.10 = 0.52 → shouldWrite
//    Similar vectors → 1 schema
// ---------------------------------------------------------------------------

export const intenseStable: RuntimeScenario = {
  name: 'intenseStable',
  userId: 'intense-user',
  sessionId: 'sess-int-1',
  nowMs: BASE_TS,
  endSessionAtMs: BASE_TS + 9 * STEP,
  messages: [
    msg(0, 'is', BASE_TS, { eivValue: 0.80, avi: 0.10, valenceScore: -0.70, arousalScore: 0.80, expressionStrength: 0.60, dominantEmotion: 'ANGER' }),
    msg(1, 'is', BASE_TS, { eivValue: 0.85, avi: 0.08, valenceScore: -0.65, arousalScore: 0.82, expressionStrength: 0.55, dominantEmotion: 'ANGER' }),
    msg(2, 'is', BASE_TS, { eivValue: 0.82, avi: 0.12, valenceScore: -0.72, arousalScore: 0.78, expressionStrength: 0.58, dominantEmotion: 'ANGER' }),
    msg(3, 'is', BASE_TS, { eivValue: 0.78, avi: 0.09, valenceScore: -0.68, arousalScore: 0.83, expressionStrength: 0.62, dominantEmotion: 'ANGER' }),
    msg(4, 'is', BASE_TS, { eivValue: 0.83, avi: 0.11, valenceScore: -0.71, arousalScore: 0.79, expressionStrength: 0.57, dominantEmotion: 'ANGER' }),
    msg(5, 'is', BASE_TS, {
      eivValue: 0.81, avi: 0.10, valenceScore: -0.69, arousalScore: 0.81, expressionStrength: 0.59, dominantEmotion: 'ANGER',
      appraisalBridgeEnabled: true, pressureScalar: 60, pressureSlope: -10, escalationScore: 0.8, moodDominance: 0.7,
    }),
    msg(6, 'is', BASE_TS, { eivValue: 0.84, avi: 0.10, valenceScore: -0.73, arousalScore: 0.85, expressionStrength: 0.61, dominantEmotion: 'ANGER' }),
    msg(7, 'is', BASE_TS, { eivValue: 0.79, avi: 0.09, valenceScore: -0.67, arousalScore: 0.80, expressionStrength: 0.56, dominantEmotion: 'ANGER' }),
  ],
};

// ---------------------------------------------------------------------------
// 4) violationSpike – high eiv spikes that force episodic writes
//    Some messages have very high eiv (>= 0.90) → salience well above floor
//    Some messages have very low eiv/avi → below floor, no write
//    FEAR-dominated theme
// ---------------------------------------------------------------------------

export const violationSpike: RuntimeScenario = {
  name: 'violationSpike',
  userId: 'spike-user',
  sessionId: 'sess-spike-1',
  nowMs: BASE_TS,
  endSessionAtMs: BASE_TS + 9 * STEP,
  messages: [
    msg(0, 'vs', BASE_TS, { eivValue: 0.01, avi: 0.01, valenceScore: 0.0, arousalScore: 0.05, dominantEmotion: 'NEUTRAL' }),
    msg(1, 'vs', BASE_TS, { eivValue: 0.95, avi: 0.30, valenceScore: -0.80, arousalScore: 0.90, expressionStrength: 0.70, dominantEmotion: 'FEAR' }),
    msg(2, 'vs', BASE_TS, { eivValue: 0.02, avi: 0.02, valenceScore: 0.0, arousalScore: 0.03, dominantEmotion: 'NEUTRAL' }),
    msg(3, 'vs', BASE_TS, { eivValue: 0.92, avi: 0.28, valenceScore: -0.85, arousalScore: 0.92, expressionStrength: 0.75, dominantEmotion: 'FEAR' }),
    msg(4, 'vs', BASE_TS, { eivValue: 0.01, avi: 0.01, valenceScore: 0.0, arousalScore: 0.02, dominantEmotion: 'NEUTRAL' }),
    msg(5, 'vs', BASE_TS, {
      eivValue: 0.90, avi: 0.35, valenceScore: -0.78, arousalScore: 0.88, expressionStrength: 0.68, dominantEmotion: 'FEAR',
      appraisalBridgeEnabled: true, pressureScalar: 80, pressureSlope: 30, escalationScore: 0.9, collapseSeverity: 0.4,
    }),
    msg(6, 'vs', BASE_TS, { eivValue: 0.02, avi: 0.01, valenceScore: 0.0, arousalScore: 0.04, dominantEmotion: 'NEUTRAL' }),
    msg(7, 'vs', BASE_TS, { eivValue: 0.93, avi: 0.32, valenceScore: -0.82, arousalScore: 0.91, expressionStrength: 0.72, dominantEmotion: 'FEAR' }),
  ],
};
