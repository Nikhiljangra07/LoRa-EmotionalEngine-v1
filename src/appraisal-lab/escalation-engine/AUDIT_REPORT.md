# Escalation Engine Controlled Spike Audit

## What changed

- Updated risk composition from competing channels to additive shock amplification:
  - Before: `r = max(zSlopePos, ALPHA_V * zVolPos, shockBoost)`
  - After:
    - `baseRisk = max(zSlopePos, ALPHA_V * zVolPos)`
    - `rRaw = baseRisk + shockBoost`
    - `rSpikeCapped = min(rRaw, Z_CRIT * R_CRIT_CAP_MULT)`
    - `r = clamp(rSpikeCapped, 0, R_MAX)`
    - `score = clamp01(r / Z_CRIT)`
- Warmup freeze, finite guards, and reason tags remain intact.

## Constant added

- `R_CRIT_CAP_MULT = 1.2`
  - Purpose: cap instantaneous post-shock risk near critical to prevent absurd one-message overshoot while preserving true critical behavior.

## Test command and results

- Command run:
  - `npm test -- src/appraisal-lab/escalation-engine`
- Result:
  - Test Suites: 4 passed, 4 total
  - Tests: 12 passed, 12 total
  - Snapshots: 0 total

## Key evidence

- Controlled shock does not saturate score:
  - `escalation_engine.controlled_spike.audit.test.ts` scenario B reports:
    - `maxScore = 0.8571428571428571`
    - `hitCritical = false`
- True critical can still saturate:
  - `escalation_engine.controlled_spike.audit.test.ts` scenario C reports:
    - `maxScore = 1`
    - `saturated = true`
- Stress suite passes and saturation is rare:
  - `escalation_engine.stress.test.ts` enforces saturation-rate guard on 30-day deterministic run:
    - `score === 1` rate `<= 1%`
