# PRESSURE ENGINE AUDIT REPORT

## 1) Summary

- **Overall:** PASS
- **Targeted test run:** `npm test -- src/appraisal-lab/pressure-engine`
- **Result:** 4 suites passed, 18 tests passed, 0 failed
- **Fixes applied:** Yes (minimal)
  - `src/appraisal-lab/pressure-engine/pressure_engine.ts`
  - Reason: extreme negative activation could drive `pressure < 0` (proven by `pressure_engine.stress2.test.ts`), violating guardrail expectation in this audit.
  - Minimal fix: final boundary clamp `pressure = Math.max(0, pressure)` after finite checks.

## 2) Discovery Snapshot (Phase 0)

### Files found under `src/appraisal-lab/pressure-engine/`

- `constants.ts`
- `types.ts`
- `pressure_engine.ts`
- `index.ts`
- `__tests__/pressure_engine.test.ts`
- `__tests__/pressure_engine.stress.test.ts`
- `__tests__/pressure_engine.audit.test.ts` (added)
- `__tests__/pressure_engine.stress2.test.ts` (added)

### Current public API summary

- **Exported functions**
  - `createPressureState(initialPressure?: number): PressureState`
  - `updatePressureState(state: PressureState, inputs: PressureInputs): { state: PressureState; outputs: PressureOutputs }`
- **Exported constants**
  - `K_UP`
  - `SHOCK_THRESHOLD`
  - `SHOCK_GAIN`
  - `WINDOW_N`
- **Exported types**
  - `PressureInputs`
  - `PressureOutputs`
  - `PressureState`

### State shape and update flow order

- **State shape**
  - `pressure`
  - `prevPressure`
  - `prevActivation`
  - `deltas` (ring buffer)
- **Update flow order**
  1. Read finite-safe state/input values
  2. Accumulation: `pressureAfterDecay + gain * K_UP * activation`
  3. Shock from `deltaActivation`: `max(0, deltaActivation - SHOCK_THRESHOLD) * SHOCK_GAIN`
  4. Final finite guard and non-negative boundary clamp
  5. `deltaPressure`, `slope` (`0` when `deltaMessageSeconds <= 0`)
  6. Ring buffer update for `deltas`
  7. Volatility via MSSD on `deltas`
  8. Return `{ state, outputs }`

## 3) Spec Checklist (Components 0-7)

