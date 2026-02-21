# Cross-Module Stability Harness Audit

## Purpose and Isolation

This folder provides an isolated, deterministic integration stress harness for appraisal-lab engines.
It does not modify any engine code and does not import server/adapter/prompt/LLM components.

## Wiring Order

Per step, modules are called in this strict order:

1. `time-engine` (`computeTimeDeltas`, `updatePressureWithTime`)
2. `family-engine` (`classifyFamily`)
3. `vector-pressure-engine` (`updateVectorPressureState`)
4. `mood-engine` (`updateMoodState`)
5. `escalation-engine` (`updateEscalationState`)
6. `collapse-engine` (`updateCollapseState`)
7. `post-clarity-engine` (`updatePostClarityState`)
8. `intervention-policy-engine` (`deriveInterventionPolicy`)

## Scenarios

- **Suite A**: family oscillation trajectory stability over 600 steps
- **Suite B**: escalation vs substitute conflict priority integrity
- **Suite C**: 100k-step long-session stability with deterministic seeded signals
- **Suite D (TrueCritical)**: explicit hard-saturation path (critical + collapse + post-mode + substitute)
- **Hardening v0.1 micro-scenarios**: sanitization, pressure-driven collapse, long-gap, inward-collapse direction

Suite A/C now include bounded deterministic burst packets that trigger occasional escalation
without runaway critical drift, so they exercise non-trivial cross-module dynamics.

## Suite C Long-Run Stability Model

Suite C is tuned as a background-usage longevity model rather than a saturation test.

- **90% background steps**: low-noise valence in `[-0.3, 0.3]`, arousal in `[0.2, 0.6]`, low-mid expression.
- **9% moderate stress steps**: negative valence in `[-0.6, -0.3]`, arousal in `[0.6, 0.8]`.
- **1% micro-burst candidates**: high-stress profile, but hard-gated by deterministic spacing and budget.

Burst protections:

- Burst length is capped to 2-3 steps.
- Burst starts require at least 20,000 steps since the previous burst.
- Total bursts are bounded to fewer than 10 in the 100k run.

Stability budgets in tests enforce that Suite C remains a long-run background profile
while still proving occasional pipeline reactivity. True saturation behavior is isolated
to Suite D.

## Invariants Checked

- No NaN or Infinity in tracked outputs
- No negative scalar/vector pressures
- No negative timers in collapse/post-clarity states
- Pressure caps enforced (`<= 1e6`)
- Bounded collapse/critical/post-mode fractions per scenario constraints
- Recovery path and policy outputs remain consistent and finite

## Determinism Proof

- Each scenario run uses explicit seed-based deterministic PRNG only.
- A stable FNV-1a summary hash is produced from summary + sampled trace.
- Replay with same seed must produce identical summary hash and summary object.
- Different seeds are asserted to produce different summary hashes.

## Run Command

`npx jest src/appraisal-lab/cross-module-stability --coverage`
