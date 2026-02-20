# Vector Pressure Engine Audit Report

## Purpose

`vector-pressure-engine` accumulates per-family pressure as a deterministic vector update process. It consumes only structured numeric inputs and returns updated state plus output metrics.

## Isolation guarantees

- No imports from `pressure-engine`, `escalation-engine`, `family-engine`, or `time-engine`.
- No external dependencies.
- No side effects, IO, timers, or randomness.

## Shock logic definition

- Shock is based on positive weight-shift only:
  - `deltaW[f] = familyWeights[f] - prevWeights[f]`
  - if `max(deltaW) > SHOCK_W_THRESHOLD`, apply impulse to argmax family:
    - `impulse = (maxDeltaW - SHOCK_W_THRESHOLD) * SHOCK_W_GAIN`
- Post-shock pressure is clamped to safe range.

## Finite guards

- Non-finite weights/pressures become zero.
- `confidence` is clamped to `[0,1]`.
- `gain` is clamped to `>= 0`.
- All per-family pressures are clamped to `[0, R_MAX]`.
- Total pressure and volatility include finite guards.

## Determinism proof

- All logic is pure arithmetic with deterministic tie-break order.
- Dominant family tie-break is fixed:
  - `JOY > ANGER > FEAR > SADNESS > SURPRISE > DISGUST`
- Determinism scenario test replays identical input sequence and asserts exact state equality.

## Stress test summary

- 50,000 deterministic updates using seeded LCG PRNG.
- Assertions cover:
  - no NaN/Infinity
  - non-negative pressure
  - pressure bounded by `R_MAX`
  - finite volatility
  - dominant family always defined

## No cross-module contamination

- Module remains fully isolated to `src/appraisal-lab/vector-pressure-engine/**`.
