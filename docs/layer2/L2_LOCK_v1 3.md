# Layer-2 Lock — v1

## 1. Scope of Layer-2

Layer-2 provides the empirical foundation for LoRa's appraisal inference system. It replaces heuristic rules with statistical distributions derived from the crowd-enVent dataset.
- **What it does:** Grounding of Naive Bayes likelihoods in human-annotated event descriptions; implements reliability-weighted inference, post-hoc calibration, and safety gating.
- **What it does NOT claim:** Universal psychological truth or direct parity with live conversational data without further temporal modeling.
- **Status:** This is the empirical grounding of appraisal inference.

---

## 2. Mapping Specification (Frozen)

**Reference:** `docs/layer2/mapping_spec.md` (v1.1)

- **LoRa-6 Dimensions:** `valence`, `arousal`, `agency`, `control`, `certainty`, `goalRelevance`.
- **Aggregation Rules Summary:**
    - `valence`: Signed difference between `pleasantness` and `unpleasantness`.
    - `arousal`: Mean of normalized `suddenness`, `urgency`, and `attention`.
    - `agency`: Argmax of `self_responsblt`, `other_responsblt`, and `chance_responsblt`.
    - `control`: Weighted composite of `self_control` (0.6), `1 - chance_control` (0.2), and `1 - other_control` (0.2).
    - `certainty`: Mean of normalized `predict_event`, `predict_conseq`, and `familiarity`.
    - `goalRelevance`: Direct normalization of `goal_relevance`.
- **Scaling Method:** Linear normalization of 1–5 Likert scales to [0, 1] via `(x - 1) / 4`.
- **Binning Thresholds:**
    - 3-bin (Valence, Arousal, Control): [0, 0.333), [0.333, 0.667), [0.667, 1.0].
    - 2-bin (Certainty, GoalRelevance): [0, 0.5), [0.5, 1.0].
- **Status:** Mapping specification v1.1 is frozen for Layer-2.

---

## 3. Inter-Rater Reliability (IRR)

**Reference:** `docs/layer2/irr_kappa.md`

- **Emotion Fleiss’ κ:** 0.4746 (Status: UNSTABLE).
- **Per-dimension κ Table (Summarized):**
    - `pleasantness`: 0.7428 (ACCEPTABLE)
    - `unpleasantness`: 0.7154 (ACCEPTABLE)
    - `self_responsblt`: 0.5832 (WEAK)
    - `other_responsblt`: 0.5611 (WEAK)
    - `self_control`: 0.4193 (UNSTABLE)
    - `predict_event`: 0.3494 (UNSTABLE)
- **Weighting Strategy:** Dimension weights in inference are derived directly from these κ values to penalize low-agreement channels.
- **Status:** Reliability weighting is intentional and documented.

---

## 4. Empirical Likelihood Tables

**Reference:** 
- `models/likelihoods/envent_likelihood_writer_v1.json`
- `models/likelihoods/envent_likelihood_reader_v1.json`

- **Training Split Size:** 4,620 rows.
- **Smoothing Method:** Laplace smoothing with α=1.
- **Writer vs Reader Comparison Summary:** All dimensions are stable with max Jensen-Shannon Divergence (JSD) < 0.05. FEAR/control and ANGER/agency dominant bins are consistent across both perspectives.
- **Status:** Confirmed no zero bins and no collapsed distributions.

---

## 5. Proper Evaluation Results

**Reference:** `reports/eval_v1.md`

- **Accuracy:** 47.67%
- **Macro F1:** 0.4225
- **Harmful Confusion Rate:** 7.49%
- **Strongest Dimension:** `valence` (Spearman ρ = 0.9140)
- **Weakest Dimension:** `agency` (Spearman ρ = 0.1714)
- **Note:** Evaluation performed on a full held-out test set (N=988); no selective reporting or "fake wins."

---

## 6. Calibration

**Reference:** `reports/calibration.md`

- **Optimal Temperature (T*):** 0.81
- **Baseline ECE:** 0.072095
- **Post-scaled ECE:** 0.039817
- **Status:** Calibration significantly improves Expected Calibration Error (ECE) but does NOT change classification accuracy or harmful confusion rates.

---

## 7. Gating Validation

**Reference:** `reports/gating_v1_1.md`

- **Baseline Harmful %:** 7.49%
- **Selected Operating Point:** `pmax` gate at threshold `t1=0.42`.
- **Coverage:** 46.66%
- **Harm Reduction %:** 100.00%
- **Accuracy Delta:** +19.36 pp (Baseline 47.67% → Committed 67.03%).
- **Status:** Selected operating point prioritizes safety over coverage (Safety > Coverage).

---

## 8. Bias and Domain Shift

**Reference:** `docs/layer2/shift_notes.md`

- **Prompt Bias:** Writers were primed with emotion labels, likely inflating signal salience and narrative coherence compared to natural chat.
- **Self-report vs Observer Bias:** IRR confirms that internal states (valence) are more reliably captured than external inferences (control, certainty).
- **Chat Domain Gap:** Real-world chat involves short-form compression, mixed emotions, and temporal trajectories not present in static event narratives.
- **Status:** Layer-2 is validated on prompted event descriptions, not live conversational data.

---

## 9. Final Status

Layer-2 v1 is:
- **Empirically grounded** via crowd-enVent.
- **Reliability-weighted** based on IRR.
- **Calibrated** via temperature scaling.
- **Safety-gated** to minimize harmful confusion.
- **Domain-aware** regarding shift risks.

**Remaining weaknesses:**
- Control / certainty instability in text-only inference.
- Anger vs fear ambiguity in low-context turns.
- Static single-turn limitation (no temporal context).

---

## 10. Forward Path

The following modules are scheduled for development to extend the Layer-2 foundation:
- **Pressure Engine:** For multi-turn signal accumulation and smoothing.
- **Escalation Engine:** For modeling transition dynamics and state drift.

These modules will address the current limitation of static, single-turn inference by accumulating signals over time.

---

Layer-2 Lock Status: **FROZEN**  
Version: v1  
Date: 2026-02-19
