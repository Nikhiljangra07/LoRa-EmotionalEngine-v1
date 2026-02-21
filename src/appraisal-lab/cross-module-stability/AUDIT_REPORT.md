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
- **Hardening v0.1 micro-scenarios**: sanitization, pressure-driven collapse, long-gap, inward-collapse direction

Suite A/C now include bounded deterministic burst packets that trigger occasional escalation
without runaway critical drift, so they exercise non-trivial cross-module dynamics.

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
