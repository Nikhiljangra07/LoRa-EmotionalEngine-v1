# Layer-2 Likelihood Dataset Summary

**Generated:** 2026-02-19
**Spec version:** v1.1
**Seed:** 42 (deterministic Mulberry32 + Fisher-Yates)
**Source:** crowd-enVent_generation.tsv
**Output:** data/layer2/layer2_likelihood_dataset_v1_1.json

---

## Overall

| Property | Value |
|----------|-------|
| Total rows | 6600 |
| Train | 4621 (70.0%) |
| Dev | 995 (15.1%) |
| Test | 984 (14.9%) |

## Emotion Distribution per Split

| Emotion | Total | Train | Dev | Test |
|---------|-------|-------|-----|------|
| anger | 550 | 385 | 83 | 82 |
| boredom | 550 | 385 | 83 | 82 |
| disgust | 550 | 385 | 83 | 82 |
| fear | 550 | 385 | 83 | 82 |
| guilt | 275 | 193 | 41 | 41 |
| joy | 550 | 385 | 83 | 82 |
| no-emotion | 550 | 385 | 83 | 82 |
| pride | 550 | 385 | 83 | 82 |
| relief | 550 | 385 | 83 | 82 |
| sadness | 550 | 385 | 83 | 82 |
| shame | 275 | 193 | 41 | 41 |
| surprise | 550 | 385 | 83 | 82 |
| trust | 550 | 385 | 83 | 82 |

## Bin Distributions per Dimension

**valence**

| Bin | Count | % |
|-----|-------|---|
| NEG | 3391 | 51.4% |
| NEU | 935 | 14.2% |
| POS | 2274 | 34.5% |

**arousal**

| Bin | Count | % |
|-----|-------|---|
| LOW | 944 | 14.3% |
| MED | 3364 | 51.0% |
| HIGH | 2292 | 34.7% |

**agency**

| Bin | Count | % |
|-----|-------|---|
| SELF | 1753 | 26.6% |
| OTHER | 2969 | 45.0% |
| SITUATION | 1878 | 28.5% |

**control**

| Bin | Count | % |
|-----|-------|---|
| LOW | 2295 | 34.8% |
| MED | 2622 | 39.7% |
| HIGH | 1683 | 25.5% |

**certainty**

| Bin | Count | % |
|-----|-------|---|
| LOW | 3310 | 50.2% |
| HIGH | 3290 | 49.8% |

**goalRelevance**

| Bin | Count | % |
|-----|-------|---|
| LOW | 2457 | 37.2% |
| HIGH | 4143 | 62.8% |

---

## Determinism Confirmation

- Seed: `42`
- RNG: Mulberry32
- Shuffle: Fisher-Yates per emotion group
- Emotion groups processed in alphabetical order
- Timestamp: 2026-02-19T12:15:40.535Z
