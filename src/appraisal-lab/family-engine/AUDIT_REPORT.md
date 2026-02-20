# Family Engine v0 Audit Report

## Purpose

`family-engine` is an isolated lab-only TypeScript module that maps appraisal-layer inputs to Ekman 6 family soft weights:

- `JOY`
- `ANGER`
- `FEAR`
- `SADNESS`
- `SURPRISE`
- `DISGUST`

It is deterministic and auditable, with no adapter/runtime integration and no side effects.

## v0 Limitations

- Uses transparent rule-based piecewise formulas (no learned nuance).
- Mood priming is currently a no-op stub.
- Pattern signals are conservative nudges, not primary drivers.
- `emojiHits` intentionally has minimal effect in v0.

## Public API

- `classifyFamily(inputs: FamilyInputs): FamilyOutputs`
- `applyMoodPriming(weights: FamilyVector, mood?: MoodCategory): FamilyVector` (no-op in v0)
- Re-exported constants and all exported types from this module.

## Invariants

- Input sanitization:
  - non-finite numeric inputs become `0`
  - large magnitudes are clamped to `[-1e6, 1e6]`
  - canonical ranges:
    - `valence` -> `[-1, 1]`
    - `arousal` -> `[0, 1]`
    - `expressionStrength` -> `[0, 1]`
    - `capsRatio` -> `[0, 1]`
    - count-like pattern signals -> `>= 0`
- Output invariants:
  - every family weight is finite and in `[0, 1]`
  - normalized sum is approximately `1`
  - `confidence` is finite and in `[0, 1]`
  - deterministic dominant-family tie break order.

## Fallback Behavior

If total raw score is near zero (`<= EPS`), classifier returns:

- `SURPRISE = 1`
- all other weights `0`
- `dominantFamily = SURPRISE`
- `confidence = 0`
- `reasons = ["FALLBACK_NO_SIGNAL"]`

## Test Coverage

Run:

`npm test -- src/appraisal-lab/family-engine`

Covered areas:

- Scenario tests:
  - positive high-arousal joy
  - negative low-arousal sadness
  - negative high-arousal anger with caps/punctuation pressure
  - fear emphasis with heavy question marks
  - neutral high-arousal surprise
  - zero-input fallback path
- Stress tests:
  - 50,000 deterministic generated inputs (including non-finite injection)
  - invariant checks for normalization and finite outputs
  - 5,000-step deterministic replay equality check at `1e-9` rounding

## Safety / Dependency Notes

- No external dependencies introduced.
- Only TypeScript/Node standard behavior used.
- No filesystem/network/time side effects in module logic.
