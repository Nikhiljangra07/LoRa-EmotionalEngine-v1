# Appraisal Inference Layer — Layered Design (LoRa V1)

**Module name:** Appraisal Inference Layer (Appraisal-Lab)
**Location:** `src/appraisal-lab/`
**Status:** Layer 1.5 (Dataset Completion)

---

## 1. Layer System

This module follows a strict layered architecture. Each layer has a defined scope, explicit boundaries, and clear upgrade criteria. No layer assumes the existence of layers above it.

### Layer 1: Skeleton

**Status: Complete.**

Layer 1 establishes the engineering infrastructure for appraisal-based emotion classification. It includes:

| Component | File(s) | Purpose |
|-----------|---------|---------|
| Type system | `types.ts` | Locked types for 6 emotions, 6 appraisal dimensions, all bin values |
| Schema & validation | `schema.ts` | Canonical constants, row validation |
| Synthetic generator | `dataset/generator.ts` | Seeded PRNG-based dataset generation (for pipeline testing) |
| Naive Bayes model | `model/likelihood_builder.ts`, `model/nb_inference.ts` | Laplace-smoothed likelihood tables, log-space inference |
| Evaluation | `model/metrics.ts` | 80/20 split, accuracy, confusion matrix, avg max probability |
| CLI tools | `cli/generate_dataset.ts`, `cli/build_likelihood.ts`, `cli/eval_holdout.ts`, `cli/run_inference.ts` | Full pipeline execution |
| Tests | `__tests__/dataset_generator.test.ts`, `__tests__/likelihood_builder.test.ts`, `__tests__/nb_inference.test.ts` | 29 deterministic tests |

**Intentionally excluded from Layer 1:**

- No big engine integration
- No framing engine
- No misinterpretation engine
- No external ML models or APIs
- No empirical calibration or validation against human data

### Layer 1.5: Dataset Completion

**Status: In progress (current layer).**

Layer 1.5 addresses class coverage gaps in the real dataset without advancing to empirical grounding. It is strictly an engineering task: fill missing emotion categories with controlled synthetic data so the full pipeline can run end-to-end across all target classes.

#### Real dataset

- **Source:** ISEAR-style CSV loaded locally at `dataset/eng_dataset.csv`
- **Format:** 3 columns — `ID`, `sentiment`, `content`
- **Total rows:** 7,102
- **Emotions present (4 of 6):**

| Emotion | Count |
|---------|-------|
| ANGER | 1,701 |
| FEAR | 2,252 |
| JOY | 1,616 |
| SADNESS | 1,533 |

#### Missing emotions

| Emotion | Status | Resolution |
|---------|--------|------------|
| DISGUST | Missing from source CSV | Filled with 1,200 synthetic entries |
| NEUTRAL | Not in original ISEAR label set | Filled with 1,200 synthetic entries |

#### Why synthetic augmentation

1. **Class coverage:** The NB pipeline requires training examples for every class. Without DISGUST and NEUTRAL, the model cannot produce posteriors for these emotions, and evaluation cannot include them.
2. **Controlled gap-filling:** Rather than sourcing external unlabeled data (introducing unknown biases), we generate controlled synthetic entries with known provenance, locked appraisal mappings, and auditable generation logic.
3. **Transparency:** Every synthetic entry is tagged with a `synthetic_` prefix in its ID, making provenance trivially identifiable.

#### Why this is still Layer 1 work

Layer 1.5 does not make empirical claims. The synthetic data:
- Does NOT replace empirical validation
- Does NOT establish ground truth for appraisal-emotion associations
- Is NOT suitable for scientific publication or clinical application
- EXISTS ONLY to complete engineering coverage so the pipeline can be tested end-to-end

#### Risks of synthetic data and mitigations

| Risk | Mitigation |
|------|------------|
| **Distribution shift** — Synthetic text may not match real text statistics | Documented as known limitation; real-vs-synthetic holdout metrics reported separately |
| **Label leakage** — Generated text might contain the emotion label word | Automated ban-list scan during generation; 0 violations confirmed |
| **Overfitting** — Model may learn synthetic patterns rather than genuine features | Rule-based appraisal mapping means all rows of the same class get identical vectors; the model learns class priors, not text patterns |
| **Template repetition** — Synthetic entries may look formulaic | 6 thematic pools per emotion, 10-12 openers + 8-10 continuations each, inline choice expansion producing thousands of unique combinations; 0 duplicates confirmed |
| **Style mismatch** — Synthetic ISEAR-style text differs from social media text in the real CSV | Documented as known limitation; planned resolution in Layer 2 with real labeled data |

### Layer 2: Scientific Grounding (Future)

**Status: Not implemented yet. Will be added later.**

Layer 2 will operationally mean:

1. **Empirical appraisal-emotion likelihoods** — Replace rule-based mappings with probability distributions derived from human-annotated data (e.g., appraisal questionnaire studies, crowd-sourced annotations).
2. **Calibration** — Ensure posterior probabilities are well-calibrated (predicted confidence matches actual accuracy).
3. **Reliability gating** — Add confidence thresholds below which the model abstains rather than predicting, with configurable sensitivity.
4. **Cross-validation** — Replace fixed 80/20 split with k-fold or stratified evaluation.
5. **Real DISGUST and NEUTRAL data** — Replace synthetic entries with genuine labeled examples from validated sources.

