# Rule Mapper Validation (Layer-2 Step 3)

- Gold rows (test): 179
- Rule rows usable: 75
- Comparable rows: 75

## Per-Dimension Metrics

| Dimension | Spearman ρ | MAE (1-5) | Bin Accuracy | Interpretation |
|---|---:|---:|---:|---|
| valence | 0.7445 | 0.3933 | 86.7% | Strong |
| arousal | 0.4834 | 1.0667 | 53.3% | Moderate |
| agency | 0.4244 | 0.9600 | 60.0% | Moderate |
| certainty | 0.2702 | 2.0444 | 52.0% | Weak |
| control | 0.2061 | 1.5440 | 41.3% | Weak |
| goalRelevance | 0.0000 | 1.4533 | 80.0% | Weak |

## Confusion Matrices

### valence

Gold \\ Rule | NEG | NEU | POS
--- | --- | --- | ---
NEG | 52 | 0 | 1
NEU | 6 | 0 | 1
POS | 2 | 0 | 13

### arousal

Gold \\ Rule | HIGH | LOW | MED
--- | --- | --- | ---
HIGH | 21 | 3 | 9
LOW | 1 | 4 | 6
MED | 8 | 8 | 15

### agency

Gold \\ Rule | OTHER | SELF | SITUATION
--- | --- | --- | ---
OTHER | 22 | 4 | 12
SELF | 4 | 10 | 5
SITUATION | 4 | 1 | 13

### control

Gold \\ Rule | HIGH | LOW | MED
--- | --- | --- | ---
HIGH | 11 | 2 | 0
LOW | 10 | 12 | 7
MED | 9 | 16 | 8

### certainty

Gold \\ Rule | HIGH | LOW
--- | --- | ---
HIGH | 27 | 3
LOW | 33 | 12

### goalRelevance

Gold \\ Rule | HIGH | LOW
--- | --- | ---
HIGH | 60 | 0
LOW | 15 | 0

## Interpretation

- Strong: ρ ≥ 0.5
- Moderate: 0.3 ≤ ρ < 0.5
- Weak: ρ < 0.3

### Dimensions Sorted by Spearman

- valence: ρ=0.7445, MAE=0.3933, acc=86.7%
- arousal: ρ=0.4834, MAE=1.0667, acc=53.3%
- agency: ρ=0.4244, MAE=0.9600, acc=60.0%
- certainty: ρ=0.2702, MAE=2.0444, acc=52.0%
- control: ρ=0.2061, MAE=1.5440, acc=41.3%
- goalRelevance: ρ=0.0000, MAE=1.4533, acc=80.0%

### Worst Dimension
- goalRelevance (ρ=0.0000)
