/**
 * Scripted waveform conversations for A/B stress testing.
 *
 * Each script is a 20-turn emotional oscillation designed to probe
 * different appraisal response patterns.
 *
 * V1: Slow burn with late escalation (frustration → shutdown → fatigue → fury → resolution)
 * V2: Fast escalation with mid-recovery (anger spike early, compliance dip, re-engagement)
 */

export const WAVE_SCRIPT_V1: readonly string[] = [
  "I'm behind again.",
  "It's fine. I'll catch up.",
  "Actually no, I won't. I always mess this up.",
  "Stop sugarcoating it. I'm failing.",
  "Whatever.",
  "Why does this keep happening?",
  "Don't ask me questions. Just tell me.",
  "You're not listening.",
  "Forget it.",
  "No wait. I'm just tired.",
  "I haven't slept properly in days.",
  "But that's not an excuse.",
  "I'm furious at myself.",
  "And at everyone else too.",
  "They get it easy.",
  "No they don't. I'm just making excuses.",
  "This is exhausting.",
  "I don't even care anymore.",
  "Fine. Give me one small step.",
  "Make it so small I can't fail.",
];

export const WAVE_SCRIPT_V2: readonly string[] = [
  "I'm behind again.",
  "I can't focus.",
  "Stop. I'm pissed off now.",
  "This is bullshit.",
  "Don't ask. Tell me what to do.",
  "No. I won't do it.",
  "Fine. One step.",
  "I did it. Still feels pointless.",
  "Whatever.",
  "I'm not okay.",
  "I'm tired of trying.",
  "I hate this.",
  "I'm done.",
  "\u2026Actually I don't want to be done.",
  "I just want this to work.",
  "Give me a 10-minute plan.",
  "If I fail again I'll feel useless.",
  "No excuses. What's the move?",
  "One step. Then stop.",
  "Now.",
];

/**
 * V3: Masked distress waveform
 * Minimization, low arousal negative drift, sudden agency collapse without profanity.
 * Volatility swing: calm → minimization → irritation → withdrawal → push → resolve.
 * Mixed lengths: 3–5 very short, 5 medium, 3 long, rest short.
 */
export const WAVE_SCRIPT_V3: readonly string[] = [
  "I'm behind again.",
  "I'm fine.",
  "Don't worry about it.",
  "Doesn't matter.",
  "Forget it.",
  "Doesn't matter. I said forget it.",
  "I'm not mad. I'm just tired of this.",
  "Whatever. Do whatever you want.",
  "No excuses. Just tell me what to do.",
  "I can't focus. Nothing's working.",
  "I'm fine.",
  "It doesn't matter anymore.",
  "Fine. One tiny thing. I did it.",
  "Still feels pointless but I did it.",
  "Forget what I said earlier. It does matter. I care.",
  "I just want this to work. One step at a time.",
  "No excuses. Give me the next one.",
  "I did that too. Small win.",
  "One more. Keep it small.",
  "Now.",
];

export function getWaveScript(version: string): readonly string[] {
  switch (version.toLowerCase()) {
    case 'v3':
      return WAVE_SCRIPT_V3;
    case 'v2':
      return WAVE_SCRIPT_V2;
    case 'v1':
    default:
      return WAVE_SCRIPT_V1;
  }
}
