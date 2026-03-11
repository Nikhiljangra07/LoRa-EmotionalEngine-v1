# Layer-2 Mapping Sanity Report (Spec v1)

**Generated:** 2026-02-19
**Spec:** docs/layer2/mapping_spec.md v1
**Dataset:** crowd-enVent_generation.tsv
**Script:** src/appraisal-lab/cli/validate_mapping.ts --spec v1
**Control formula:** `max(norm(self_control), norm(other_control))`

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
| control | 0.000 | 1.000 | 0.738 | 0.750 | 0.303 | OK |
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

**control** (3-bin: LOW / MED / HIGH) — max(self, other)

| Bin | Count | % |
|-----|-------|---|
| LOW | 881 | 13.3% |
| MED | 857 | 13.0% |
| HIGH | 4862 | 73.7% |

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
| anger | 550 | 0.084 | 0.676 | OTHER (77.6%) | 0.834 | 0.467 | 0.521 | valence↓(0.34), control↑(0.10) |
| boredom | 550 | 0.250 | 0.374 | OTHER (37.8%) | 0.717 | 0.644 | 0.297 | goalRelevance↓(0.23), arousal↓(0.21) |
| disgust | 550 | 0.068 | 0.642 | OTHER (63.8%) | 0.764 | 0.381 | 0.319 | valence↓(0.36), goalRelevance↓(0.21) |
| fear | 550 | 0.087 | 0.759 | SITUATION (45.1%) | 0.674 | 0.341 | 0.605 | valence↓(0.34), arousal↑(0.17) |
| guilt | 275 | 0.184 | 0.561 | SELF (57.5%) | 0.684 | 0.479 | 0.591 | valence↓(0.24), goalRelevance↑(0.06) |
| joy | 550 | 0.930 | 0.539 | OTHER (42.5%) | 0.795 | 0.533 | 0.581 | valence↑(0.51), certainty↑(0.07) |
| no-emotion | 550 | 0.538 | 0.413 | SELF (40.9%) | 0.737 | 0.633 | 0.311 | goalRelevance↓(0.22), arousal↓(0.17) |
| pride | 550 | 0.887 | 0.536 | SELF (47.6%) | 0.807 | 0.496 | 0.599 | valence↑(0.46), goalRelevance↑(0.07) |
| relief | 550 | 0.595 | 0.615 | SITUATION (36.0%) | 0.687 | 0.453 | 0.715 | goalRelevance↑(0.19), valence↑(0.17) |
| sadness | 550 | 0.060 | 0.637 | SITUATION (46.5%) | 0.592 | 0.400 | 0.617 | valence↓(0.36), control↓(0.15) |
| shame | 275 | 0.099 | 0.617 | SELF (54.9%) | 0.672 | 0.453 | 0.590 | valence↓(0.33), control↓(0.07) |
| surprise | 550 | 0.787 | 0.683 | OTHER (58.0%) | 0.770 | 0.285 | 0.545 | valence↑(0.36), certainty↓(0.18) |
| trust | 550 | 0.667 | 0.591 | OTHER (52.7%) | 0.805 | 0.471 | 0.615 | valence↑(0.24), goalRelevance↑(0.09) |

---

## D. Correlation Matrix (Continuous Dimensions)

Pearson r across all rows. Agency excluded (categorical).

| | valence | arousal | control | certainty | goalRel |
|---|---------|---------|---------|-----------|---------|
| valence | 1.000 | -0.207 | 0.138 | 0.140 | 0.034 |
| arousal | -0.207 | 1.000 | 0.024 | -0.327 | 0.274 |
| control | 0.138 | 0.024 | 1.000 | 0.124 | 0.030 |
| certainty | 0.140 | -0.327 | 0.124 | 1.000 | -0.025 |
| goalRel | 0.034 | 0.274 | 0.030 | -0.025 | 1.000 |

---

## E. Red Flags

No red flags detected.

### Appraisal-theory expectation checks

These are soft checks against common appraisal-theory predictions. Deviations are not
necessarily bugs — they may reflect genuine empirical patterns in crowd-sourced data.

- **anger** / valence: expected below 0.333 (NEG), actual = 0.084
- **anger** / agency: expected majority OTHER, actual = OTHER:77.6%, SITUATION:16.4%, SELF:6.0%
- **fear** / control: expected low (< 0.40), actual = 0.674
- **joy** / valence: expected above 0.667 (POS), actual = 0.930
- **sadness** / arousal: expected low (< 0.40) under physiological def; acceptable under cognitive-activation def, actual = 0.637
- **surprise** / certainty: expected low (< 0.40), actual = 0.285
- **disgust** / valence: expected below 0.333 (NEG), actual = 0.068

---

## F. Spec Issues Detected

Automated checks for internal consistency of mapping_spec.md v1:

**2 notice(s) (not errors, but worth reviewing):**

- NOTICE: certainty bin2 threshold at 0.500 means Likert midpoint (3) across all inputs → certainty=HIGH (HIGH). Midpoint-imputed rows will always be HIGH. This is a known asymmetry of the 2-bin threshold being at 0.5 exactly.
- NOTICE: goalRelevance bin2 threshold at 0.500 means Likert midpoint (3) → goalRelevance=HIGH (HIGH). Same midpoint asymmetry as certainty.

---

## Appendix: Verification Checksums

Spot-check values for the first 5 rows to enable manual verification against spec pseudocode.

| row | text_id | emotion | val_c | aro_c | agency | ctrl_c | cert_c | goal_c |
|-----|---------|---------|-------|-------|--------|--------|--------|--------|
| 1 | 215 | anger | 0.000 | 0.250 | OTHER | 0.750 | 0.917 | 0.250 |
| 2 | 216 | anger | 0.000 | 1.000 | OTHER | 0.750 | 0.417 | 0.750 |
| 3 | 217 | anger | 0.250 | 0.333 | OTHER | 0.500 | 0.333 | 0.500 |
| 4 | 218 | anger | 0.000 | 0.917 | OTHER | 1.000 | 0.750 | 0.500 |
| 5 | 219 | anger | 0.125 | 1.000 | OTHER | 1.000 | 0.167 | 0.750 |
