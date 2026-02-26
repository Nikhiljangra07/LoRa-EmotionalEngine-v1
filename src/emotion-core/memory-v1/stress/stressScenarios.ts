import type { DominantEmotion, EncoderInput } from '../types';
import type { StressSession, StressMessage, BandSchedule } from './stressTypes';

// ---------------------------------------------------------------------------
// Seeded PRNG (deterministic, no external deps)
// ---------------------------------------------------------------------------

function createRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) / 0x100000000);
  };
}

// ---------------------------------------------------------------------------
// Regime builders
// ---------------------------------------------------------------------------

const MSGS_PER_SESSION = 50;

function regimeA(_sessionIdx: number): StressMessage[] {
  const msgs: StressMessage[] = [];
  for (let i = 0; i < MSGS_PER_SESSION; i++) {
    const t = i / MSGS_PER_SESSION;
    msgs.push({
      dominant: 'CONTENTMENT',
      encoderInput: {
        eivValue: 0.3 + t * 0.05,
        valenceScore: 0.2 + t * 0.02,
        arousalScore: 0.15 + t * 0.01,
        expressionStrength: 0.3,
        dominantEmotion: 'CONTENTMENT',
        avi: 0.2,
        valenceBias: 0.05,
        arousalBias: 0.02,
        momentumConfidence: 0.5 + t * 0.1,
      },
    });
  }
  return msgs;
}

function regimeB(_sessionIdx: number): StressMessage[] {
  const msgs: StressMessage[] = [];
  const emotions: DominantEmotion[] = ['JOY', 'ANGER'];
  for (let i = 0; i < MSGS_PER_SESSION; i++) {
    const dom = emotions[i % 2];
    const isJoy = dom === 'JOY';
    msgs.push({
      dominant: dom,
      encoderInput: {
        eivValue: isJoy ? 0.7 : 0.85,
        valenceScore: isJoy ? 0.6 : -0.7,
        arousalScore: 0.8,
        expressionStrength: 0.85,
        dominantEmotion: dom,
        avi: 0.6,
        valenceBias: isJoy ? 0.3 : -0.3,
        arousalBias: 0.4,
        momentumConfidence: 0.3,
      },
    });
  }
  return msgs;
}

function regimeC(sessionIdx: number): StressMessage[] {
  const msgs: StressMessage[] = [];
  for (let i = 0; i < MSGS_PER_SESSION; i++) {
    const isFearSpike = (i % 12 === 7);
    const dom: DominantEmotion = isFearSpike ? 'FEAR' : 'NEUTRAL';
    msgs.push({
      dominant: dom,
      encoderInput: {
        eivValue: isFearSpike ? 0.9 : 0.25,
        valenceScore: isFearSpike ? -0.8 : 0.05,
        arousalScore: isFearSpike ? 0.85 : 0.15,
        expressionStrength: isFearSpike ? 0.9 : 0.2,
        dominantEmotion: dom,
        avi: isFearSpike ? 0.7 : 0.15,
        valenceBias: isFearSpike ? -0.4 : 0.0,
        arousalBias: isFearSpike ? 0.5 : 0.0,
        momentumConfidence: 0.4 + (sessionIdx * 0.01),
      },
    });
  }
  return msgs;
}

function regimeD(sessionIdx: number, rng: () => number): StressMessage[] {
  const emotions: DominantEmotion[] = ['JOY', 'SADNESS', 'ANGER', 'FEAR', 'CONTENTMENT', 'NEUTRAL'];
  const msgs: StressMessage[] = [];
  for (let i = 0; i < MSGS_PER_SESSION; i++) {
    const dom = emotions[Math.floor(rng() * emotions.length)];
    const v = rng() * 2 - 1;
    const a = rng();
    msgs.push({
      dominant: dom,
      encoderInput: {
        eivValue: 0.1 + rng() * 0.8,
        valenceScore: v,
        arousalScore: a,
        expressionStrength: 0.1 + rng() * 0.8,
        dominantEmotion: dom,
        avi: rng() * 0.7,
        valenceBias: (rng() - 0.5) * 0.4,
        arousalBias: (rng() - 0.5) * 0.3,
        momentumConfidence: 0.2 + rng() * 0.6,
      },
    });
  }
  return msgs;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const TOTAL_SESSIONS = 20;

export function defaultBandSchedule(): BandSchedule {
  const schedule: BandSchedule = [];
  for (let s = 0; s < TOTAL_SESSIONS; s++) {
    let band: 'B0' | 'B1' | 'B2' | 'B3' | 'B4';
    if (s <= 2) band = 'B1';
    else if (s <= 8) band = 'B2';
    else if (s <= 15) band = 'B3';
    else band = 'B4';
    schedule.push({ sessionIndex: s, band });
  }
  return schedule;
}

export function generateStressSessions(seed: number): StressSession[] {
  const rng = createRng(seed);
  const sessions: StressSession[] = [];

  for (let s = 0; s < TOTAL_SESSIONS; s++) {
    let regime: string;
    let messages: StressMessage[];

    if (s < 5) {
      regime = 'A-calm';
      messages = regimeA(s);
    } else if (s < 10) {
      regime = 'B-volatile';
      messages = regimeB(s);
    } else if (s < 15) {
      regime = 'C-collapse';
      messages = regimeC(s);
    } else {
      regime = 'D-mixed';
      messages = regimeD(s, rng);
    }

    sessions.push({ sessionIndex: s, regime, messages });
  }

  return sessions;
}
