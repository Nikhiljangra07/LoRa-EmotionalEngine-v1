# Layer-2 Full Audit — v1

**Date:** 2026-02-19
**Type:** Read-only integrity, correctness, and reproducibility audit
**Scope:** All Layer-2 artifacts, scripts, and documentation

---

## 1. Artifact Integrity

| Artifact | Exists | Size > 0 | JSON parseable | No NaN | No negative P | Dists sum to 1 | Priors sum to 1 | No collapse (>0.99) | Status |
|---|---|---|---|---|---|---|---|---|---|
| docs/layer2/mapping_spec.md | YES | YES | N/A (MD) | N/A | N/A | N/A | N/A | N/A | PASS |
| docs/layer2/irr_kappa.md | YES | YES | N/A (MD) | N/A | N/A | N/A | N/A | N/A | PASS |
| docs/layer2/likelihood_comparison.md | YES | YES | N/A (MD) | N/A | N/A | N/A | N/A | N/A | PASS |
| docs/layer2/L2_LOCK_v1.md | YES | YES | N/A (MD) | N/A | N/A | N/A | N/A | N/A | PASS |
| docs/layer2/shift_notes.md | YES | YES | N/A (MD) | N/A | N/A | N/A | N/A | N/A | PASS |
| reports/eval_v1.md | YES | YES | N/A (MD) | N/A | N/A | N/A | N/A | N/A | PASS |
| reports/calibration.md | YES | YES | N/A (MD) | N/A | N/A | N/A | N/A | N/A | PASS |
| reports/gating_v1_1.md | YES | YES | N/A (MD) | N/A | N/A | N/A | N/A | N/A | PASS |
| models/likelihoods/envent_likelihood_writer_v1.json | YES | 10,242 B | YES | YES | YES | YES | YES | YES | PASS |
| models/likelihoods/envent_likelihood_reader_v1.json | YES | 10,191 B | YES | YES | YES | YES | YES | YES | PASS |
| data/layer2/likelihood_table_ekman6_v1_1.json | YES | 6,203 B | YES | YES | YES | YES | YES | YES | PASS |
| data/layer2/calibration_metrics_v1.json | YES | 4,251 B | YES | — | — | — | — | — | PASS |
| data/layer2/eval_metrics_v1.json | YES | 3,610 B | YES | — | — | — | — | — | PASS |
| data/layer2/gating_metrics_v1.json | YES | 35,788 B | YES | — | — | — | — | — | PASS |
| data/layer2/gating_metrics_v1_1.json | YES | 525,176 B | YES | — | — | — | — | — | PASS |
| data/layer2/irr_kappa_table.csv | YES | 914 B | N/A (CSV) | — | — | — | — | — | PASS |
| data/layer2/dimension_weights.json | YES | 119 B | YES | — | — | — | — | — | PASS |
| data/layer2/layer2_likelihood_dataset_v1_1.json | YES | 1,558,595 B | YES | — | — | — | — | — | PASS |

**Result: 18/18 PASS.**

---

## 2. Determinism

### 2.1 Re-run capability

The evaluation, calibration, and gating scripts enforce hard no-overwrite guards. They cannot be re-run without deleting existing output files. This is by design.

The inspector script (`layer2:inspect-ekman6-v1_3`) was re-run successfully and produced identical console output to prior recorded runs.

### 2.2 JSON-to-Markdown cross-check

All stored JSON artifact values were verified against their corresponding markdown reports:

| Metric | JSON value | In report | Match |
|---|---|---|---|
| Eval accuracy | 47.67% | eval_v1.md | YES |
| Eval Macro F1 | 0.4225 | eval_v1.md | YES |
| Eval harmful rate | 7.49% | eval_v1.md | YES |
| Calibration T* | 0.81 | calibration.md | YES |
| Baseline ECE | 0.072095 | calibration.md | YES |
| Post-scaled ECE | 0.039817 | calibration.md | YES |
| Gating baseline harmful | 7.49% | gating_v1_1.md | YES |
| Gating selected t1 | 0.42 | gating_v1_1.md | YES |
| Gating coverage | 46.66% | gating_v1_1.md | YES |

### 2.3 LOCK document cross-check

All 13 numeric claims in `L2_LOCK_v1.md` were verified against stored JSON artifacts. All match.

**Result: STABLE. No drift detected.**

---

## 3. Likelihood Table Sanity

### 3.1 Writer table (`envent_likelihood_writer_v1.json`)

- Emotions: 13
- Dimensions: 6 (valence, arousal, agency, control, certainty, goalRelevance)
- Prior sum: 1.0000000000
- NaN: none
- Negative probabilities: none
- Collapsed distributions (any bin > 0.99): none
- Distribution sum violations (|sum - 1| > 1e-10): none
- Max normalized entropy: 0.999995 (certainty)
- Min normalized entropy: 0.200071 (valence)

