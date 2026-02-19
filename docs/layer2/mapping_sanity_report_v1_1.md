# Layer-2 Mapping Sanity Report (Spec v1.1)

**Generated:** 2026-02-19
**Spec:** docs/layer2/mapping_spec.md v1.1
**Dataset:** crowd-enVent_generation.tsv
**Script:** src/appraisal-lab/cli/validate_mapping.ts --spec v1.1
**Control formula:** `0.6·norm(self_control) + 0.2·(1−norm(chance_control)) + 0.2·(1−norm(other_control))`

---

## A. Dataset Summary

| Property | Value |
|----------|-------|
| Raw rows parsed | 6600 |
| Rows after mapping (all 13 emotions) | 6600 |
| Distinct emotion labels | 13 |
| Rows mappable to LoRa emotions | 3850 (58.3%) |
| Rows excluded (unmappable emotion) | 2750 (41.7%) |
| Valence-conflict flags (pleasant≥4 & unpleasant≥4) | 57 |
| Avoidance flags (not_consider≥4) | 2197 |
| Rows with 3+ imputed appraisal cols | 0 |

### Emotion distribution

| Emotion | Count | % | LoRa mapping |
|---------|-------|---|-------------|
| anger | 550 | 8.3% | ANGER |
| boredom | 550 | 8.3% | —(excluded) |
| disgust | 550 | 8.3% | DISGUST |
| fear | 550 | 8.3% | FEAR |
| guilt | 275 | 4.2% | —(excluded) |
| joy | 550 | 8.3% | JOY |
| no-emotion | 550 | 8.3% | NEUTRAL |
| pride | 550 | 8.3% | —(excluded) |
| relief | 550 | 8.3% | —(excluded) |
| sadness | 550 | 8.3% | SADNESS |
| shame | 275 | 4.2% | —(excluded) |
| surprise | 550 | 8.3% | SURPRISE |
| trust | 550 | 8.3% | —(excluded) |

---

## B. Per-Dimension Statistics

### Continuous scores [0, 1]

| Dimension | Min | Max | Mean | Median | Std | Range valid? |
|-----------|-----|-----|------|--------|-----|-------------|
| valence | 0.000 | 1.000 | 0.425 | 0.250 | 0.412 | OK |
| arousal | 0.000 | 1.000 | 0.588 | 0.583 | 0.263 | OK |
| control | 0.000 | 1.000 | 0.468 | 0.450 | 0.264 | OK |
| certainty | 0.000 | 1.000 | 0.464 | 0.417 | 0.288 | OK |
| goalRelevance | 0.000 | 1.000 | 0.526 | 0.500 | 0.375 | OK |

### Bin distributions

**valence** (3-bin: NEG / NEU / POS)

| Bin | Count | % |
|-----|-------|---|
| NEG | 3391 | 51.4% |
| NEU | 935 | 14.2% |
| POS | 2274 | 34.5% |

**arousal** (3-bin: LOW / MED / HIGH) — cognitive-activation composite

| Bin | Count | % |
|-----|-------|---|
| LOW | 944 | 14.3% |
| MED | 3364 | 51.0% |
| HIGH | 2292 | 34.7% |

**agency** (categorical: SELF / OTHER / SITUATION)

| Bin | Count | % |
|-----|-------|---|
| SELF | 1753 | 26.6% |
| OTHER | 2969 | 45.0% |
| SITUATION | 1878 | 28.5% |

**control** (3-bin: LOW / MED / HIGH) — personal-controllability composite

| Bin | Count | % |
|-----|-------|---|
| LOW | 2295 | 34.8% |
| MED | 2622 | 39.7% |
| HIGH | 1683 | 25.5% |

**certainty** (2-bin: LOW / HIGH)

| Bin | Count | % |
|-----|-------|---|
| LOW | 3310 | 50.2% |
| HIGH | 3290 | 49.8% |

**goalRelevance** (2-bin: LOW / HIGH)

| Bin | Count | % |
|-----|-------|---|
| LOW | 2457 | 37.2% |
| HIGH | 4143 | 62.8% |

---

## C. Per-Emotion Mean LoRa-6 Vectors

Continuous scores averaged over all rows for each emotion. Agency shown as majority bin.

