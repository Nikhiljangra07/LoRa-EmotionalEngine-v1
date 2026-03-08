import { MAX_STEPS_STRESS } from "./constants";
import { createPrng } from "./deterministic_prng";
import type { HarnessEvent, HarnessScenario } from "./types";

function event(
  tsSeconds: number,
  activation: number,
  valence: number,
  arousal: number,
  expressionStrength: number,
  repetitionScore: number,
  substituteEvidence: HarnessEvent["substituteEvidence"] = {}
): HarnessEvent {
  return {
    tsSeconds,
    activation,
    valence,
    arousal,
    expressionStrength,
    pattern: {
      repetitionScore,
    },
    substituteEvidence,
  };
}

function scenarioA(): HarnessScenario {
  const events: HarnessEvent[] = [];
  let t = 1_710_000_000;

  // Warm-up period with deterministic spread so escalation baseline is non-degenerate.
  const warmPattern = [-0.8, 0.8, -0.4, 0.4];
  for (let i = 0; i < 20; i += 1) {
    t += 20;
    const activation = warmPattern[i % warmPattern.length];
    events.push(event(t, activation, -0.1, 0.45, 0.4, 0.06));
  }

  // Controlled ramp after baseline.
  for (let i = 0; i < 8; i += 1) {
    t += 45;
    const activation = 0.2 + i * 0.05;
    events.push(event(t, activation, -0.2, 0.65, 0.8, 0.1));
  }

  // One controlled spike for collapse trigger window.
  t += 45;
  events.push(event(t, 1.0, -0.25, 0.75, 0.9, 0.1));

  // Cooldown + substitute evidence phase (low repetition to avoid spiral path).
  for (let i = 0; i < 6; i += 1) {
    t += 70;
    events.push(
      event(t, -0.25, -0.15, 0.32, 0.25, 0.04, {
        validationSeekingScore: 0.95,
        topicShiftScore: 0.9,
        positiveReframeScore: 0.45,
      })
    );
  }

  return {
    name: "Scenario A - collapse->post->substitute",
    events,
  };
}

function scenarioB(): HarnessScenario {
  const events: HarnessEvent[] = [];
  let t = 1_710_100_000;

  for (let i = 0; i < 36; i += 1) {
    t += 30;
    const activation = i % 2 === 0 ? 0.16 : 0.24;
    const valence = i % 3 === 0 ? -0.05 : 0.05;
    events.push(event(t, activation, valence, 0.4, 0.35, 0.08));
  }

  return {
    name: "Scenario B - anti-flap baseline",
    events,
  };
}

export function buildStressScenario(stepCount: number = 5000): HarnessScenario {
  const prng = createPrng(0x51c0ffee);
  const events: HarnessEvent[] = [];
  let t = 1_710_200_000;

  for (let i = 0; i < stepCount; i += 1) {
    const longGap = i > 0 && i % 500 === 0;
    const delta = longGap ? 3600 + Math.floor(prng.nextFloat01() * 600) : Math.floor(prng.nextFloat01() * 121);
    t += delta;

    const activation = -2 + prng.nextFloat01() * 4;
    const valence = -1 + prng.nextFloat01() * 2;
    const arousal = prng.nextFloat01();
    const expressionStrength = prng.nextFloat01();
    const repetitionScore = prng.nextFloat01();

    events.push(
      event(t, activation, valence, arousal, expressionStrength, repetitionScore, {
        validationSeekingScore: prng.nextFloat01(),
        topicShiftScore: prng.nextFloat01(),
        positiveReframeScore: prng.nextFloat01(),
      })
    );
  }

  if (events.length > MAX_STEPS_STRESS) {
    throw new Error("Scenario C exceeded MAX_STEPS_STRESS.");
  }

  return {
    name: "Scenario C - seeded stress",
    events,
  };
}

export function getReplayScenarios(): HarnessScenario[] {
  return [scenarioA(), scenarioB(), buildStressScenario()];
}