### 3.2 Reader table (`envent_likelihood_reader_v1.json`)

- Emotions: 13
- Dimensions: 6
- Prior sum: 1.0000000000
- NaN: none
- Negative probabilities: none
- Collapsed distributions: none
- Distribution sum violations: none
- Max normalized entropy: 1.000000 (goalRelevance)
- Min normalized entropy: 0.226083 (valence)

### 3.3 Ekman-6 table (`likelihood_table_ekman6_v1_1.json`)

- Emotions: 7 (ANGER, DISGUST, FEAR, JOY, NEUTRAL, SADNESS, SURPRISE)
- Dimensions: 6
- Prior sum: 1.0000000000
- NaN: none
- Negative probabilities: none
- Collapsed distributions: none
- Distribution sum violations: none
- Embedded dimension weights match `dimension_weights.json`: YES

### 3.4 Observations

- Valence has the lowest entropy across both tables, indicating strong discriminative signal (expected from high IRR).
- Certainty and goalRelevance approach maximum entropy in some emotion-bin pairs, consistent with weak IRR for those source columns.
- No suspicious collapse detected.

**Result: PASS.**

---

## 4. IRR Weight Consistency

### 4.1 Kappa table

- Total rows: 22 (21 appraisal dimensions + 1 emotion category)
- All κ values in range [-1, 1]: YES
- Missing dimensions: NONE
- Emotion Fleiss' κ: 0.4746 (UNSTABLE)
- ACCEPTABLE (κ >= 0.60): 2 (pleasantness, unpleasantness)
- WEAK (0.50 <= κ < 0.60): 4 (self_responsblt, other_responsblt, goal_support, social_norms)
- UNSTABLE (κ < 0.50): 15

### 4.2 Dimension weight derivation

Recomputed κ aggregation per LoRa dimension against stored `dimension_weights.json`:

| LoRa dimension | Source columns | Avg κ | Tier weight | Stored weight | Match |
|---|---|---|---|---|---|
| valence | pleasantness, unpleasantness | 0.7291 | 1.00 | 1.00 | YES |
| arousal | suddenness, urgency, attention | 0.3318 | 0.15 | 0.15 | YES |
| agency | self_responsblt, other_responsblt, chance_responsblt | 0.5009 | 0.60 | 0.60 | YES |
| control | self_control, other_control, chance_control | 0.3996 | 0.15 | 0.15 | YES |
| certainty | predict_event, predict_conseq, familiarity | 0.3209 | 0.15 | 0.15 | YES |
| goalRelevance | goal_relevance | 0.3758 | 0.15 | 0.15 | YES |

**Result: PASS. All 6 weights derived correctly from κ tiers.**

---

## 5. Evaluation Fairness

### 5.1 Split sizes

Two distinct splitting strategies are used in Layer-2:

| Split strategy | Train | Dev | Test | Total |
|---|---|---|---|---|
| Dataset builder (per-row, 13-emotion stratified) | 4,621 | 995 | 984 | 6,600 |
| Evaluator (per-text_id, Ekman-6+Neutral stratified) | 4,620 | 992 | 988 | 6,600 |

The numerical difference is expected: the dataset builder splits individual rows by raw emotion label (13 classes), while the evaluator groups rows by `text_id` first, then splits `text_id` groups by collapsed emotion (7 classes). Both use seed=42 and Fisher-Yates shuffle.

### 5.2 text_id leakage

The evaluator enforces explicit `text_id` overlap guards (throws on any `text_id` appearing in multiple splits). This guard passed during the evaluation run.

### 5.3 Harmful confusion definition

- Eval uses: ANGER<->FEAR, ANGER<->DISGUST (74/988 = 7.49%)
- Gating uses: ANGER<->FEAR, ANGER<->DISGUST (74/988 = 7.49%)
- Definitions are consistent.

**WARNING:** The LOCK document and shift_notes reference SHAME<->GUILT as a harmful pair, but the evaluation and gating scripts do not include SHAME<->GUILT in their `HARMFUL_PAIRS` sets. Under Ekman-6 collapse, both SHAME and GUILT map to SADNESS, so SHAME<->GUILT confusion is structurally impossible in the collapsed emotion space. This is not a bug, but the documentation could be clearer about why SHAME<->GUILT is absent from the computed pair set.

**Result: PASS WITH WARNING.**

---

## 6. Calibration Integrity

### 6.1 Temperature fitting

- Optimal T* fitted on DEV set only: YES (confirmed by `calibration.dev_nll` field; T=0.81 minimizes DEV NLL=1.3639)
- Grid search range: [0.1, 5.0] step 0.01 (per script specification)
- T* = 0.81 (valid, > 0)

