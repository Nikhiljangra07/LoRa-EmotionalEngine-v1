# Post Clarity Engine - Pass 1 Audit Report

## Purpose

This module implements **Pass 1 only** for isolated post-clarity state handling:
- Trigger detection for post-mode entry
- Agency deficit EMA update
- Relapse extension behavior

Excluded in Pass 1:
- Spiral classification
- Substitute classification
- Policy outputs

## Trigger Rules (Explicit)

`trigger = true` iff any condition below is true:

1. `collapseEvent == true`
2. `escalationLevel == 3 AND escalationScore >= 0.92`
3. `pressure >= 12.0 AND pressureSlope > 0`

Otherwise `trigger = false`.

## EMA Formula

Sanitized values are used first.

- `decayFactor = exp(-deltaMessageSeconds / 21600)`
- `impulseRaw = 0.5*sevEsc + 0.3*sevP + 0.2*sevSlope + 0.2*negValenceWeight`
- `impulse = clamp01(impulseRaw)`
- `agencyDeficit_next = clamp01(agencyDeficit_prev * decayFactor + (trigger ? impulse : 0))`

Where:
- `sevEsc = escalationScore`
- `sevP = clamp01(pressure / 12.0)`
- `sevSlope = clamp01(pressureSlope / 0.15)`
- `negValenceWeight = max(0, -valence)`

## Window Extension Logic

Timers are reduced by `deltaMessageSeconds` first:
- `postModeUntilSeconds = max(0, postModeUntilSeconds - deltaMessageSeconds)`

If `trigger`:
- If `postModeUntilSeconds > 0`:
  - `isRelapse = true`
  - `relapseCount += 1`
  - `postModeUntilSeconds = min(7200, postModeUntilSeconds + 900)`
- Else:
  - `postModeUntilSeconds = 2700`

`postModeActive = postModeUntilSeconds > 0`

## Invariants

Maintained on every update:
- `agencyDeficit` is clamped to `[0, 1]`
- `postModeUntilSeconds >= 0`
- `cooldownSeconds >= 0`
- Finite sanitization avoids NaN/Infinity propagation
- Deterministic behavior under deterministic input stream

## Test Command

`npm test -- src/appraisal-lab/post-clarity-engine`

## Pass 2 - Spiral Classifier

Pass 2 extends this isolated module with spiral-path evidence while keeping substitute logic unimplemented.

### Decay Formula

- `decaySpiral = exp(-deltaMessageSeconds / 1200)`
- `spiralScore_next = clamp01(spiralScore_prev * decaySpiral + spiralImpulse)`

### Impulse Formula

Inputs are sanitized first:
- `rep = clamp01(repetitionScore ?? 0)`
- `gain = max(0, finiteOrZero(gain ?? 1))`

Condition-gated impulses:
- `repImpulse = rep` only if `rep > 0.6`, else `0`
- `urgencyImpulse = clamp01(gain - 1)` only if `gain >= 1.15`, else `0`
- `slopeImpulse = clamp01(pressureSlope / 0.2)` only if `pressureSlope > 0 AND postModeUntilSeconds > 0`, else `0`

Combined impulse:
- `spiralImpulseRaw = 0.5*repImpulse + 0.3*urgencyImpulse + 0.2*slopeImpulse`
- `spiralImpulse = clamp01(spiralImpulseRaw)`

### Threshold Rule

- `recoveryPath = "SPIRAL"` iff `spiralScore >= 0.65 AND postModeUntilSeconds > 0`
- Else `recoveryPath = "UNKNOWN"`
- `"SPIRAL_ACTIVE"` reason is emitted only when spiral path is active.

### Isolation Guarantees

- No imports from other engines/modules.
- No policy outputs added.
- Substitute logic remains intentionally unimplemented in Pass 2.
- All changes are contained within `src/appraisal-lab/post-clarity-engine`.

### Determinism Preserved

- Spiral buffers (`recentRepetition`, `recentUrgency`) are fixed-size deterministic ring buffers (`N=8`).
- Stress replay verifies identical final state, checksum, and recovery-path trace for the same seeded sequence.
