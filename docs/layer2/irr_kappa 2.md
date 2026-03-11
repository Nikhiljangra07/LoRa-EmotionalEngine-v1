# Inter-Rater Reliability Report

**Generated:** 2026-02-19
**Source:** crowd-enVent_validation.tsv
**Unique texts:** 1200
**Raters per text:** 5
**Method (appraisals):** Weighted Cohen's kappa (quadratic), pooled pairwise
**Method (emotion):** Fleiss' kappa

---

## Emotion Agreement

| Measure | Value | Status |
|---------|-------|--------|
| Fleiss' kappa (13 emotions) | 0.4746 | UNSTABLE |

## Appraisal Dimension Agreement

| Dimension | Weighted κ (quadratic) | Status |
|-----------|----------------------|--------|
| suddenness | 0.4911 | UNSTABLE |
| familiarity | 0.3869 | UNSTABLE |
| predict_event | 0.3494 | UNSTABLE |
| pleasantness | 0.7428 | ACCEPTABLE |
| unpleasantness | 0.7154 | ACCEPTABLE |
| goal_relevance | 0.3758 | UNSTABLE |
| chance_responsblt | 0.3583 | UNSTABLE |
| self_responsblt | 0.5832 | WEAK |
| other_responsblt | 0.5611 | WEAK |
| predict_conseq | 0.2265 | UNSTABLE |
| goal_support | 0.5674 | WEAK |
| urgency | 0.2667 | UNSTABLE |
| self_control | 0.4193 | UNSTABLE |
| other_control | 0.4347 | UNSTABLE |
| chance_control | 0.3449 | UNSTABLE |
| accept_conseq | 0.0915 | UNSTABLE |
| standards | 0.4876 | UNSTABLE |
| social_norms | 0.5390 | WEAK |
| attention | 0.2376 | UNSTABLE |
| not_consider | 0.4914 | UNSTABLE |
| effort | 0.3575 | UNSTABLE |

## Summary Counts

| Status | Count |
|--------|-------|
| ACCEPTABLE (κ ≥ 0.60) | 2 |
| WEAK (0.50 ≤ κ < 0.60) | 4 |
| UNSTABLE (κ < 0.50) | 15 |

---

## Interpretation

- **15 of 21 appraisal dimensions are UNSTABLE (κ < 0.50).** This suggests that bin collapse or dimension merging should be considered for low-agreement dimensions before using them in likelihood estimation.

- **Emotion Fleiss' κ = 0.4746 (< 0.60).** Reader emotion perception is noisy. This is expected for crowd-sourced data with fine-grained emotion categories. Appraisal-based inference may be more reliable than categorical emotion labels.
