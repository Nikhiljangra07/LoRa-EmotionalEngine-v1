# Proper Evaluation v1

Generated: 2026-02-19T13:36:13.454Z

## 1) Split Summary

- Train: 4620
- Dev: 992
- Test: 988

## 2) Emotion Classification Results

- Accuracy: 47.67%
- Macro F1: 0.4225

| Class | Precision | Recall | F1 | Support |
|---|---:|---:|---:|---:|
| ANGER | 0.2749 | 0.5732 | 0.3715 | 82 |
| DISGUST | 0.3364 | 0.4390 | 0.3810 | 82 |
| FEAR | 0.2588 | 0.2683 | 0.2635 | 82 |
| JOY | 0.7724 | 0.6273 | 0.6923 | 330 |
| NEUTRAL | 0.4741 | 0.3879 | 0.4267 | 165 |
| SADNESS | 0.4576 | 0.3273 | 0.3816 | 165 |
| SURPRISE | 0.3942 | 0.5000 | 0.4409 | 82 |

## 3) Confusion Matrix

Gold \\ Pred | ANGER | DISGUST | FEAR | JOY | NEUTRAL | SADNESS | SURPRISE
--- | --- | --- | --- | --- | --- | --- | ---
ANGER | 47 | 15 | 8 | 1 | 4 | 6 | 1
DISGUST | 26 | 36 | 5 | 0 | 7 | 8 | 0
FEAR | 25 | 10 | 22 | 2 | 9 | 13 | 1
JOY | 9 | 5 | 7 | 207 | 31 | 15 | 56
NEUTRAL | 13 | 21 | 13 | 28 | 64 | 22 | 4
SADNESS | 43 | 16 | 27 | 7 | 17 | 54 | 1
SURPRISE | 8 | 4 | 3 | 23 | 3 | 0 | 41

## 4) Harmful Confusion Analysis

- Harmful pairs evaluated: ANGER↔FEAR, ANGER↔DISGUST
- Harmful misclassifications: 74 / 988
- Harmful confusion rate: 7.49%

## 5) Appraisal Prediction Metrics

| Dimension | MAE (1-5) | Spearman | Bin Accuracy |
|---|---:|---:|---:|
| valence | 0.2672 | 0.9140 | 87.04% |
| goalRelevance | 0.8340 | 0.5352 | 79.15% |
| certainty | 1.2105 | 0.4001 | 69.74% |
| control | 1.1215 | 0.3615 | 44.74% |
| arousal | 0.9312 | 0.3327 | 55.67% |
| agency | 0.9555 | 0.1714 | 59.62% |

## 6) Observations

- Strong dimensions (ρ ≥ 0.5): valence, goalRelevance
- Weak dimensions (ρ < 0.3): agency
- Highest Spearman: valence (0.9140)
- Lowest Spearman: agency (0.1714)
- Harmful confusion remained 7.49% on TEST.
