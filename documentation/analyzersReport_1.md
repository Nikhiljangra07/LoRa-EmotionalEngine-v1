Below is a **production-grade internal technical documentation** you can paste directly into your repo (README / `/docs/emotion-core.md` or similar).
This is written as an **engineering + research audit document**, not marketing fluff.

Everything is explicit: **what, why, origin, constraints, and accountability**.

---

# LoRa Emotion Core — Intensity & Repetition Modeling

**Version:** v1.0 (Post-Calibration Lock)
**Status:** Stable · Test-Locked · Research-Annotated
**Last Updated:** January 2026

---

## 1. Purpose of This Document

This document records **every design decision, numerical constant, mathematical assumption, and architectural constraint** used in the Emotion Core analyzers:

* Punctuation Analyzer
* Capitalization Analyzer
* Repetition Analyzer
* Shared Diminishing Returns Utility

The goal is **traceability**:

* Why this number?
* Where did it come from?
* Is it research-backed or heuristic?
* What can be changed safely?
* What must never be touched casually?

This document exists so that **future refactors, audits, investor due diligence, or scientific review** do not require reverse-engineering intent.

---

## 2. Core Design Principles (Non-Negotiable)

These principles govern **all files** in the Emotion Core.

### 2.1 Isolation

* Every analyzer is an **independent island**
* No analyzer depends on another analyzer’s logic
* Failure in one analyzer does **not propagate**

### 2.2 Layer Separation

| Layer    | Responsibility   | Forbidden                 |
| -------- | ---------------- | ------------------------- |
| Analyzer | Detection        | Math, policy              |
| Math     | Transformation   | Detection, beliefs        |
| Config   | Policy & belief  | Logic                     |
| Utility  | Shared mechanics | Analyzer-specific numbers |

### 2.3 Boundedness

* Emotional Intensity Value (EIV) ∈ **[0, 1]**
* No operation may exceed bounds
* All saturation is explicit and explainable

### 2.4 Explainability

Every number must be:

* Research-backed **or**
* Explicitly labeled **HEURISTIC**
* Never silently “tuned”

---

## 3. Emotional Intensity Value (EIV)

**Definition:**
EIV represents **emotional arousal / activation**, not sentiment polarity.

**Theoretical Basis:**

* Circumplex Model of Affect (Russell)
* Geneva Emotion Wheel
* Measurement theory (bounded psychological scales)

**Interpretation:**

* `0.0` → emotionally neutral
* `1.0` → maximum plausible human arousal
* Not additive across modalities

---

## 4. Diminishing Returns Utility (Core Infrastructure)

### File

```
src/emotion-core/math/diminishingReturns.util.ts
```

### Role

This file models **human perceptual saturation** when signals repeat.

It is:

* Analyzer-agnostic
* Config-driven
* Frozen as a template
* Never customized per analyzer

### Supported Decay Modes

| Mode          | Meaning                      | Research Basis       |
| ------------- | ---------------------------- | -------------------- |
| linear        | Straight scaling             | Baseline only        |
| capped-linear | Linear + hard cap            | Measurement theory   |
| logarithmic   | Fast early growth, slow tail | VADER, psychophysics |
| power         | Smooth diminishing           | Psycholinguistics    |

### Why NOT exponential?

* Exponential decay models **forgetting**, not **perceptual saturation**
* It collapses too aggressively
* Violates monotonic human perception for emphasis signals

**Conclusion:**
We deliberately use **logarithmic or power decay**, not exponential.

---

## 5. Punctuation Analyzer

### Files

* `punctuation.config.ts`
* `punctuation.math.ts`
* `PunctuationAnalyzer.ts`
* `PunctuationAnalyzer.test.ts`

### 5.1 Base Weights (Policy)

| Signal         | Weight | Origin                    |
| -------------- | ------ | ------------------------- |
| `!`            | 0.7    | Teh et al. + VADER        |
| `?`            | 0.5    | Epistemic arousal         |
| `...`          | 0.2    | Discourse hesitation      |
| `!?`           | 0.8    | Supra-additive (Teh 2022) |
| trailing `...` | 0.3    | Boundary discourse        |
| `.`            | 0.05   | Neutral baseline          |

**Why these values?**

* Relative ordering is research-supported
* Absolute scale is normalized to [0,1]
* Leaves headroom for repetition

### 5.2 Repetition Increment

```
REPETITION_INCREMENT = 0.0262
```

**Origin:**

