# Integration Harness Audit Report

## Wired Modules

The harness wires only:
- `time-engine` via `updatePressureWithTime`
- `pressure-engine` via `createPressureState` / `updatePressureState`
- `escalation-engine` via `createEscalationState` / `updateEscalationState`
- `collapse-engine` via `createCollapseState` / `updateCollapseState`
- `post-clarity-engine` via `createPostClarityState` / `updatePostClarityState`

No server, prompt, adapter, or LLM imports are used.

## Enforced Invariants

Each replay step enforces:
- finite numeric outputs on time/pressure/escalation/post-clarity
- `pressure >= 0`
- `escalationScore` in `[0, 1]`
- `agencyDeficit` in `[0, 1]`

Non-finite scenario inputs are sanitized at the harness boundary and tagged with
`HARNESS_SANITIZED_INPUT`.

## Scenario A Causal Guarantees

Scenario A is constrained to:
- produce exactly one collapse event
- show escalation rise before the first collapse (`level >= 1` or `score >= 0.5`)
- activate post-mode shortly after collapse
- reach `SUBSTITUTE` only while post-mode is active

If collapse can trigger while escalation remains CALM, that indicates pressure-only
collapse behavior in collapse-engine. This harness fails Scenario A unless that is
explicitly proven in traces and documented.

## Determinism Guarantee

- All scenarios are deterministic and timestamp-driven.
- Stress scenario uses a seeded LCG PRNG (`createPrng`) and no `Math.random` / `Date.now`.
- Replay is validated by repeated-run equality checks over summary and step outputs.

## Command

`npx jest src/appraisal-lab/integration-harness --coverage`
