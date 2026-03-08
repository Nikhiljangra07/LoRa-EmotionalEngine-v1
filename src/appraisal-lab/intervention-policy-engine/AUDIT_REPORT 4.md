# Intervention Policy Engine - Pass 4 Audit Report

## Scope

This engine converts appraisal-state signals into deterministic policy constraints.
It does not generate text, perform I/O, or mutate external state.

## Guarantees

- Pure function only: `deriveInterventionPolicy(input) -> policy`
- Deterministic output for identical input
- No side effects
- No randomness / no timers
- No dependency on server, adapters, prompt builders, or LLM pipeline

## Priority Order

Evaluation is ordered and mutually exclusive:

1. Collapse event
2. Post-mode spiral
3. Post-mode substitute
4. Escalation critical
5. Escalation rising
6. Baseline

Additional overlay rule:
- If `postModeActive` and `agencyDeficit >= AGENCY_HIGH`, add `RESTORE_AGENCY`.

## Integration Safety

The engine emits pure policy data structures only, so it is safe to integrate with
`PromptProfileBuilder` without changing builder behavior or state management.

## Test Command

`npx jest src/appraisal-lab/intervention-policy-engine --coverage`