| Component | Check | Status | Evidence |
|---|---|---|---|
| 0 | Module exists only under `src/appraisal-lab/pressure-engine/` | PASS | All audited files are in this folder only |
| 0 | No imports from adapter/prompt/server/LLM pipeline | PASS | Source imports are local only (`./constants`, `./types`) |
| 0 | Public API small (create/update + constants) | PASS | Verified in `index.ts` + `pressure_engine.audit.test.ts` |
| 1 | `pressure_after_decay` input present | PASS | `PressureInputs.pressureAfterDecay` |
| 1 | `gain` input present | PASS | `PressureInputs.gain` |
| 1 | `activation` input present (finite-safe acceptance) | PASS | `PressureInputs.activation` + finite handling in `updatePressureState` |
| 1 | `delta_message_seconds` input present | PASS | `PressureInputs.deltaMessageSeconds` |
| 1 | `pressure` output present | PASS | `PressureOutputs.pressure` |
| 1 | `delta_pressure` output present | PASS | `PressureOutputs.deltaPressure` |
| 1 | `slope` output present with safe zero-delta behavior | PASS | `PressureOutputs.slope` + test coverage |
| 1 | `volatility` output present (rolling window) | PASS | `PressureOutputs.volatility` + ring buffer + MSSD |
| 1 | `is_shock` output present (Δactivation-based) | PASS | `PressureOutputs.isShock` + threshold boundary tests |
| 1 | Internal state minimal (pressure, prev, activation, deltas) | PASS | `PressureState` only contains required fields |
| 2 | Accumulation formula implemented | PASS | `pressureAfterDecay + gain * K_UP * activation` |
| 2 | Shock formula uses Δactivation threshold/gain | PASS | `shock = max(0, deltaActivation - SHOCK_THRESHOLD) * SHOCK_GAIN` |
| 2 | No hidden extra logic/families/trust/session | PASS | No such fields, branches, or imports |
| 3 | `delta_pressure = P_new - prev_pressure` | PASS | Explicit assignment + audit test |
| 3 | `slope` uses `delta_t > 0`, else `0` | PASS | Explicit branch + tests |
| 3 | Volatility uses ring buffer window `N` | PASS | `WINDOW_N` + `nextRingBuffer` |
| 3 | Volatility method explicit (MSSD) | PASS | `computeVolatility` computes mean squared successive differences |
| 4 | Finite guardrails (`Number.isFinite`) | PASS | `asFinite` used across inputs/outputs |
| 4 | No negative pressure drift; clamp only if needed | PASS | Clamp added only after failing stress invariant |
| 4 | Constants exported (`K_UP`, `SHOCK_THRESHOLD`, `SHOCK_GAIN`, `WINDOW_N`) | PASS | Exported from `constants.ts` and `index.ts` |
| 5 | `createPressureState(initialPressure?)` | PASS | Function exists and exported |
| 5 | `updatePressureState(state, inputs) -> {state, outputs}` | PASS | Function exists and exported |
| 5 | No session logic | PASS | No session/timestamp fields or imports |
| 6 | Deterministic scenario unit tests present | PASS | `pressure_engine.test.ts` covers listed scenario set |
| 6 | Stress: 50k deterministic loop present | PASS | `pressure_engine.stress.test.ts` + `pressure_engine.stress2.test.ts` |
| 6 | Stress: extreme activations (negative/huge/micro) present | PASS | Stress suites include `-1e6`, `1e6`, micros |
| 6 | Stable finite outputs + `pressure >= 0` validated | PASS | `pressure_engine.audit.test.ts` + `pressure_engine.stress2.test.ts` |
| 7 | Constants exported for calibration; no buried magic in API surface | PASS | Constants centralized and exported |
| 7 | Calibration notes included (no tuning change now) | PASS | See section 5 below |

## 4) Evidence (tests and what they validate)

### Added test files

- `src/appraisal-lab/pressure-engine/__tests__/pressure_engine.audit.test.ts`
- `src/appraisal-lab/pressure-engine/__tests__/pressure_engine.stress2.test.ts`

### Test block evidence

- **Public API contract**
  - Verifies exported functions/constants and `{ state, outputs }` contract shape.
- **Update order sanity**
  - Verifies `pressureAfterDecay` is used as base and shock case exceeds non-shock with same base.
- **Delta/slope correctness**
  - Verifies exact `deltaPressure` relation and safe `slope=0` at `delta_t=0`.
- **Volatility behavior**
  - Verifies alternating activation yields higher volatility than steady sequence.
- **5k finite stability**
  - Verifies finite outputs and non-negative pressure across deterministic sequence.
- **50k heavy stress2 loop**
  - Verifies finite and non-negative behavior under mixed `delta_t` and gain cycles.
- **Extreme activation stress2**
  - Verifies large negative/positive and micro values are handled without crash/non-finite output.
- **Shock boundary test**
  - Verifies exact-threshold jump is non-shock; epsilon-above-threshold is shock.

## 5) Risk Flags

- **Missing output fields:** none found
- **Hidden logic:** none found
- **Non-determinism:** none found (deterministic sequences, no `Math.random`)
- **Non-finite edge risk:** mitigated by finite guards and verified by stress tests
- **Unbounded growth risk:** partially controlled by calibration constants; long-run growth behavior depends on upstream `pressureAfterDecay` and input distributions

## 6) Next Calibration Hooks (not implemented)

- Tune `K_UP` to match empirical baseline growth from labeled interaction traces.
- Tune `SHOCK_THRESHOLD` and `SHOCK_GAIN` from observed activation-jump distributions (e.g., percentile-based thresholding).
- Re-validate `WINDOW_N` using held-out conversational sequences to balance responsiveness vs noise smoothing.
- Recommended calibration dataset: deterministic replay logs of time-engine outputs (`pressureAfterDecay`, `gain`, `activation`, `deltaMessageSeconds`) paired with downstream target trajectories.