---

## 2. Appraisal Dimension Lock

The module uses exactly **6 appraisal dimensions** with the following bin values:

| Dimension | Bins | Cardinality |
|-----------|------|-------------|
| **Valence** | `NEG`, `NEU`, `POS` | 3 |
| **Arousal** | `LOW`, `MED`, `HIGH` | 3 |
| **Agency** | `SELF`, `OTHER`, `SITUATION` | 3 |
| **Control** | `LOW`, `MED`, `HIGH` | 3 |
| **Certainty** | `LOW`, `HIGH` | 2 |
| **GoalRelevance** | `LOW`, `HIGH` | 2 |

**Locked for Layer 1. Changes require explicit review.**

All types are defined in `types.ts`. Any modification to dimension names, bin values, or cardinality constitutes a schema-breaking change and must be reviewed across all downstream consumers (likelihood builder, inference engine, CLI tools, tests).

---

## 3. Synthetic Generation Specification

### Style constraints (non-negotiable)

1. First-person autobiographical narrative
2. 1-4 sentences per entry
3. No emojis
4. No slang
5. No dramatic exaggeration
6. No emotion label words or near-labels (enforced via automated ban-list scan)
7. Reflective psychological self-report tone
8. No obvious template repetition (compositional generation with inline choice expansion)

### DISGUST entries (1,200)

**Thematic pools (6):**
- Food contamination and spoilage
- Hygiene and sanitation failures
- Environmental pollution and neglect
- Moral and ethical violations
- Social cruelty and exploitation
- Institutional negligence and systemic failures

**Locked appraisal vector:**

| Dimension | Value |
|-----------|-------|
| Valence | `NEG` |
| Arousal | `MED` |
| Agency | `SITUATION` |
| Control | `LOW` |
| Certainty | `HIGH` |
| GoalRelevance | `HIGH` |

### NEUTRAL entries (1,200)

**Thematic pools (6):**
- Morning and daily routines
- Weather and outdoor conditions
- Work and school activities
- Transportation and commuting
- Shopping and errands
- Observations and information

**Locked appraisal vector:**

| Dimension | Value |
|-----------|-------|
| Valence | `NEU` |
| Arousal | `LOW` |
| Agency | `SITUATION` |
| Control | `MED` |
| Certainty | `HIGH` |
| GoalRelevance | `LOW` |

### Generation parameters

| Parameter | Value |
|-----------|-------|
| PRNG seed | `2024` |
| Algorithm | LCG (same SeededRNG as Layer 1 generator) |
| Total count | 2,400 (1,200 + 1,200) |
| Deduplication | Exact string match; 0 duplicates confirmed |
| Label leakage | Automated ban-list scan; 0 violations confirmed |
| Deterministic | Yes — same seed always produces identical output |

### Output location

```
src/appraisal-lab/dataset/synthetic_disgust_neutral.json
```

**ID convention:**
- DISGUST: `synthetic_disgust_0001` through `synthetic_disgust_1200`
- NEUTRAL: `synthetic_neutral_0001` through `synthetic_neutral_1200`

**Generation CLI:**
```bash
npx ts-node src/appraisal-lab/cli/generate_synthetic.ts [seed]
```

---

## 4. Merge Plan

### Input files

| File | Source | Rows | Emotions |
|------|--------|------|----------|
| `dataset/isear_appraisal_dataset.json` | Real CSV (eng_dataset.csv) | 7,102 | ANGER, FEAR, JOY, SADNESS |
| `dataset/synthetic_disgust_neutral.json` | Synthetic generator | 2,400 | DISGUST, NEUTRAL |

### Combined output

**Recommended file name:**
```
src/appraisal-lab/dataset/isear_appraisal_dataset_extended.json
```

### Merge procedure

1. Load `isear_appraisal_dataset.json` (existing pipeline output, `AppraisalRow[]` format).
2. Load `synthetic_disgust_neutral.json` (flat format with `id`, `sentiment`, `content`).
3. For each synthetic entry:
   a. Map `sentiment` → `emotion` (DISGUST → "DISGUST", NEUTRAL requires adding "NEUTRAL" to the Emotion type or using a separate pipeline).
   b. Apply locked appraisal vector from the mapping table above.
   c. Convert to `AppraisalRow` format.
4. Concatenate real + synthetic arrays.
5. Write combined JSON.

### Provenance tracking

All synthetic entries are identifiable by:
- **ID prefix:** `synthetic_disgust_` or `synthetic_neutral_`
- **Separate source file:** `synthetic_disgust_neutral.json` is preserved alongside the merged file
- **Recommendation:** Maintain both separate and merged files. Never delete the separate files — they are the audit trail.

### NEUTRAL type consideration