| Emotion | n | valence | arousal | agency (mode) | control | certainty | goalRel | top-2 distinctive dims |
|---------|---|---------|---------|--------------|---------|-----------|---------|----------------------|
| anger | 550 | 0.084 | 0.676 | OTHER (77.6%) | 0.394 | 0.467 | 0.521 | valence↓(0.34), arousal↑(0.09) |
| boredom | 550 | 0.250 | 0.374 | OTHER (37.8%) | 0.457 | 0.644 | 0.297 | goalRelevance↓(0.23), arousal↓(0.21) |
| disgust | 550 | 0.068 | 0.642 | OTHER (63.8%) | 0.379 | 0.381 | 0.319 | valence↓(0.36), goalRelevance↓(0.21) |
| fear | 550 | 0.087 | 0.759 | SITUATION (45.1%) | 0.386 | 0.341 | 0.605 | valence↓(0.34), arousal↑(0.17) |
| guilt | 275 | 0.184 | 0.561 | SELF (57.5%) | 0.624 | 0.479 | 0.591 | valence↓(0.24), control↑(0.16) |
| joy | 550 | 0.930 | 0.539 | OTHER (42.5%) | 0.574 | 0.533 | 0.581 | valence↑(0.51), control↑(0.11) |
| no-emotion | 550 | 0.538 | 0.413 | SELF (40.9%) | 0.541 | 0.633 | 0.311 | goalRelevance↓(0.22), arousal↓(0.17) |
| pride | 550 | 0.887 | 0.536 | SELF (47.6%) | 0.564 | 0.496 | 0.599 | valence↑(0.46), control↑(0.10) |
| relief | 550 | 0.595 | 0.615 | SITUATION (36.0%) | 0.464 | 0.453 | 0.715 | goalRelevance↑(0.19), valence↑(0.17) |
| sadness | 550 | 0.060 | 0.637 | SITUATION (46.5%) | 0.335 | 0.400 | 0.617 | valence↓(0.36), control↓(0.13) |
| shame | 275 | 0.099 | 0.617 | SELF (54.9%) | 0.541 | 0.453 | 0.590 | valence↓(0.33), control↑(0.07) |
| surprise | 550 | 0.787 | 0.683 | OTHER (58.0%) | 0.418 | 0.285 | 0.545 | valence↑(0.36), certainty↓(0.18) |
| trust | 550 | 0.667 | 0.591 | OTHER (52.7%) | 0.522 | 0.471 | 0.615 | valence↑(0.24), goalRelevance↑(0.09) |

---

## D. Correlation Matrix (Continuous Dimensions)

Pearson r across all rows. Agency excluded (categorical).

| | valence | arousal | control | certainty | goalRel |
|---|---------|---------|---------|-----------|---------|
| valence | 1.000 | -0.207 | 0.253 | 0.140 | 0.034 |
| arousal | -0.207 | 1.000 | -0.119 | -0.327 | 0.274 |
| control | 0.253 | -0.119 | 1.000 | 0.303 | 0.010 |
| certainty | 0.140 | -0.327 | 0.303 | 1.000 | -0.025 |
| goalRel | 0.034 | 0.274 | 0.010 | -0.025 | 1.000 |

---

## E. Red Flags

No red flags detected.

### Appraisal-theory expectation checks

These are soft checks against common appraisal-theory predictions. Deviations are not
necessarily bugs — they may reflect genuine empirical patterns in crowd-sourced data.

- **anger** / valence: expected below 0.333 (NEG), actual = 0.084
- **anger** / agency: expected majority OTHER, actual = OTHER:77.6%, SITUATION:16.4%, SELF:6.0%
- **fear** / control: expected low (< 0.40), actual = 0.386
- **joy** / valence: expected above 0.667 (POS), actual = 0.930
- **sadness** / arousal: expected low (< 0.40) under physiological def; acceptable under cognitive-activation def, actual = 0.637
- **surprise** / certainty: expected low (< 0.40), actual = 0.285
- **disgust** / valence: expected below 0.333 (NEG), actual = 0.068

---

## F. Spec Issues Detected

Automated checks for internal consistency of mapping_spec.md v1.1:

**3 notice(s) (not errors, but worth reviewing):**

- NOTICE: certainty bin2 threshold at 0.500 means Likert midpoint (3) across all inputs → certainty=HIGH (HIGH). Midpoint-imputed rows will always be HIGH. This is a known asymmetry of the 2-bin threshold being at 0.5 exactly.
- NOTICE: goalRelevance bin2 threshold at 0.500 means Likert midpoint (3) → goalRelevance=HIGH (HIGH). Same midpoint asymmetry as certainty.
- NOTICE: v1.1 control at Likert midpoint (all=3): 0.6·0.5 + 0.2·0.5 + 0.2·0.5 = 0.500 → MED. Midpoint-imputed rows get MED control.

