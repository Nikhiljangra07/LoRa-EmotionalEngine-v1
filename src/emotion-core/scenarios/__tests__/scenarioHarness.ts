/**
 * Scenario test harness.
 *
 * Re-exports coherence harness utilities and adds scenario-specific helpers
 * for building multi-phase conversational narratives.
 */

export {
  makeAppraisalResult,
  clearFlags,
  saveEnv,
  restoreEnv,
  runSequence,
  countTransitions,
  extractMarkers,
  countMarkers,
  loadModules,
  APPRAISAL_FORBIDDEN_KEYS,
  type MockAppraisalOverrides,
  type StepSpec,
  type CapturedStep,
} from '../../coherence/__tests__/coherenceHarness';

// ── Emotional state presets ──────────────────────────────────────────

export const LOW_NEUTRAL = {
  dominant: 'NEUTRAL' as const,
  arousal: 'LOW' as const,
  valence: 'NEUTRAL' as const,
  confidence: 0.5,
};

export const HIGH_NEGATIVE = {
  dominant: 'ANGER' as const,
  arousal: 'HIGH' as const,
  valence: 'NEGATIVE' as const,
  confidence: 0.9,
};

export const MEDIUM_NEGATIVE = {
  dominant: 'SADNESS' as const,
  arousal: 'MEDIUM' as const,
  valence: 'NEGATIVE' as const,
  confidence: 0.7,
};

// ── Flag preset ──────────────────────────────────────────────────────

import { clearFlags } from '../../coherence/__tests__/coherenceHarness';

export function setScenarioAdaptiveOn(): void {
  clearFlags();
  process.env.LORA_APPRAISAL_BRIDGE = '1';
  process.env.LORA_APPRAISAL_BRIDGE_MODE = '1';
  process.env.LORA_APPRAISAL_PACING_HINT = '1';
  process.env.LORA_APPRAISAL_TONE_HINT = '1';
  process.env.LORA_VALIDATION_INTENSITY = '1';
  process.env.LORA_INTERVENTION_VALIDATION_HINT = '1';
  process.env.LORA_INTERVENTION_PACING_HINT = '1';
  process.env.LORA_INTERVENTION_TONE_HINT = '1';
  process.env.LORA_INTERVENTION_ACTION_HINT = '1';
  process.env.LORA_INTERVENTION_INTERRUPT_HINT = '1';
  process.env.LORA_INTERVENTION_STEP_HINT = '1';
  process.env.LORA_INTERVENTION_QUESTION_BUDGET = '1';
  process.env.LORA_ADAPTIVE_OVERRIDE_COOLDOWN = '1';
  process.env.LORA_DRIFT_MONITOR = '1';
}

// ── Step builders ────────────────────────────────────────────────────

import type { StepSpec, MockAppraisalOverrides } from '../../coherence/__tests__/coherenceHarness';

export function warmUp(n = 2): StepSpec[] {
  return Array.from({ length: n }, () => ({
    text: 'hello',
    emotionalOverride: LOW_NEUTRAL,
  }));
}

export function phase(
  n: number,
  overrides: MockAppraisalOverrides,
  emotional: StepSpec['emotionalOverride'] = LOW_NEUTRAL,
  text = 'test',
): StepSpec[] {
  return Array.from({ length: n }, () => ({
    text,
    appraisalOverrides: overrides,
    emotionalOverride: emotional,
  }));
}

export function calmPhase(n: number, text = 'things are fine'): StepSpec[] {
  return phase(n, {}, LOW_NEUTRAL, text);
}

// ── Step function builder ────────────────────────────────────────────

import { makeAppraisalResult, extractMarkers as _extractMarkers } from '../../coherence/__tests__/coherenceHarness';

export function buildStepFn(steps: StepSpec[]) {
  let idx = 0;
  return jest.fn(() => {
    const spec = steps[idx] ?? steps[steps.length - 1];
    idx++;
    return makeAppraisalResult(spec.appraisalOverrides);
  });
}

// ── Assertion helpers ────────────────────────────────────────────────

import type { CapturedStep } from '../../coherence/__tests__/coherenceHarness';

export function guidanceModes(results: CapturedStep[]): string[] {
  return results.map((r) => r.payload.promptProfile?.guidanceMode ?? 'UNKNOWN');
}

export function activeSteps(results: CapturedStep[]): CapturedStep[] {
  return results.slice(2);
}

export function markerDensityBelow(results: CapturedStep[], maxMarkers: number, minPct: number): boolean {
  const active = activeSteps(results);
  if (active.length === 0) return true;
  const below = active.filter((s) => _extractMarkers(s.prompt).length <= maxMarkers).length;
  return below / active.length >= minPct;
}

export {};