* VADER observed ~0.0728 effect on compound scale
* Normalized + conservatively reduced (~25%)
* Prevents overshooting in bounded EIV

**Classification:**
⚠️ **Heuristic (explicitly acknowledged)**

### 5.3 Mathematical Properties

* Monotonic
* Bounded
* Test-locked
* Linear baseline (diminishing layered later)

---

## 6. Capitalization Analyzer

### Files

* `capitalization.config.ts`
* `capitalization.math.ts`
* `CapitalizationAnalyzer.ts`
* `CapitalizationAnalyzer.test.ts`

### 6.1 Base Weight

```
BASE_WEIGHT = 0.75
```

**Origin:**

* VADER: ALL-CAPS strongest modifier (~0.733)
* Slightly above `!` to reflect vocal loudness dominance

### 6.2 Maximum Contribution

```
MAX_CONTRIBUTION = 0.30
```

**Rationale:**

* Prevents casing from dominating EIV
* Comparable to 2–3 exclamation marks
* Matches perceptual reality: shouting ≠ emotional overflow

### 6.3 Partial Capitalization

```
PARTIAL_MULTIPLIER = 0.5
```

**Rationale:**

* Emphasis ≠ shouting
* Matches human intuition

### 6.4 Token Length Filter

```
MIN_TOKEN_LENGTH = 3
```

**Purpose:**

* Avoid acronyms (OK, ID, US)
* Reduce false positives

### 6.5 Confidence Logic

* Single ALL-CAPS → ambiguity (typo risk)
* Repeated ALL-CAPS → intentional
* Overuse → confidence decay

---

## 7. Repetition Analyzer

### Files

* `repetition.config.ts`
* `repetition.math.ts`
* `RepetitionAnalyzer.ts`
* `RepetitionAnalyzer.test.ts`

### 7.1 Detection Scope

* Immediate adjacency only
* Case-insensitive
* Punctuation-normalized
* Position-aware (start / mid / end)

### 7.2 Why Repetition Is Separate

Repetition is:

* A **structural emphasis**
* Not semantic
* Not punctuation
* Not capitalization

Treating it separately avoids signal entanglement.

### 7.3 Saturation Logic

* Repetition increases intensity
* Quickly saturates
* Excess repetition reduces confidence

**Research Basis:**

* Psycholinguistic repetition attenuation
* Commitment signaling literature

---

## 8. Confidence vs Intensity (Critical Distinction)

| Dimension       | Meaning                            |
| --------------- | ---------------------------------- |
| Intensity (EIV) | How strong the emotion feels       |
| Confidence      | How sure we are about that reading |

High intensity **without confidence** is allowed.
Low intensity **with high confidence** is allowed.

This separation is **intentional and required**.

---

## 9. Aggregation Strategy

```
AGGREGATION_STRATEGY = 'MAX'
```

### Why MAX?

* Signals operate in parallel
* Emotions do not add linearly
* Prevents impossible totals (>1)

**Alternatives considered but rejected:**

* Summation (violates bounds)
* Weighted averages (unvalidated)
* Probabilistic fusion (overkill for v1)

---

## 10. Testing Philosophy

### Test Types

* Boundedness
* Monotonicity
* Hierarchy
* Saturation
* Edge cases
* Noise rejection

### Test Locking Rule

If a test breaks:

* Either behavior is wrong
* Or policy changed intentionally
* Never “fix tests to pass code”

---

## 11. What Is Heuristic (Explicitly)

| Item                           | Status    |
| ------------------------------ | --------- |
| Increment exact value (0.0262) | Heuristic |
| Linear baseline                | Heuristic |
| Confidence thresholds          | Heuristic |
| Position multipliers           | Heuristic |

All heuristics are:

* Labeled
* Justified
* Replaceable without refactor

---

## 12. What Is Research-Backed

* Relative hierarchy of signals
* Saturation behavior
* Bounded emotional scales
* Repetition attenuation
* Capitalization as loudness
* Supra-additive punctuation

---

## 13. Architectural Guarantee (Final)

This system guarantees:

* ✅ Modularity
* ✅ Isolation
* ✅ Replaceability
* ✅ Auditability
* ✅ Scientific defensibility
* ✅ No cascading failure

If one analyzer fails, **nothing else breaks**.

---

## 14. Status

**Emotion Core v1 is COMPLETE and LOCKED.**
Future work adds analyzers, not rewrites foundations.

This document is the **contract**.

---
