# ETV V1: Gap Closure Plan -- AVI Research, Session Boundary, and Integration

**Companion to:** `docs/ETV_V1_BLUEPRINT.md`, `docs/ETV_V1_METHODOLOGY.md`
**Version:** 1.0.0
**Date:** 2026-02-25
**Status:** EXECUTION PLAN (pre-implementation)
**Scope:** Three gaps identified between the ETV V1 blueprint and the current codebase

---

## Table of Contents

1. [Overview](#1-overview)
2. [Gap 1: AVI (Appraisal Volatility Index)](#2-gap-1-avi-appraisal-volatility-index)
3. [Gap 4: Automatic Session Boundary Detection](#3-gap-4-automatic-session-boundary-detection)
4. [Gap 5: PromptTemplateBuilder Integration](#4-gap-5-prompttemplatebuilder-integration)
5. [Storage Decision: JSON Files Instead of SQLite](#5-storage-decision-json-files-instead-of-sqlite)
6. [Slim SessionSummary for V1](#6-slim-sessionsummary-for-v1)
7. [Execution Order](#7-execution-order)

---

## 1. Overview

The ETV V1 Blueprint defines a complete architecture for the Emotional Trust Value system. Three gaps exist between the blueprint and the current codebase that must be closed before implementation can begin:

| Gap | Problem | Resolution |
|---|---|---|
| Gap 1 | AVI (Appraisal Volatility Index) does not exist as a per-message signal | Design and build AVI as RMSSD on the existing EIV buffer, grounded in affect dynamics literature |
| Gap 4 | Session boundaries are not detected automatically | Wire 35-minute inactivity check into EngineOrchestrator.processMessage() |
| Gap 5 | PromptTemplateBuilder consumes raw ETVState.value, not ETVPolicy | Phased integration: build ETV first, update prompt builder in Phase 2 |

### What is NOT in scope

- **Database/SQLite:** Not needed. ETV state will persist via JSON files. Room is left for the leaky memory architecture.
- **SessionSummary storage/audit table:** Belongs to the memory layer (pattern extraction). Not built now.
- **correctionRate, contradictionRate, clarificationRate, inferenceReliability:** These SessionSummary fields require detection systems that do not exist. V1 uses a slim 3-input z_t formula. These fields will be added when memory/pattern extraction arrives.

---

## 2. Gap 1: AVI (Appraisal Volatility Index)

### 2.1 Definition

AVI is a **per-message bounded scalar in [0, 1]** that measures how much the user's emotional signal is *changing* from message to message.

- **EIV** measures *intensity* -- how strong the emotion is right now.
- **AVI** measures *instability* -- how much the emotion is shifting between consecutive messages.

| Scenario | EIV | AVI | Interpretation |
|---|---|---|---|
| User is consistently calm | Low | Low | Stable low-emotion session |
| User is consistently intense | High | Low | Stable high-emotion session |
| User fluctuates unpredictably | Moderate | High | Unstable session -- concerning for calibration |
| User escalates steadily | Rising | Moderate | Directional shift -- less volatile than oscillation |

### 2.2 Research Grounding

AVI is grounded in the **affect dynamics** literature, specifically the use of MSSD/RMSSD (Mean/Root Mean Square of Successive Differences) as a measure of emotional instability. Three peer-reviewed sources support this approach.

#### Source 1: Jahng et al. (2008) -- The foundational MSSD paper

**Full citation:** Jahng, S., Wood, P. K., & Trull, T. J. (2008). "Analysis of Affective Instability in Ecological Momentary Assessment: Indices Using Successive Difference and Group Comparison via Multilevel Modeling." *Psychological Methods*, 13(4), 354-375. DOI: 10.1037/a0014173

**What it establishes:** Jahng et al. introduce MSSD as the recommended metric for affective instability in time-series emotion data. The key insight is that simple variance (SD) of emotion scores captures *how spread out* emotions are but ignores *temporal ordering*. Two users can have identical SD but very different instability: one fluctuates wildly between consecutive measurements, the other drifts slowly. MSSD captures the former -- the magnitude of consecutive jumps.

**Why it supports AVI:** AVI needs to measure *how much the emotional signal changes from message to message*, not just how spread out it is overall. MSSD/RMSSD is the established psychometric for exactly this construct. Jahng et al. validate it specifically for ecological momentary assessment (repeated self-reports over time), which is structurally analogous to our per-message EIV stream.

**Quote (from abstract):** The paper proposes "indices using successive difference" for "analysis of affective instability in ecological momentary assessment."

#### Source 2: Houben et al. (2015) -- The meta-analysis distinguishing variability, instability, and inertia

**Full citation:** Houben, M., Van Den Noortgate, W., & Kuppens, P. (2015). "The Relation Between Short-Term Emotion Dynamics and Psychological Well-Being: A Meta-Analysis." *Psychological Bulletin*, 141(4), 901-930. DOI: 10.1037/a0038822

**What it establishes:** This meta-analysis (79 articles, N=11,381) formally distinguishes three affect dynamics constructs:

- **Variability** = within-person SD of emotions (how spread out overall)
- **Instability** = MSSD/RMSSD of successive differences (how much emotions jump between consecutive measurements)
- **Inertia** = autocorrelation (how much emotions resist change / persist over time)

The meta-analysis finds that instability has a stronger association with maladaptive outcomes than variability alone (rho = -0.205 for instability vs -0.178 for variability), validating that instability captures something beyond simple variance.

**Why it supports AVI:** This paper validates that instability (MSSD) is a distinct and meaningful construct, separate from variability (SD). AVI is specifically an instability measure, not a variability measure. This distinction matters because a user with high EIV variance but low AVI (slow drift) is behaviorally different from a user with the same variance but high AVI (rapid oscillation). The former is less concerning for calibration.

**Quote:** The study finds that low psychological well-being co-occurs with "more variable emotions," "more unstable emotions," and "more inert emotions," with instability showing the strongest effect.

#### Source 3: Dejonckheere et al. (2019) -- Methodological caution on interdependencies

**Full citation:** Dejonckheere, E., Mestdagh, M., Houben, M., Ruber, A. L., Vanhasbroeck, N., Tuerlinckx, F., & Kuppens, P. (2019). "Complex Affect Dynamics Add Limited Information to the Prediction of Psychological Well-Being." *Nature Human Behaviour*, 3, 478-491. DOI: 10.1038/s41562-019-0555-0

**What it establishes:** This meta-analysis (15 studies, N=1,777) finds that affect dynamics measures (including MSSD) have high interdependencies with simpler measures (mean, SD). Dynamic measures add limited predictive value beyond mean levels of positive and negative affect when predicting well-being outcomes.

**Why it matters for AVI:** This is an important **methodological caution**, not a disqualification. It means:

1. AVI and EIV will be correlated. This is expected and acceptable -- they are not meant to be independent signals. They capture different aspects (level vs temporal derivative) of the same emotional stream.
2. AVI should not be over-weighted relative to EIV in the evidence score z_t. The blueprint's z_t formula already reflects this: AVI contributes to the "stability" composite alongside EIV, not as an independent predictor.
3. The value of AVI is not in predicting well-being (which is what Dejonckheere et al. study) but in measuring *calibration stability* -- whether the system's emotional assessments are consistent or erratic. This is a different use case than the psychological prediction studied in the paper.

**Quote:** The authors find "considerable interdependencies between different affect dynamic measures" and that "dynamic measures add limited value when predicting psychological well-being compared to simpler metrics."

### 2.3 Mathematical Formulation

#### Step 1: Compute RMSSD over a sliding window of recent EIV values

Given the last *W* EIV values in the session ring buffer \[e_1, e_2, ..., e_W\]:

\[
\text{RMSSD} = \sqrt{\frac{1}{W-1} \sum_{i=1}^{W-1} (e_{i+1} - e_i)^2}
\]

This is the square root of MSSD (Jahng et al., 2008). Since each EIV is in [0, 1], the maximum possible successive difference is 1.0, so the theoretical maximum RMSSD is 1.0 (alternating 0, 1, 0, 1...). In practice, RMSSD will rarely exceed ~0.5 in real conversations.

**Why RMSSD and not MSSD:** RMSSD returns a value in the same units as the input signal (EIV), making it directly interpretable: "the average message-to-message EIV jump is X." MSSD is the squared version, which inflates large jumps disproportionately. For a bounded [0,1] input signal where we want proportional sensitivity, RMSSD is the appropriate choice. This is consistent with its use in affect dynamics (Houben et al., 2015).

#### Step 2: Normalize to [0, 1] via linear saturation

\[
\text{AVI} = \text{clamp}\!\left(\frac{\text{RMSSD}}{S},\ 0,\ 1\right)
\]

where *S* is a saturation threshold. RMSSD >= S maps to AVI = 1.0.

**Why linear clamp and not sigmoid:** Linear is simpler, fully auditable, and produces a direct proportional relationship between RMSSD and AVI below the saturation point. The saturation threshold S is a single tunable parameter. A sigmoid alternative (AVI = 2/(1+exp(-gamma * RMSSD)) - 1) is available for V2 if the linear form proves too sensitive to noise, but for V1, simplicity and auditability are preferred.

#### Step 3: Default parameters

| Parameter | Symbol | Value | Rationale |
|---|---|---|---|
| Window size | W | 8 | Enough messages to detect a pattern (4 successive differences minimum for RMSSD stability), small enough for short sessions. |
| Saturation threshold | S | 0.5 | RMSSD of 0.5 means the average consecutive EIV change is ~0.5 (extreme instability). This maps to AVI = 1.0. |
| Minimum messages | -- | 2 | Need at least 2 EIV values for one successive difference. Before that, AVI = 0.0. |

#### Worked examples

**Example A: Calm, stable session**

EIV stream: \[0.15, 0.18, 0.14, 0.16, 0.19, 0.15, 0.17, 0.14\]

Successive diffs squared: \[0.0009, 0.0016, 0.0004, 0.0009, 0.0016, 0.0004, 0.0009\]

RMSSD = sqrt(mean(\[0.0009, 0.0016, 0.0004, 0.0009, 0.0016, 0.0004, 0.0009\])) = sqrt(0.000957) = 0.031

AVI = clamp(0.031 / 0.5, 0, 1) = **0.062**

Interpretation: Very low volatility. The session is emotionally stable.

**Example B: Steadily escalating session**

EIV stream: \[0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80\]

Successive diffs squared: \[0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01\]

RMSSD = sqrt(mean(\[0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01\])) = sqrt(0.01) = 0.100

AVI = clamp(0.100 / 0.5, 0, 1) = **0.200**

Interpretation: Moderate volatility. The signal is changing, but in a consistent direction, not oscillating.

**Example C: Volatile, oscillating session**

EIV stream: \[0.20, 0.70, 0.15, 0.80, 0.10, 0.75, 0.20, 0.65\]

Successive diffs squared: \[0.25, 0.3025, 0.4225, 0.49, 0.4225, 0.3025, 0.2025\]

RMSSD = sqrt(mean(\[0.25, 0.3025, 0.4225, 0.49, 0.4225, 0.3025, 0.2025\])) = sqrt(0.3418) = 0.585

AVI = clamp(0.585 / 0.5, 0, 1) = **1.000**

Interpretation: Maximum volatility. The user's emotional signal is oscillating wildly between messages.

These examples demonstrate that AVI correctly distinguishes stable (0.06), directional (0.20), and oscillating (1.00) patterns.

### 2.4 Why RMSSD on EIV and Not Reuse pressure.volatility

The existing pressure engine (`src/appraisal-lab/pressure-engine/pressure_engine.ts`) already computes MSSD via its `computeVolatility()` function (lines 8-21). However, it operates on **pressure deltas** (an unbounded, multi-component accumulated signal), not on EIV values. AVI should operate on the **EIV stream directly** because:

1. **EIV is bounded [0, 1]**, making normalization trivial and RMSSD interpretable.
2. **EIV is the signal that ETV consumes** (via eivMean, eivMax in SessionSummary). AVI is the temporal derivative of the same signal -- this keeps the ETV input space self-consistent.
3. **Pressure volatility mixes multiple upstream effects** (decay, gain, shock, activation). It is a downstream composite, not a clean measure of emotional signal instability.
4. **Architectural independence.** AVI should not depend on the appraisal bridge being enabled. It should work from the EIV ring buffer alone, which is always available. The pressure engine is feature-flagged behind `LORA_APPRAISAL_BRIDGE`.

### 2.5 Codebase Connection

The existing `sessionEIVs` ring buffer in `EngineOrchestrator` (line 59: `private sessionEIVs: number[] = []`, lines 164-168: push and cap) already accumulates per-message EIV values. AVI can be computed **from the same buffer** at each message -- no new accumulator needed for the raw input.

After pushing the new EIV value to `sessionEIVs`, take the last *W* entries and compute RMSSD. This gives a per-message AVI value. Accumulate AVI values in a parallel `sessionAVIs: number[]` ring buffer for session-end aggregation.

At session end:
- `aviMean` = mean of `sessionAVIs`
- `aviMax` = max of `sessionAVIs`

### 2.6 File Placement and Dependency Rules

**File:** `src/emotion-core/scorers/AVIScorer.ts`

Structurally parallel to `src/emotion-core/scorers/EIVScorer.ts`.

```
AVIScorer.computeAVI(eivBuffer: number[], windowSize: number, saturation: number): number
```

Pure function. Takes the EIV ring buffer (or its tail), returns a bounded AVI in [0, 1].

| May import | Must NOT import |
|---|---|
| `etv/constants` (for W, S defaults) | Appraisal bridge / appraisal lab |
| Nothing else | Feature flags |
| | EngineOrchestrator |
| | LLM / prompt builder |

### 2.7 Invariants

| ID | Invariant |
|---|---|
| AVI-1 | AVI is in [0, 1] for all inputs |
| AVI-2 | AVI = 0 when fewer than 2 EIV values exist |
| AVI-3 | AVI = 0 when all EIV values in the window are identical |
| AVI-4 | AVI is monotonically non-decreasing in RMSSD |
| AVI-5 | AVI is deterministic given the same EIV buffer |

### 2.8 Test Specifications

| Test | What it proves |
|---|---|
| `avi.boundedness` | AVI in [0, 1] for 10k random EIV buffers |
| `avi.zeroOnConstant` | Constant EIV stream produces AVI = 0 |
| `avi.zeroOnEmpty` | Fewer than 2 values produces AVI = 0 |
| `avi.stableVsVolatile` | Stable stream produces lower AVI than oscillating stream |
| `avi.monotonicity` | Increasing RMSSD produces non-decreasing AVI |
| `avi.determinism` | Same buffer produces identical AVI |
| `avi.workedExamples` | Examples A, B, C from Section 2.3 produce expected values |

---

## 3. Gap 4: Automatic Session Boundary Detection

### 3.1 What Needs to Happen

When a new message arrives, before processing it, check if enough time has passed since the last message to constitute a new session. If yes, close the old session (triggering ETV update) and start a fresh one.

### 3.2 Logic

At the top of `EngineOrchestrator.processMessage()`, before the current line 144 (`const messageTimestampMs = Date.now()`):

```
Pseudocode (logic only):

const now = Date.now();
if (this.lastMessageTimestampMs > 0) {
  const idleMs = now - this.lastMessageTimestampMs;
  if (idleMs > SESSION_GAP_MS) {
    this.endSession();  // triggers ETV update, resets session state
  }
}
```

Where:

```
SESSION_GAP_MS = 35 * 60 * 1000  // 35 minutes = 2,100,000 milliseconds
```

### 3.3 Constant Placement

Add `SESSION_GAP_MS` to `src/emotion-core/etv/constants.ts`:

```
export const SESSION_GAP_MS = 35 * 60 * 1000;
```

The existing `SESSION_THRESHOLD_SECONDS = 3600` in `src/appraisal-lab/time-engine/session-boundary.ts` is a separate concern (appraisal-lab's own session detection for pressure decay). It should remain unchanged. The ETV session boundary is an independent check owned by the orchestrator.

### 3.4 What This Touches

| File | Change |
|---|---|
| `src/emotion-core/engines/EngineOrchestrator.ts` | Add idle check at top of processMessage() |
| `src/emotion-core/etv/constants.ts` | Add SESSION_GAP_MS constant |

### 3.5 What This Does NOT Touch

- No changes to the appraisal bridge.
- No changes to analyzers, scorers, or prompt builder.
- No changes to the hint pipeline.
- No changes to `session-boundary.ts` in appraisal-lab.

### 3.6 Feature Flag

Gate behind `LORA_ETV_V1`. When the flag is off (`'0'`), no auto-close happens (preserving current behavior exactly). When on (`'1'`), the idle check runs before each message.

### 3.7 Edge Cases

| Edge case | Handling |
|---|---|
| First message ever (lastMessageTimestampMs = 0) | Skip the idle check. No previous session to close. |
| Session has 0 messages when auto-close triggers | `endSession()` already handles this: returns early with current ETV (line 814-815 of current code). |
| Clock skew (now < lastMessageTimestampMs) | idleMs will be negative, which is < SESSION_GAP_MS. No auto-close. Safe. |
| Rapid messages after long gap | Auto-close fires on the first message after the gap. All subsequent rapid messages are in the new session. Correct. |

### 3.8 Test Specifications

| Test | What it proves |
|---|---|
| `sessionBoundary.autoCloseAfterGap` | Message arriving 36 minutes after last message triggers endSession() before processing |
| `sessionBoundary.noCloseWithinGap` | Message arriving 30 minutes after last message does NOT trigger endSession() |
| `sessionBoundary.firstMessageNoClose` | First message ever does not trigger endSession() |
| `sessionBoundary.etvUpdatedOnAutoClose` | ETV state is updated when auto-close fires |
| `sessionBoundary.sessionResetOnAutoClose` | Session ring buffers, violation flag, message count are reset after auto-close |
| `sessionBoundary.flagGating` | When LORA_ETV_V1 is off, auto-close does not fire regardless of idle time |

---

## 4. Gap 5: PromptTemplateBuilder Integration

### 4.1 Current State

`PromptTemplateBuilder.build()` receives `etvState: ETVState` and calls `mapETVToRelationshipStyle(etvState.value)` which produces one of three strings:
- `etvState.value < 0.4` -> "Professional -- polite, calm, and respectful"
- `etvState.value < 0.6` -> "Friendly -- warm, open, and conversational"
- Otherwise -> "Casual -- relaxed, personable, and natural"

File: `src/emotion-core/prompt/PromptTemplateBuilder.ts`, lines 130-148.

### 4.2 Target State

`PromptTemplateBuilder.build()` receives `etvPolicy: ETVPolicy` and uses:
- `etvPolicy.band` to select relationship style and behavioral constraints.
- `etvPolicy.maxInitiative`, `etvPolicy.assertiveness`, etc. to parameterize prompt overlays.

### 4.3 Phasing

This is **Phase 2** of the rollout defined in the ETV V1 Blueprint (Section 21). It should NOT be done simultaneously with the ETV module build.

**Phase 1 (build ETV, no behavioral change):**

1. Build the ETV module (types, constants, AVI, evidenceScore, betaUpdate, policyMap, storage, engine).
2. Wire session boundary auto-close.
3. Wire endSession() to call ETVEngine.updateFromSession().
4. Log ETVUpdateLog alongside existing DecisionLogger output.
5. The old `ETVEngine.updateETV()` path continues to drive behavior.
6. Validate: logs are well-formed, invariants hold, trajectories are sensible.

**Phase 2 (switch behavioral control):**

1. Update `PromptTemplateBuilder.build()` signature to accept `ETVPolicy`.
2. Replace `mapETVToRelationshipStyle(value)` with band-to-style mapping:
   - `BAND_0`, `BAND_1` -> "Professional -- polite, calm, and respectful"
   - `BAND_2` -> "Friendly -- warm, open, and conversational"
   - `BAND_3`, `BAND_4` -> "Casual -- relaxed, personable, and natural"
3. Optionally inject knob values into prompt constraints (e.g., maxResponseTokens as a prompt instruction).
4. Remove old `ETVEngine.updateETV()` code path.

### 4.4 Backward Compatibility During Phase 1

During Phase 1, both old and new ETV paths compute in parallel:
- Old path: `ETVEngine.updateETV(previousETV, sessionMean, hasViolation)` drives behavior.
- New path: `ETVEngine.updateFromSession(sessionSummary)` computes and logs but does not drive behavior.

The `PromptTemplateBuilder` continues to receive the old `ETVState` with `.value`. No changes to the prompt builder in Phase 1.

---

## 5. Storage Decision: JSON Files Instead of SQLite

### 5.1 Rationale

The project is building toward a leaky memory architecture. Adding SQLite now would create a storage dependency that may conflict with or duplicate the memory layer's eventual storage solution. Instead, ETV state persists via minimal JSON files.

### 5.2 Schema

Each user's ETV state is stored as a JSON file.

**Path:** `.lora/etv/{userId}.json`

**Contents:**

```json
{
  "userId": "u_abc123",
  "r": 3.45,
  "s": 3.55,
  "lastSessionEndedAt": 1740500000000,
  "updatedAt": 1740500000000
}
```

Five fields. Read on session start, write on session end.

### 5.3 Storage Adapter Interface

```
ETVStorage.load(userId: string): ETVState | null
ETVStorage.save(state: ETVState): void
```

The adapter is a thin wrapper around fs.readFileSync / fs.writeFileSync. When leaky memory arrives, the adapter implementation is swapped. The interface remains the same.

### 5.4 Session Audit Logs

Session-level ETV updates are logged via `DecisionLogger` (structured JSON to console), not persisted to a database. A new `logETVUpdate(log: ETVUpdateLog)` method is added parallel to the existing `logSessionEnd()`.

No audit table. No session storage. This belongs to the memory layer.

### 5.5 Future Migration Path

When leaky memory arrives:
1. The JSON file adapter is replaced with whatever storage the memory layer provides.
2. The `ETVStorage` interface does not change.
3. ETV state may move into the memory layer's persistence, or remain as a separate lightweight store consumed by memory as a policy prior.

---

## 6. Slim SessionSummary for V1

### 6.1 Rationale

The full SessionSummary in the ETV V1 Blueprint has 7 signal fields. Five of them (`correctionRate`, `contradictionRate`, `clarificationRate`, `safetyTriggerRate`, `inferenceReliability`) require detection systems that do not exist in the codebase today. Building those detection systems is out of scope for the ETV module -- they belong to the memory/pattern extraction layer.

V1 uses only signals that the codebase produces today.

### 6.2 V1 SessionSummary Type

```typescript
type SessionSummaryV1 = {
  sessionId: string;
  userId: string;
  startedAt: number;         // epoch ms
  endedAt: number;            // epoch ms
  messageCount: number;

  // From sessionEIVs ring buffer
  eivMean: number;            // 0..1
  eivMax: number;             // 0..1

  // From sessionAVIs ring buffer (new, computed per-message from EIV buffer)
  aviMean: number;            // 0..1
  aviMax: number;             // 0..1

  // From sessionHasViolation flag
  hasViolation: boolean;
};
```

### 6.3 V1 Evidence Score z_t (3-input formula)

\[
\text{stability} = 1 - w_1 \cdot \text{aviMean} - w_2 \cdot \text{aviMax}
\]

\[
\text{safetyPenalty} = w_3 \cdot \mathbb{1}[\text{hasViolation}]
\]

\[
z_t = \text{clamp}(\text{stability} - \text{safetyPenalty},\ 0,\ 1)
\]

where \(\mathbb{1}[\text{hasViolation}]\) is 1 if the session had a violation, 0 otherwise.

### 6.4 V1 Weights

| Weight | Value | Rationale |
|---|---|---|
| \(w_1\) | 0.40 | Mean volatility: primary instability signal. Higher weight than aviMax because sustained instability is more informative than a single spike. |
| \(w_2\) | 0.25 | Peak volatility: spike penalty. A single extreme AVI event is concerning but less diagnostic than sustained instability. |
| \(w_3\) | 0.30 | Safety violation: strong binary penalty. A session with any safety trigger is substantially penalized. |

### 6.5 Properties

- When aviMean = 0, aviMax = 0, no violation: z_t = 1.0 (perfect session).
- When aviMean = 1, aviMax = 1, with violation: z_t = clamp(1 - 0.40 - 0.25 - 0.30, 0, 1) = clamp(0.05, 0, 1) = 0.05 (near-worst session).
- When no violation but moderate instability (aviMean = 0.5, aviMax = 0.7): z_t = 1 - 0.20 - 0.175 = 0.625 (moderate session).
- Violation alone with zero AVI: z_t = 1 - 0 - 0 - 0.30 = 0.70 (penalty but not catastrophic).

### 6.6 V1 vs Full Blueprint z_t

| Aspect | V1 (slim) | Full blueprint |
|---|---|---|
| Input count | 3 (aviMean, aviMax, hasViolation) | 7 (+ correctionRate, contradictionRate, clarificationRate, safetyTriggerRate, inferenceReliability) |
| Signal source | Existing EIV buffer + existing violation flag | Requires new detection systems |
| Precision | Coarser -- only captures volatility and safety | Finer -- captures cooperation and inference quality |
| Upgrade path | Add inputs as detection systems arrive | -- |

The V1 formula is explicitly documented as **"V1 slim -- will expand when correction/contradiction detection and memory-layer pattern extraction arrive."** All weights reside in `etv/constants.ts` and can be updated without structural changes when new inputs become available.

---

## 7. Execution Order

### 7.1 Implementation Sequence

| Step | What | File | Depends on | Time |
|---|---|---|---|---|
| 1 | Create ETV type definitions | `src/emotion-core/etv/types.ts` | Nothing | 10 min |
| 2 | Create ETV constants (all weights, thresholds, decay params, AVI params) | `src/emotion-core/etv/constants.ts` | Nothing | 10 min |
| 3 | Create AVI scorer (RMSSD on EIV buffer, bounded [0,1]) | `src/emotion-core/scorers/AVIScorer.ts` | constants | 15 min |
| 4 | Create evidence score function (V1 slim z_t) | `src/emotion-core/etv/evidenceScore.ts` | types, constants | 15 min |
| 5 | Create Beta update math (decay + evidence update) | `src/emotion-core/etv/betaUpdate.ts` | types, constants | 15 min |
| 6 | Create policy map (ETVPolicy from ETVState) | `src/emotion-core/etv/policyMap.ts` | types, constants | 10 min |
| 7 | Create storage adapter (JSON file read/write) | `src/emotion-core/etv/storage.ts` | types | 10 min |
| 8 | Create ETV engine (orchestrates steps 4-7) | `src/emotion-core/etv/engine.ts` | all above | 15 min |
| 9 | Create public exports | `src/emotion-core/etv/index.ts` | all above | 5 min |
| 10 | Wire session boundary auto-close in EngineOrchestrator | `src/emotion-core/engines/EngineOrchestrator.ts` | constants | 10 min |
| 11 | Wire endSession() to compute SessionSummaryV1 + call ETVEngine | `src/emotion-core/engines/EngineOrchestrator.ts` | engine | 15 min |
| 12 | Add AVI accumulation to processMessage() | `src/emotion-core/engines/EngineOrchestrator.ts` | AVIScorer | 10 min |
| 13 | Add ETVUpdateLog to DecisionLogger | `src/emotion-core/logging/DecisionLogger.ts` | types | 10 min |
| 14 | Add feature flag LORA_ETV_V1 | `src/emotion-core/config/featureFlags.ts` | Nothing | 5 min |
| 15 | Unit tests for AVI (7 tests) | `src/emotion-core/scorers/__tests__/AVIScorer.test.ts` | AVIScorer | 15 min |
| 16 | Unit tests for evidenceScore, betaUpdate, policyMap | `src/emotion-core/etv/__tests__/` | steps 4-6 | 25 min |
| 17 | Integration test: full session boundary -> ETV update cycle | `src/emotion-core/etv/__tests__/` | all above | 15 min |
| **Total** | | | | **~3.5 hours** |

### 7.2 New File Summary

```
src/emotion-core/etv/
  types.ts              -- SessionSummaryV1, ETVState, ETVPolicy, ETVBand,
                           ETVUpdateLog, ETVConfig
  constants.ts          -- ETV_EVIDENCE_WEIGHTS, ETV_DECAY, ETV_POLICY,
                           ETV_INIT, ETV_BANDS, AVI_PARAMS, SESSION_GAP_MS
  evidenceScore.ts      -- computeEvidenceScore(summary) -> z_t
  betaUpdate.ts         -- applyDecay, applyEvidence, computeDerived
  policyMap.ts          -- computePolicy, computeBand
  storage.ts            -- ETVStorage (JSON file adapter)
  engine.ts             -- ETVEngine.updateFromSession, ETVEngine.getPolicy
  index.ts              -- public exports

src/emotion-core/scorers/
  AVIScorer.ts          -- computeAVI(eivBuffer, W, S) -> number

src/emotion-core/etv/__tests__/
  evidenceScore.test.ts
  betaUpdate.test.ts
  policyMap.test.ts
  engine.integration.test.ts

src/emotion-core/scorers/__tests__/
  AVIScorer.test.ts
```

### 7.3 Modified Files

| File | Change |
|---|---|
| `src/emotion-core/engines/EngineOrchestrator.ts` | Add sessionAVIs buffer, AVI computation per message, session boundary auto-close, new endSession() ETV path |
| `src/emotion-core/logging/DecisionLogger.ts` | Add logETVUpdate() method |
| `src/emotion-core/config/featureFlags.ts` | Add LORA_ETV_V1 flag |

### 7.4 NOT Modified

- No changes to analyzers.
- No changes to EIVScorer or EIVComposer.
- No changes to the appraisal bridge.
- No changes to the hint pipeline.
- No changes to PromptTemplateBuilder (Phase 2).
- No changes to the pressure engine.
- No changes to any existing test.

---

## References

### AVI-specific sources (new, not in previous ETV reports)

| Tag | Source |
|---|---|
| AVI-1 | Jahng, S., Wood, P. K., & Trull, T. J. (2008). "Analysis of Affective Instability in Ecological Momentary Assessment: Indices Using Successive Difference and Group Comparison via Multilevel Modeling." *Psychological Methods*, 13(4), 354-375. DOI: 10.1037/a0014173 |
| AVI-2 | Houben, M., Van Den Noortgate, W., & Kuppens, P. (2015). "The Relation Between Short-Term Emotion Dynamics and Psychological Well-Being: A Meta-Analysis." *Psychological Bulletin*, 141(4), 901-930. DOI: 10.1037/a0038822 |
| AVI-3 | Dejonckheere, E., Mestdagh, M., Houben, M., et al. (2019). "Complex Affect Dynamics Add Limited Information to the Prediction of Psychological Well-Being." *Nature Human Behaviour*, 3, 478-491. DOI: 10.1038/s41562-019-0555-0 |

### ETV sources (from previous reports, referenced in this document)

See `docs/ETV_V1_BLUEPRINT.md`, References section.
