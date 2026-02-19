# Calibration Report

Generated: 2026-02-19T13:44:46.659Z

## Dataset Size

- Dev: 992
- Test: 988

## Baseline Metrics (Test)

- Accuracy: 47.67%
- Macro F1: 0.4225
- ECE: 0.072095
- MCE: 0.187205
- Brier: 0.644471
- Harmful confusion: 74/988 (7.49%)

## Optimal Temperature

- T*: 0.81
- Dev NLL at T*: 1.363899

## Post-Scaling Metrics (Test)

- Accuracy: 47.67% (Δ 0.00pp)
- Macro F1: 0.4225
- ECE: 0.039817 (Δ -0.032279)
- MCE: 0.193084
- Brier: 0.636073
- Harmful confusion: 74/988 (7.49%, Δ 0.00pp)

## Reliability Table (10 bins)

| Bin | Baseline mean conf | Baseline acc | Baseline count | Scaled mean conf | Scaled acc | Scaled count |
|---|---:|---:|---:|---:|---:|---:|
| 0.0-0.1 | 0.0000 | 0.0000 | 0 | 0.0000 | 0.0000 | 0 |
| 0.1-0.2 | 0.1872 | 0.0000 | 9 | 0.1931 | 0.0000 | 6 |
| 0.2-0.3 | 0.2689 | 0.2603 | 292 | 0.2710 | 0.2403 | 129 |
| 0.3-0.4 | 0.3433 | 0.4037 | 270 | 0.3434 | 0.3200 | 325 |
| 0.4-0.5 | 0.4569 | 0.5145 | 138 | 0.4427 | 0.4586 | 181 |
| 0.5-0.6 | 0.5447 | 0.6944 | 144 | 0.5511 | 0.5667 | 120 |
| 0.6-0.7 | 0.6596 | 0.8354 | 79 | 0.6374 | 0.7573 | 103 |
| 0.7-0.8 | 0.7442 | 0.8750 | 56 | 0.7546 | 0.8590 | 78 |
| 0.8-0.9 | 0.0000 | 0.0000 | 0 | 0.8392 | 0.8696 | 46 |
| 0.9-1.0 | 0.0000 | 0.0000 | 0 | 0.0000 | 0.0000 | 0 |

## Interpretation

- Baseline model is underconfident on average by reliability-bin gap sign.
- ECE improved after temperature scaling.
- Accuracy unchanged by 0.00 percentage points.
- Harmful confusion unchanged by 0.00 percentage points.
- Entropy gate threshold interpretation should be revisited only if calibrated confidence materially shifts commit/hedge operating points.