---

## G. v1 → v1.1 Control Comparison

Both v1 and v1.1 control scores were computed for every row. This section shows the deltas.

### Overall control statistics

| Metric | v1 | v1.1 | Delta |
|--------|-----|------|-------|
| Mean | 0.738 | 0.468 | -0.270 |
| Median | 0.750 | 0.450 | -0.300 |
| Std | 0.303 | 0.264 | — |
| Min | 0.000 | 0.000 | — |
| Max | 1.000 | 1.000 | — |

### Control bin distribution change

| Bin | v1 count | v1 % | v1.1 count | v1.1 % | Δ count | Δ pp |
|-----|---------|------|-----------|--------|---------|------|
| LOW | 881 | 13.3% | 2295 | 34.8% | +1414 | +21.4pp |
| MED | 857 | 13.0% | 2622 | 39.7% | +1765 | +26.7pp |
| HIGH | 4862 | 73.7% | 1683 | 25.5% | -3179 | -48.2pp |

### Per-emotion control mean: v1 vs v1.1

| Emotion | n | v1 mean | v1.1 mean | Delta | v1 bin (mode) | v1.1 bin (mode) | Improved? |
|---------|---|---------|-----------|-------|--------------|----------------|-----------|
| anger | 550 | 0.834 | 0.394 | -0.440 | HIGH | MED | WATCH |
| boredom | 550 | 0.717 | 0.457 | -0.260 | HIGH | MED | — |
| disgust | 550 | 0.764 | 0.379 | -0.385 | HIGH | MED | — |
| fear **←** | 550 | 0.674 | 0.386 | -0.288 | HIGH | MED | YES (↓ toward expected LOW) |
| guilt | 275 | 0.684 | 0.624 | -0.060 | HIGH | MED | — |
| joy | 550 | 0.795 | 0.574 | -0.221 | HIGH | MED | WATCH |
| no-emotion | 550 | 0.737 | 0.541 | -0.196 | HIGH | MED | — |
| pride | 550 | 0.807 | 0.564 | -0.243 | HIGH | MED | WATCH |
| relief | 550 | 0.687 | 0.464 | -0.224 | HIGH | MED | — |
| sadness | 550 | 0.592 | 0.335 | -0.257 | MED | MED | YES (↓ toward expected LOW) |
| shame | 275 | 0.672 | 0.541 | -0.131 | HIGH | MED | — |
| surprise | 550 | 0.770 | 0.418 | -0.351 | HIGH | MED | — |
| trust | 550 | 0.805 | 0.522 | -0.284 | HIGH | MED | — |

### FEAR control spotlight

- **v1 mean control:** 0.674 (bin: HIGH) — appraisal theory expects LOW
- **v1.1 mean control:** 0.386 (bin: MED)
- **Delta:** -0.288
- **Interpretation:** Now aligns with appraisal-theory expectation (low personal control for fear).

---

## H. Control Component Correlations

Pearson r between the v1.1 control composite and each of its input columns (normed).
Validates the formula's directional behavior.

| Component | Pearson r | Expected sign | Match? |
|-----------|----------|---------------|--------|
| self_control (weight 0.6, direct) | 0.937 | positive | YES |
| chance_control (weight 0.2, inverted) | -0.420 | negative | YES |
| other_control (weight 0.2, inverted) | -0.387 | negative | YES |

All three component correlations match expected signs. The v1.1 formula is behaving as designed.

---

## Appendix: Verification Checksums

Spot-check values for the first 5 rows to enable manual verification against spec pseudocode.

| row | text_id | emotion | val_c | aro_c | agency | ctrl_v1 | ctrl_v1.1 | cert_c | goal_c |
|-----|---------|---------|-------|-------|--------|---------|-----------|--------|--------|
| 1 | 215 | anger | 0.000 | 0.250 | OTHER | 0.750 | 0.850 | 0.917 | 0.250 |
| 2 | 216 | anger | 0.000 | 1.000 | OTHER | 0.750 | 0.550 | 0.417 | 0.750 |
| 3 | 217 | anger | 0.250 | 0.333 | OTHER | 0.500 | 0.350 | 0.333 | 0.500 |
| 4 | 218 | anger | 0.000 | 0.917 | OTHER | 1.000 | 0.200 | 0.750 | 0.500 |
| 5 | 219 | anger | 0.125 | 1.000 | OTHER | 1.000 | 0.350 | 0.167 | 0.750 |
