# Collapse Engine v0 Audit Report

## Purpose (Layer F)

`collapse-engine` is a lab-only Layer F gate that identifies collapse events and classifies direction (`OUTWARD` / `INWARD` / `NONE`) using already-built upstream signals.

## Trigger Rules (Explicit)

Using sanitized:

- `E = clampInt(escalationLevel, 0, 3)`
- `S = clamp01(escalationScore)`
- `P = max(0, pressure)`
- `Slope = finite(pressureSlope, 0)`

Trigger if any:

- `E == 3 AND S >= 0.92`
- `P >= 12.0 AND Slope > 0`
- `S >= 0.98`

Severity terms:

- `sevEsc = S`
- `sevP = clamp01(P / 12.0)`
- `sevSlope = clamp01(Slope / 0.15)`
- `severityRaw = 0.5*sevEsc + 0.3*sevP + 0.2*sevSlope`
- if event -> `collapseSeverity = clamp01(max(0.6, severityRaw))`, else `0`

## Direction Rules (Counts)

When event triggers:

- OUTWARD indicators:
  - `gain >= 1.15` or `burstFlag`
  - mood in `{IRRITABLE, AVERSIVE}`
  - `Slope > 0 AND P >= 0.8 * 12.0`
  - `negValenceHint <= -0.5`
- INWARD indicators:
  - `gain <= 0.9` or `silenceFlag` or `deltaMessageSeconds >= 300`
  - mood in `{MELANCHOLIC, ANXIOUS}`
  - `Slope <= 0 AND P >= 0.7 * 12.0`

Decision:

- if `outwardCount >= 2` and `outwardCount > inwardCount` -> `OUTWARD`
- else if `inwardCount >= 2` and `inwardCount > outwardCount` -> `INWARD`
- else tie-break: `INWARD` if `deltaMessageSeconds >= 300`, otherwise `OUTWARD`

## Cooldown Rules

- Event sets cooldown to `900s`.
- Each update decrements by `deltaMessageSeconds`.
- While cooldown active, new events are blocked unless emergency override:
  - `S >= 0.99` or `P >= 1.2 * 12.0`
- On cooldown expiry, `inCollapse=false`.

## Invariants + Determinism

- No randomness, no time calls; deterministic from inputs/state.
- Finite guards via `asFinite(...)` and clamping on all critical numerics.
- Outputs guarantee finite severity in `[0,1]`.
- Reason tags are pushed in fixed order.

## Test Command and Coverage

Run:

`npm test -- src/appraisal-lab/collapse-engine`

Coverage:

- calm no-trigger path
- escalation-trigger path
- pressure-trigger path
- cooldown block behavior
- outward direction path
- inward direction path
- non-finite input guards
- 50k stress loop with bounded event rate and determinism replay
