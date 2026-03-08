# Gating Validation (Coverage vs Safety)

Generated: 2026-02-19T13:51:24.508Z
Probability source: calibrated (T=0.81)

## 1) Baseline metrics (No Gating)

- Accuracy: 47.67%
- Harmful confusion: 74/988 (7.49%)
- Coverage: 100%

## 2) Curve Summary Table

| Threshold | Coverage | Accuracy(committed) | Harmful Rate(committed) | Harmful Reduction | Avg Entropy | Avg Margin | Abstained |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 0.30 | 86.3% | 51.6% | 5.86% | 21.7% | 0.6674 | 0.2496 | 135 |
| 0.45 | 43.1% | 68.5% | 0.00% | 100.0% | 0.5006 | 0.3772 | 562 |
| 0.60 | 23.0% | 81.5% | 0.00% | 100.0% | 0.4335 | 0.5403 | 761 |
| 0.75 | 10.2% | 87.1% | 0.00% | 100.0% | 0.3589 | 0.6907 | 887 |

## 3) Selected Operating Point

Selected Threshold: 0.32
Coverage: 74.9%
Accuracy (committed): 55.4%
Harmful Reduction: 35.0%
Abstention Rate: 25.1%
- Fallback used: yes (no threshold met coverage>=85% AND harmful reduction>=40%).

## 4) Interpretation

- Gating is a safety mechanism: it reduces harmful errors by abstaining on low-confidence cases.
- Committed-only accuracy can rise due to abstention; this is expected and should be interpreted with coverage.
- Coverage and safety are a direct tradeoff; higher thresholds are more conservative.
- The selected point is conservative based on coverage 74.9%.
