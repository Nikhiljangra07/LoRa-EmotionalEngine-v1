# Layer-2 Dimension Reliability Weights

**Generated:** 2026-02-19
**Source:** data/layer2/irr_kappa_table.csv
**Method:** IRR κ → weight tier mapping

---

## Weight Tiers

| κ Range | Weight | Tier |
|---------|--------|------|
| ≥ 0.60 | 1.00 | FULL |
| 0.50–0.59 | 0.60 | MODERATE |
| 0.40–0.49 | 0.30 | REDUCED |
| < 0.40 | 0.15 | MINIMAL |

---

## Per-Dimension Results

| LoRa Dimension | Source Columns | Raw κ values | Aggregated κ | Weight | Tier |
|---------------|---------------|-------------|-------------|--------|------|
| valence | pleasantness, unpleasantness | 0.7428, 0.7154 | 0.7291 | 1.00 | FULL (κ ≥ 0.60) |
| arousal | suddenness, urgency, attention | 0.4911, 0.2667, 0.2376 | 0.3318 | 0.15 | MINIMAL (κ < 0.40) |
| agency | self_responsblt, other_responsblt, chance_responsblt | 0.5832, 0.5611, 0.3583 | 0.5008 | 0.60 | MODERATE (0.50–0.59) |
| control | self_control, other_control, chance_control | 0.4193, 0.4347, 0.3449 | 0.3996 | 0.15 | MINIMAL (κ < 0.40) |
| certainty | predict_event, predict_conseq, familiarity | 0.3494, 0.2265, 0.3869 | 0.3209 | 0.15 | MINIMAL (κ < 0.40) |
| goalRelevance | goal_relevance | 0.3758 | 0.3758 | 0.15 | MINIMAL (κ < 0.40) |

---

## Implications

These weights are used as exponents in Layer-2 experimental inference:

```
log P(E|D) += w_i * log P(D_i | E)
```

Dimensions with low IRR contribute less to the posterior,
reflecting their inherent measurement noise.