The locked `Emotion` type in `types.ts` does not include `"NEUTRAL"`. Before merging NEUTRAL entries into the typed pipeline:
- Option A: Add `"NEUTRAL"` to the Emotion type (schema change, requires review)
- Option B: Keep NEUTRAL entries in a parallel untyped structure until Layer 2
- **Current recommendation:** Option A when the merge is executed, with explicit review of all downstream consumers

---

## 5. Validation Checklist

Run after any merge or dataset modification.

### Schema validation

- [ ] Every row in the merged dataset passes `validateRow()` from `schema.ts`
- [ ] All `id` fields are non-empty strings
- [ ] All `text` / `content` fields are non-empty strings
- [ ] All `emotion` / `sentiment` fields are in the allowed set
- [ ] All appraisal dimension values are valid bin values

### Distribution checks

- [ ] **Class distribution:** Print counts per emotion; no class should be < 500 or > 5,000 (unless justified)
- [ ] **Length histogram:** Content lengths (in characters) should show a reasonable distribution (mean 50-300 chars, no outlier clusters at 0 or > 1,000)
- [ ] **Token frequency:** Top-50 most frequent words should not be dominated by a single emotion's vocabulary
- [ ] **Duplicate scan:** Zero exact-duplicate content strings across the entire merged dataset
- [ ] **Synthetic proportion:** Synthetic entries should be clearly reported as a fraction of total (target: < 30%)

### Label leakage scan

- [ ] Run ban-list scan for DISGUST entries: no matches for `disgusted`, `disgusting`, `disgust`, `grossed`, `repulsed`, `repulsive`, `revolting`, `revolted`, `sickening`, `sickened`, `nauseating`, `nauseated`, `loathsome`, `abhorrent`, `vile`, `repugnant`
- [ ] Run ban-list scan for NEUTRAL entries: no matches for `neutral`, `calm`, `indifferent`, `apathetic`, `unbothered`, `unmoved`
- [ ] Report: total violations = 0

### Model sanity check

- [ ] NB likelihood builder runs without error on training split
- [ ] All priors sum to 1 within 1e-9
- [ ] All conditionals sum to 1 per emotion per dimension within 1e-9
- [ ] No zero probabilities in any conditional
- [ ] Inference produces posteriors that sum to 1 within 1e-9
- [ ] No NaN or Infinity in any posterior
- [ ] Ambiguous input does not produce > 0.99 confidence

### Holdout metrics (report separately)

- [ ] **Real-only:** Train on real data (80%), evaluate on real holdout (20%). Report accuracy and confusion matrix.
- [ ] **Real + synthetic:** Train on full merged data (80%), evaluate on merged holdout (20%). Report accuracy and confusion matrix.
- [ ] **Synthetic-only holdout:** From the merged test set, isolate synthetic rows. Report accuracy on synthetic rows separately.
- [ ] Compare real-only vs. real+synthetic metrics. Document any degradation.

---

## 6. File Inventory

```
src/appraisal-lab/
  DESIGN.md                                        ← this document
  README.md                                        ← operational README
  types.ts                                         ← locked type definitions
  schema.ts                                        ← constants and validation

  dataset/
    eng_dataset.csv                                ← real ISEAR-style CSV (7,102 rows)
    generator.ts                                   ← Layer 1 synthetic generator (PRNG-based)
    isear_loader.ts                                ← CSV loader with column auto-detection
    appraisal_mapper.ts                            ← rule-based emotion → appraisal mapping
    dataset.sample.json                            ← small reference sample
    isear_appraisal_dataset.json                   ← real data mapped to AppraisalRow format
    synthetic_disgust_neutral.json                 ← synthetic DISGUST + NEUTRAL (2,400 rows)

  model/
    likelihood_builder.ts                          ← Laplace-smoothed NB likelihood tables
    nb_inference.ts                                ← log-space NB inference engine
    metrics.ts                                     ← evaluation: accuracy, confusion matrix

  cli/
    generate_dataset.ts                            ← CLI: generate Layer 1 synthetic dataset
    build_likelihood.ts                            ← CLI: build likelihood table
    eval_holdout.ts                                ← CLI: evaluate on holdout set
    run_inference.ts                               ← CLI: infer on single row
    build_isear_appraisal_dataset.ts               ← CLI: ISEAR CSV → AppraisalRow JSON
    generate_synthetic.ts                          ← CLI: generate DISGUST + NEUTRAL synthetic data

  __tests__/
    dataset_generator.test.ts                      ← Layer 1 generator tests
    likelihood_builder.test.ts                     ← likelihood table tests
    nb_inference.test.ts                           ← inference engine tests
    isear_pipeline.test.ts                         ← ISEAR loader + mapper tests
```

---

## 7. Isolation Guarantees

- **No imports from outside `src/appraisal-lab/`** — fully self-contained
- **No external dependencies** — only Node.js built-ins (`fs`, `path`) in CLI scripts
- **No architectural contamination** — does not touch or depend on any other project module
- **Deterministic** — all generators produce identical output for the same seed
- **Safe to delete** — removing `src/appraisal-lab/` has zero impact on the rest of the project