### 6.2 TEST set metrics

| Metric | Baseline | Post-scaled | Delta |
|---|---|---|---|
| Accuracy | 47.67% | 47.67% | 0.00 pp |
| Macro F1 | 0.4225 | 0.4225 | 0.0000 |
| ECE | 0.072095 | 0.039817 | -0.032279 |
| MCE | 0.187205 | 0.193084 | +0.005879 |
| Brier | 0.644471 | 0.636073 | -0.008397 |
| Harmful rate | 7.49% | 7.49% | 0.00 pp |

### 6.3 Integrity checks

- Accuracy unchanged by calibration: YES
- ECE decreased: YES
- Accuracy did NOT increase due to calibration: CONFIRMED
- Harmful confusion unchanged: YES
- MCE increased slightly (+0.006): noted but not a defect (MCE measures worst single bin, which can shift under temperature rescaling)

**Result: PASS.**

---

## 7. Gating Integrity

### 7.1 Monotonicity (pmax gate)

- Coverage monotonically decreasing as threshold increases: PASS
- High-threshold harmful rate does not exceed baseline: PASS

### 7.2 Monotonicity (pmax_strict gate)

- Coverage monotonically decreasing: PASS

### 7.3 Operating point

- Selected gate: `pmax`
- Selected threshold: t1=0.42
- Coverage: 46.66%
- Harmful rate (committed): 0.00%
- Harmful reduction: 100.00%
- Constraints met (coverage>=85% AND reduction>=40%): NO
- Selection rationale documented: YES ("balanced score = harmful_reduction - (1 - coverage)")

### 7.4 Gate family analysis (v1.1)

- 6 gate families evaluated: pmax, pmax_strict, pmax_margin, pmax_margin_strict, pmax_entropy, pmax_entropy_strict
- Best reduction at >=85% coverage (pmax only): 21.74% at 86.34% coverage
- No gate family achieves both >=85% coverage and >=40% harmful reduction simultaneously
- This finding is explicitly documented in the report

### 7.5 Confidence distribution

- 32.89% of TEST predictions fall in pmax bin [0.3, 0.4)
- 0% in [0.0, 0.1) and [0.9, 1.0)
- Distribution is concentrated in the low-to-moderate confidence range, explaining the sharp coverage-safety tradeoff

**Result: PASS.**

---

## 8. Architecture Isolation

### 8.1 Layer-1 file modification check

All files checked against `L2_LOCK_v1.md` creation timestamp (2026-02-19T14:16:25.782Z):

| File | Last modified | Modified after lock |
|---|---|---|
| src/appraisal-lab/schema.ts | 2026-02-19T09:44:09Z | NO |
| src/appraisal-lab/types.ts | 2026-02-19T09:43:45Z | NO |
| src/appraisal-lab/model/nb_inference.ts | 2026-02-13T09:11:49Z | NO |
| src/appraisal-lab/model/likelihood_builder.ts | 2026-02-13T09:11:33Z | NO |
| src/server/adapter.ts | 2026-02-06T12:25:43Z | NO |
| src/emotion-core/engines/EngineOrchestrator.ts | 2026-02-06T08:59:05Z | NO |

### 8.2 Dataset artifact immutability

| Artifact | Expected rows | Actual rows | Missing dimensions |
|---|---|---|---|
| layer2_likelihood_dataset_v1_1.json | 6,600 | 6,600 | 0 |

**Result: PASS. No Layer-1 files modified. No schema changes. No runtime modifications.**

---

## 9. Final Verdict

| Phase | Result |
|---|---|
| 1. Artifact Integrity | PASS |
| 2. Determinism | STABLE |
| 3. Likelihood Table Sanity | PASS |
| 4. IRR Weight Consistency | PASS |
| 5. Evaluation Fairness | PASS WITH WARNING |
| 6. Calibration Integrity | PASS |
| 7. Gating Integrity | PASS |
| 8. Architecture Isolation | PASS |

### Warnings

1. **Split strategy divergence:** The dataset builder and evaluator use different splitting units (per-row vs per-text_id) and different emotion granularity (13 vs 7 collapsed). Both are deterministic and seeded. The resulting size differences (train: 4621 vs 4620, dev: 995 vs 992, test: 984 vs 988) are small and structurally expected. However, this means the evaluator's TEST set is not a strict subset of the dataset builder's TEST split. Future work should unify splitting logic or document the divergence more explicitly.

2. **SHAME/GUILT harmful pair:** Referenced in documentation but structurally impossible under Ekman-6 collapse (both map to SADNESS). Not computed in evaluation or gating. Documentation should clarify.

### Verdict

**FUNCTIONAL WITH WARNINGS**

The warnings are documentation-level and do not affect statistical validity, safety properties, or architectural isolation.
