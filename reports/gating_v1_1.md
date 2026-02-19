# Gating Validation (Coverage vs Safety) — v1.1

Generated: 2026-02-19T14:00:54.796Z
Probability source: calibrated (T=0.81)

## 1) Baseline metrics

- Accuracy: 47.67%
- Harmful confusion: 74/988 (7.49%)
- Coverage: 100%

## 2) Gate family summary

| Gate family | Best harmful reduction @ coverage>=85% | Best coverage @ harmful reduction>=40% | Absolute best harmful reduction |
|---|---|---|---|
| pmax | 21.74% (cov 86.34%) | 71.36% (red 41.29%) | 100.00% (cov 46.66%) |
| pmax_strict | none | 77.94% (red 44.51%) | 100.00% (cov 46.66%) |
| pmax_margin | none | 63.66% (red 44.81%) | 100.00% (cov 44.33%) |
| pmax_margin_strict | none | 72.27% (red 42.03%) | 100.00% (cov 44.33%) |
| pmax_entropy | none | 64.57% (red 43.50%) | 100.00% (cov 46.66%) |
| pmax_entropy_strict | none | 67.41% (red 41.86%) | 100.00% (cov 46.66%) |

**No operating point satisfies both constraints.**

## 3) Tradeoff table (compact)

| Gate | Threshold config | Coverage | Accuracy | Harmful rate | Harmful reduction |
|---|---|---:|---:|---:|---:|
| pmax | t1=0.30 | 86.34% | 51.58% | 5.86% | 21.74% |
| pmax_strict | t1=0.42 | 46.66% | 67.03% | 0.00% | 100.00% |
| pmax_margin | t1=0.42, t2=0.05 | 44.33% | 68.72% | 0.00% | 100.00% |
| pmax_margin_strict | t1=0.42, t2=0.05 | 44.33% | 68.72% | 0.00% | 100.00% |
| pmax_entropy | t1=0.42, t3=0.85 | 46.66% | 67.03% | 0.00% | 100.00% |
| pmax_entropy_strict | t1=0.42, t3=0.85 | 46.66% | 67.03% | 0.00% | 100.00% |

## 4) Confidence Distribution (TEST)

| pmax bin | Count | Percentage |
|---|---:|---:|
| 0.0-0.1 | 0 | 0.00% |
| 0.1-0.2 | 6 | 0.61% |
| 0.2-0.3 | 129 | 13.06% |
| 0.3-0.4 | 325 | 32.89% |
| 0.4-0.5 | 181 | 18.32% |
| 0.5-0.6 | 120 | 12.15% |
| 0.6-0.7 | 103 | 10.43% |
| 0.7-0.8 | 78 | 7.89% |
| 0.8-0.9 | 46 | 4.66% |
| 0.9-1.0 | 0 | 0.00% |

## 5) Selected operating point

- Gate: pmax
- Threshold config: t1=0.42
- Coverage: 46.66%
- Accuracy (committed): 67.03%
- Harmful rate (committed): 0.00%
- Harmful reduction: 100.00%
- Abstention rate: 53.34%
- Selection rationale: No operating point satisfies both constraints; selected by balanced score = harmful_reduction - (1 - coverage).

## 6) Interpretation

- Gating is evaluated as a safety filter: harmful reduction is primary, and coverage quantifies usability cost.
- Accuracy can rise from abstention; this is expected and should not be interpreted as model improvement.
- The target (coverage >=85% and harmful reduction >=40%) is reported explicitly as achievable or not under current distributions.
- Performance limits are tied to confidence concentration, class collapse (13->Ekman-6+Neutral), and reliability-weighted inference behavior; this step does not alter those mechanics.
