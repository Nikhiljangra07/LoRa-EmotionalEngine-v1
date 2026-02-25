# ETV V1 (Beta-with-Decay) — Implementation Notes

## Overview

ETV V1 replaces the heuristic ETV update rule with a principled Beta-Binomial
model with temporal decay. It runs **in parallel** with the legacy `ETVEngine`
and is gated behind the feature flag `LORA_ETV_V1` (`process.env.LORA_ETV_V1 === '1'`).

When the flag is off, zero production behavior changes.

## What is literature-grounded

| Component | Basis |
|-----------|-------|
| **Beta-Binomial posterior** | Conjugate prior for Bernoulli-like outcomes. Standard Bayesian updating; see Gelman et al. (2013) *BDA3* Ch. 2. |
| **Exponential half-life decay** | Models forgetting / relevance decay of old evidence. `decay = 2^(-Δt / H)` with H = 14 days. Analogous to exponential smoothing in time-series literature. |
| **RMSSD / MSSD for instability (AVI)** | Root Mean of Successive Squared Differences. Grounded in Jahng et al. (2008) for affective instability measurement; validated by Houben et al. (2015) meta-analysis distinguishing variability, instability, and inertia. |
| **Risk-adjusted mean** | `μ - k√σ²` is a standard lower confidence bound (LCB). Used in UCB/LCB bandits and safety-constrained decision-making. k = 1.5 is a moderately conservative risk-aversion parameter. |

## What is constructed (not literature-derived)

| Component | Rationale |
|-----------|-----------|
| **z_t evidence-score weights** | `w_aviMean=0.40, w_aviMax=0.25, w_violation=0.30, w_eivRisk=0.20`. Chosen to produce sensible orderings in worked examples. Will require calibration on real session data. |
| **Band thresholds** | `0.25, 0.40, 0.55, 0.70` on risk-adjusted mean. Qualitative bands; no psychometric basis. |
| **Policy knob coefficients** | Linear interpolation from floor to ceiling based on risk-adjusted ETV. Functional form is a design choice, not empirically validated. |
| **Prior r₀=1.5, s₀=2.5** | Encodes mild pessimism (mean ≈ 0.375). Prevents new users from receiving high-trust behavior before evidence accumulates. |
| **Variance-to-confidence mapping** | `conf = clamp(1 - √σ² × 4.0, 0, 1)`. The scale factor 4.0 is a tuning constant. |

## Critical fix #1 — Idempotent session close

**Problem**: `endSession()` could be called twice — once manually, once by idle-boundary detection — causing a double ETV update with the same session data.

**Solution**: Added `sessionOpen` boolean and `lastClosedSessionId` tracking to `EngineOrchestrator`. Guard at the top of `endSession()`:

```
if (!sessionOpen || messageCount === 0) → no-op
```

Only active when `LORA_ETV_V1` is enabled. The legacy guard (`sessionEIVs.length === 0`) is preserved when the flag is off.

## Critical fix #2 — Short-session bias correction

**Problem**: A 1-message session has `AVI=0` (needs ≥2 values for RMSSD) which looks maximally stable, producing `z_t ≈ 1.0` and inflating trust.

**Solution**: Sessions with `messageCount < 4` use reduced evidence mass (`0.25` instead of `1.0`). This means short sessions still contribute signal but carry 4× less weight.

Constants: `SHORT_SESSION.minMessages = 4`, `SHORT_SESSION.reducedMass = 0.25`.

## Critical fix #3 — eivRisk penalty in z_t

**Problem**: A session with consistently high EIV (e.g., 0.85) but low volatility (low AVI) would appear "stable" and produce high z_t, inflating trust even though the user is in persistent emotional distress.

**Solution**: Added a 4th term to the evidence score:

```
eivRiskPenalty = 0.20 × clamp((eivMean - 0.70) / (1 - 0.70), 0, 1)
```

This activates only when `eivMean > 0.70` and scales linearly to a max penalty of `0.20` at `eivMean = 1.0`. The threshold `0.70` corresponds to the "high" EIV tier.

## Module structure

All V1 logic lives in `src/emotion-core/etv/`:

```
etv/
  types.ts          — SessionSummaryV1, ETVStateStored, ETVStateDerived, ETVPolicy, ETVUpdateLog
  constants.ts      — All numeric constants (decay, weights, thresholds, short-session)
  evidenceScore.ts  — z_t computation (4-input V1 formula)
  betaUpdate.ts     — applyDecay, applyEvidence, computeDerived
  policyMap.ts      — computePolicy, computeBand (knobs + bands from risk-adjusted mean)
  sessionSummary.ts — Pure buildSessionSummary() from raw buffers
  storage.ts        — Atomic JSON file adapter (.lora/etv/{userId}.json)
  engine.ts         — ETVEngineV1.updateFromSession() orchestration
  index.ts          — Barrel exports
```

The `AVIScorer` (RMSSD-based) lives at `src/emotion-core/scorers/AVIScorer.ts`.

## Storage

- Path: `.lora/etv/{userId}.json`
- Atomic writes: write to `.tmp` then `rename` (prevents partial writes on crash)
- Schema: `{ userId, r, s, lastSessionEndedAt, updatedAt }`

## Prompt Integration Rollout

ETV V1 policy knobs are now wired into `PromptTemplateBuilder` behind the
feature flag `LORA_ETV_POLICY_PROMPT` (default OFF).

### Architecture

```
ETVPolicy (from engine.ts)
  → mapETVPolicyToPrompt()    [etvPolicyPromptMap.ts]
  → renderConstraintOverlay() [categorical labels only, no raw floats]
  → injected into prompt after GLOBAL CONSTRAINTS block
```

**Dual-path logic** in `PromptTemplateBuilder.build()`:
1. Legacy `mapETVToRelationshipStyle(etvState.value)` always runs first.
2. If `LORA_ETV_POLICY_PROMPT === '1'` AND `options.etvPolicy` is present:
   - New mapping overrides relationship style (band-based).
   - Constraint overlay is appended to the prompt.
   - `DecisionLogger.logPromptProfileDiff()` logs the old-vs-new comparison.
3. If flag is OFF or `etvPolicy` is undefined: output is identical to legacy.

### Rollout plan

| Phase | Action | Flag state |
|-------|--------|------------|
| **A — Shadow diff logs** | Enable `LORA_ETV_V1=1`. ETV updates compute policy and log trajectory. `LORA_ETV_POLICY_PROMPT` stays OFF. Compare old vs new via `[LoRa::PromptProfileDiff]` logs. | V1=ON, Prompt=OFF |
| **B — Single test user** | Enable `LORA_ETV_POLICY_PROMPT=1` for one test user. Monitor prompt output, response quality, and policy knob values. | V1=ON, Prompt=ON (1 user) |
| **C — Widen rollout** | If Phase B is healthy, enable for all users. Continue monitoring `[LoRa::PromptProfileDiff]` for regression. | V1=ON, Prompt=ON (all) |

### Safety constraints

- All bands include `Do NOT use intimacy cues, dependency language, or bonding phrases`.
- Bands 0-1 enforce conservative caps (LOW initiative, SHALLOW depth, high clarification bias).
- Even Band 4 keeps assertiveness < 1 and tokens capped at 520.
- No raw numeric values appear in prompt text — only categorical labels.

## What this does NOT yet include

- **No old code deletion**: Legacy `ETVEngine.updateETV()` remains and runs alongside V1.
- **No memory-layer signals**: Future z_t expansions (correctionRate, contradictionRate, etc.) will arrive when memory-layer detection is ready.
