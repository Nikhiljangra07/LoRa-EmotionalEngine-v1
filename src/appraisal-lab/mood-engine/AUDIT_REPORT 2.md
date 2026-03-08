# Mood Engine v0 Audit Report

## Purpose and Placement (Layer D)

`mood-engine` is a lab-only, isolated Layer D observer that transforms per-message family weights and pressure vectors into a slow-changing mood state.

## Input / Output Contract

- Inputs (`MoodInputs`): family-weight vector, pressure vector, delta seconds, optional escalation level, optional shock flag.
- Outputs (`MoodOutputs`): mood category, normalized mood vector, dominance, confidence, and auditable reason tags.

## Invariants

- Deterministic only: no randomness, no time calls, no external services.
- Finite-only behavior: all inputs sanitized via finite guards; all outputs are finite.
- Boundary clamping only: non-negative and `[0,1]` clamps at output boundaries.
- Normalized mood vector: sums to `1` in all cases (including weak-signal neutral fallback).
- Isolation: no imports from any other module.

## Constants and Meaning

- `PRESSURE_NORM = 10`: pressure scaling before drive clamp.
- `TAU_MOOD_SECONDS = 21600`: slow EMA time constant (6h).
- `MOOD_MIN_SIGNAL = 0.05`: weak-signal threshold for neutral fallback.
- `CONF_SCALE = 2.0`: conservative confidence scaling from top gap.
- `SWITCH_ON_DOM = 0.45`: minimum top dominance to allow switch.
- `SWITCH_ON_GAP = 0.10`: minimum top-two gap to allow switch.
- `MOOD_COOLDOWN_SECONDS = 600`: post-switch anti-flap cooldown.
- `FORCE_SWITCH_DOM = 0.70`: override threshold during cooldown.
- `EPS = 1e-6`: numeric safety epsilon.

## Test Command and Coverage

Run:

`npm test -- src/appraisal-lab/mood-engine`

Suites cover:

- neutral start behavior
- sustained positive accumulation
- anti-flap hysteresis behavior
- forced switching under sustained opposing signal
- cooldown gate behavior
- non-finite guard handling
- 50k deterministic stress updates with normalization and enum validity checks

## No Cross-Module Contamination

No imports from other modules; lab-only.
