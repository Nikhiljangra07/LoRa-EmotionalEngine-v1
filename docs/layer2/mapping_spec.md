# Layer-2 Mapping Spec: crowd-enVent 21 → LoRa-6

**Spec version:** v1.1
**Date:** 2026-02-19
**Source dataset:** crowd-enVent2023 (Troiano, Oberländer, Klinger 2023)
**Dataset location:** `src/appraisal-lab/dataset/crowd-enVent2023/`
**Primary corpus file:** `corpus/crowd-enVent_generation.tsv` (6,600 rows)
**Status:** LOCKED — changes require explicit review

---

## Change Log

### v1.1 (2026-02-19) — Post-sanity-report corrections

Changes driven by `docs/layer2/mapping_sanity_report.md` findings:

1. **Control formula rewritten (§E.4).** Replaced `max(norm(self_control), norm(other_control))` with a weighted personal-controllability composite: `0.6·norm(self_control) + 0.2·(1 − norm(chance_control)) + 0.2·(1 − norm(other_control))`. The v1 formula conflated "someone else has control" with "the situation is controllable by me," which inflated control scores for fear (mean 0.674 in sanity report; appraisal theory predicts low). The new formula centers on *self*-controllability: only self_control contributes positively; external control sources (chance, other) act as detractors. `chance_control` is no longer unmapped — it is now consumed by the control dimension. Weights are heuristic but theory-guided (not learned).
2. **Arousal definition clarified (§E.2).** Explicitly defined LoRa arousal as a *cognitive-activation composite* (salience + urgency + suddenness), not pure physiological activation. Added justification paragraph addressing the sanity report's finding that sadness arousal (0.637) exceeded the expected low range.
3. **Unmapped columns decision added (§J).** New section explicitly lists all 6 remaining unmapped columns with a per-column permanent/candidate status and confirms none are used in Layer-2 likelihood estimation.
4. **Emotion set decision added (§K).** Layer-2 likelihood estimation will use all 13 crowd-enVent emotions for statistical robustness. The runtime LoRa emotion type space remains independent.
5. **Summary table, pseudocode (§F.1), and edge-case policies (§G.4) updated** for consistency with the new control formula.

### v1 (2026-02-19) — Initial spec

Initial 21→6 mapping for crowd-enVent2023 generation set.

---

## A. Purpose & Scope

This document specifies the deterministic mapping from crowd-enVent's 21 Likert-scaled appraisal columns to the 6 canonical LoRa appraisal dimensions defined in `src/appraisal-lab/types.ts`. The mapping converts raw continuous appraisal ratings (integer 1–5) into the discrete bin values that the LoRa Naive Bayes pipeline consumes.

The goal is to produce, for each crowd-enVent row, a valid `AppraisalVector` (`{ valence, arousal, agency, control, certainty, goalRelevance }`) that can replace the Layer-1 rule-based mappings from `dataset/appraisal_mapper.ts` with empirically grounded, instance-level appraisal vectors derived from human annotations. This spec contains no ML, no learned parameters, and no non-deterministic steps. An engineer should be able to implement it without asking questions.

---

## B. Inputs

### B.1 Source columns (21)

All columns are integer-valued on a **1–5 Likert scale** (1 = "Not at all", 5 = "Extremely"). They appear at columns 24–44 in `crowd-enVent_generation.tsv`.

| # | Column name | Likert scale | Description |
|---|-------------|-------------|-------------|
| 1 | `suddenness` | 1–5 | How sudden/unexpected was the event? |
| 2 | `familiarity` | 1–5 | How familiar was this type of event? |
| 3 | `predict_event` | 1–5 | How predictable was the event? |
| 4 | `pleasantness` | 1–5 | How pleasant was the event? |
| 5 | `unpleasantness` | 1–5 | How unpleasant was the event? |
| 6 | `goal_relevance` | 1–5 | How relevant was the event to your goals? |
| 7 | `chance_responsblt` | 1–5 | To what extent was chance/fate responsible? |
| 8 | `self_responsblt` | 1–5 | To what extent were you responsible? |
| 9 | `other_responsblt` | 1–5 | To what extent was someone else responsible? |
| 10 | `predict_conseq` | 1–5 | How predictable were the consequences? |
| 11 | `goal_support` | 1–5 | Did the event support your goals? |
| 12 | `urgency` | 1–5 | How urgently did you need to respond? |
| 13 | `self_control` | 1–5 | How much control did you have? |
| 14 | `other_control` | 1–5 | How much control did someone else have? |
| 15 | `chance_control` | 1–5 | How much control did chance/fate have? |
| 16 | `accept_conseq` | 1–5 | How much could you accept the consequences? |
| 17 | `standards` | 1–5 | How consistent was the event with your standards? |
| 18 | `social_norms` | 1–5 | How consistent was the event with social norms? |
| 19 | `attention` | 1–5 | How much did you attend to the event? |
| 20 | `not_consider` | 1–5 | How much did you try NOT to think about it? |
| 21 | `effort` | 1–5 | How much effort did you put into dealing with it? |

### B.2 Additional columns used (non-appraisal)

| Column | Role in this spec |
|--------|-------------------|
| `emotion` (col 2) | Trigger emotion label (13 classes). Used for downstream P(D\|E), not for the mapping itself. |
| `generated_text` (col 18) | Event text. Passed through, not transformed. |
| `text_id` (col 3) | Row identifier. Passed through. |

### B.3 Columns explicitly excluded

| Column(s) | Reason |
|-----------|--------|
| Cols 6–17 (`anger`…`trust`) | Prior mood of annotator, not event appraisals |
| `event_duration`, `emotion_duration` | Temporal metadata, not cognitive appraisals |
| `intensity`, `confidence` | Episode-level self-report, not appraisal dimensions |
| `age`, `gender`, `education`, `ethnicity` | Demographics — confound risk |
| `extravert`…`conventional` (cols 50–59) | Big-5 personality traits — confound risk |
| `prolific_id`, `timestamp` | PII / metadata |
| `round_number`, `previous_participation` | Collection metadata |
| `control_check_0`, `control_check_1`, `control_check_2` | Quality control items |
| `did_you_lie?`, `feedback_*`, `status_approval`, `comments` | Survey metadata |
| `original_demographics` | Provenance metadata |

---

## C. Output: LoRa-6 Dimension Names

These names are **not new** — they are taken verbatim from the existing locked type system at `src/appraisal-lab/types.ts` (lines 24–29) and `src/appraisal-lab/schema.ts` (lines 39–41).

| LoRa dimension | TypeScript type | Bins | Cardinality | Source |
|----------------|----------------|------|-------------|--------|
| `valence` | `Valence` | `NEG`, `NEU`, `POS` | 3 | `types.ts:24` |
| `arousal` | `Arousal` | `LOW`, `MED`, `HIGH` | 3 | `types.ts:25` |
| `agency` | `Agency` | `SELF`, `OTHER`, `SITUATION` | 3 | `types.ts:26` |
| `control` | `Control` | `LOW`, `MED`, `HIGH` | 3 | `types.ts:27` |
| `certainty` | `Certainty` | `LOW`, `HIGH` | 2 | `types.ts:28` |
| `goalRelevance` | `GoalRelevance` | `LOW`, `HIGH` | 2 | `types.ts:29` |

---

## D. Shared Normalization & Binning Rules

### D.1 Likert → [0, 1] normalization

For any single Likert value `x` (integer, expected range 1–5):

```
norm(x) = (x - 1) / 4
```

| Likert value | Normalized |
|-------------|-----------|
| 1 | 0.000 |
| 2 | 0.250 |
| 3 | 0.500 |
| 4 | 0.750 |
| 5 | 1.000 |

### D.2 Three-bin thresholds (LOW / MED / HIGH or NEG / NEU / POS)

Applied to dimensions with 3 bins: `valence`, `arousal`, `control`.

| Bin | Range (inclusive) |
|-----|-------------------|
| LOW (or NEG) | [0.000, 0.333) |
| MED (or NEU) | [0.333, 0.667) |
| HIGH (or POS) | [0.667, 1.000] |

Boundary rule: lower bound is inclusive, upper bound is exclusive, except the top bin which includes 1.0.

```
function bin3(v: number): "LOW" | "MED" | "HIGH" {
  if (v < 0.333) return "LOW";
  if (v < 0.667) return "MED";
  return "HIGH";
}
```

For valence specifically, the bin labels map as: LOW → `"NEG"`, MED → `"NEU"`, HIGH → `"POS"`.

### D.3 Two-bin thresholds (LOW / HIGH)

Applied to dimensions with 2 bins: `certainty`, `goalRelevance`.

| Bin | Range (inclusive) |
|-----|-------------------|
| LOW | [0.000, 0.500) |
| HIGH | [0.500, 1.000] |

```
function bin2(v: number): "LOW" | "HIGH" {
  if (v < 0.500) return "LOW";
  return "HIGH";
}
```

### D.4 Optional five-bin thresholds

For future use or finer-grained analysis. Not consumed by the current LoRa pipeline.

| Bin | Range |
|-----|-------|
| VERY_LOW | [0.000, 0.200) |
| LOW | [0.200, 0.400) |
| MED | [0.400, 0.600) |
| HIGH | [0.600, 0.800) |
| VERY_HIGH | [0.800, 1.000] |

### D.5 Missing value handling

| Condition | Action |
|-----------|--------|
| Value is `null`, `undefined`, `NaN`, or empty string | Substitute the **scale midpoint**: raw = 3, norm = 0.5 |
| Value is non-numeric (after trimming) | Substitute midpoint (3) and set `quality_flag = "imputed"` |
| Value < 1 | Clamp to 1 |
| Value > 5 | Clamp to 5 |
| Value is fractional (e.g. 3.5) | Round to nearest integer, then normalize |

The midpoint imputation is deliberately conservative: it avoids biasing any dimension toward extremes. Rows with 3+ imputed appraisal columns should be flagged for potential exclusion in sensitivity analysis.

### D.6 Clamp utility

```
function clampLikert(x: number): number {
  if (x < 1) return 1;
  if (x > 5) return 5;
  return Math.round(x);
}
```

---

## E. Dimension-by-Dimension Mapping Table

### Summary table

| LoRa dim | crowd-enVent columns | Aggregation | Normalization | Binning | Columns consumed |
|----------|---------------------|-------------|---------------|---------|-----------------|
| `valence` | `pleasantness`, `unpleasantness` | Signed difference | Custom (see E.1) | 3-bin (NEG/NEU/POS) | 2 of 21 |
| `arousal` | `suddenness`, `urgency`, `attention` | Mean of normalized | Standard norm → mean | 3-bin (LOW/MED/HIGH) | 3 of 21 |
| `agency` | `self_responsblt`, `other_responsblt`, `chance_responsblt` | Argmax (categorical) | N/A (direct comparison) | Categorical | 3 of 21 |
| `control` | `self_control`, `chance_control`, `other_control` | Weighted composite (personal-controllability) | Standard norm → weighted sum | 3-bin (LOW/MED/HIGH) | 3 of 21 |
| `certainty` | `predict_event`, `predict_conseq`, `familiarity` | Mean of normalized | Standard norm → mean | 2-bin (LOW/HIGH) | 3 of 21 |
| `goalRelevance` | `goal_relevance` | Direct | Standard norm | 2-bin (LOW/HIGH) | 1 of 21 |

**Total columns consumed:** 15 of 21.

### Unmapped columns (6 of 21)

| Column | Why unmapped | Closest LoRa dim | Risk if included |
|--------|-------------|-------------------|------------------|
| `goal_support` | Goal congruence (does event help/hinder goals). Overlaps with valence (pleasant = goal-supporting). Including it in valence would double-count the hedonic signal. | valence | Collinearity with pleasantness |
| `accept_conseq` | Post-hoc coping response ("can I live with this?"), not a primary cognitive appraisal of the event itself. | control | Conflates appraisal with coping |
| `standards` | Moral/ethical evaluation ("did this violate my values?"). No LoRa dimension captures moral judgment. | none | No valid target dimension |
| `social_norms` | Social norm evaluation. Same issue as `standards`. | none | No valid target dimension |
| `not_consider` | Avoidance/suppression strategy. Used as a quality flag (see §G.2), not as an appraisal input. | none | Inverts interpretability |
| `effort` | Coping effort ("how hard did I try to deal with this?"). Ambiguous: high effort can co-occur with either high or low control. | control | Conflates appraisal with coping behavior |

> **v1.1 note:** `chance_control` was unmapped in v1. It is now consumed by the control dimension as an inverted signal (see §E.4).

---

### E.1 Valence

**LoRa dimension:** `valence`
**Type:** `Valence` = `"NEG" | "NEU" | "POS"`
**Source columns:** `pleasantness`, `unpleasantness`

**Rationale:** Valence is the hedonic polarity of the event. `pleasantness` and `unpleasantness` are the most direct measures in the dataset. They are rated independently (not on a single bipolar scale), so both can be high simultaneously (mixed feelings). The signed-difference formula centers this naturally.

**Formula:**

```
valence_continuous = (pleasantness - unpleasantness + 4) / 8
```

Derivation: `pleasantness` ∈ [1,5], `unpleasantness` ∈ [1,5]. The difference `(pleasantness - unpleasantness)` ∈ [-4, +4]. Shifting by +4 gives [0, 8]. Dividing by 8 gives [0, 1].

| Example | pleasantness | unpleasantness | Continuous | Bin |
|---------|-------------|---------------|-----------|-----|
| Strongly positive | 5 | 1 | 1.000 | POS |
| Mildly positive | 4 | 2 | 0.750 | POS |
| Neutral / mixed | 3 | 3 | 0.500 | NEU |
| Mildly negative | 2 | 4 | 0.250 | NEG |
| Strongly negative | 1 | 5 | 0.000 | NEG |
| Conflicting high | 5 | 5 | 0.500 | NEU |
| Conflicting low | 1 | 1 | 0.500 | NEU |

**Binning:** Apply `bin3` with labels NEG/NEU/POS (see §D.2).

```
function mapValence(pleasantness, unpleasantness):
  p = clampLikert(pleasantness)
  u = clampLikert(unpleasantness)
  v = (p - u + 4) / 8
  if v < 0.333: return "NEG"
  if v < 0.667: return "NEU"
  return "POS"
```

---

### E.2 Arousal

**LoRa dimension:** `arousal`
**Type:** `Arousal` = `"LOW" | "MED" | "HIGH"`
**Source columns:** `suddenness`, `urgency`, `attention`

**Definition (v1.1):** LoRa arousal is defined as a **cognitive-activation composite** — a measure of salience, urgency, and suddenness — rather than pure physiological activation (heart rate, galvanic skin response). This distinction matters because crowd-enVent appraisal ratings are self-reported cognitive judgments, not physiological measurements. The three source columns capture how *cognitively engaging* the event was: how sudden it was (novelty), how urgently it demanded a response (action tendency), and how much the person attended to it (attentional capture/salience).

**Rationale:** In Scherer's Component Process Model, the novelty check (suddenness, familiarity) and the coping-potential check (urgency) are primary determinants of cognitive mobilization. Attentional capture (`attention`) adds a salience signal that correlates with cognitive activation even in the absence of physiological arousal. Equal weighting is used because there is no empirical basis within this dataset to prefer one contributor over another.

**Why this is not "physiological arousal":** The sanity report found sadness averaging 0.637 on the arousal dimension — seemingly contradicting the textbook expectation that sadness involves low physiological arousal. Under the cognitive-activation definition, this is expected: sad events are highly salient (high attention) and moderately sudden, even though they do not produce high heart rate. The dimension captures *how much the event grabbed cognitive resources*, not how physically activated the person was.

**Formula:**

```
arousal_continuous = mean(norm(suddenness), norm(urgency), norm(attention))
                   = (norm(suddenness) + norm(urgency) + norm(attention)) / 3
```

Where `norm(x) = (clampLikert(x) - 1) / 4`.

| Example | suddenness | urgency | attention | Continuous | Bin |
|---------|-----------|---------|-----------|-----------|-----|
| High activation | 5 | 5 | 5 | 1.000 | HIGH |
| Moderate | 3 | 3 | 3 | 0.500 | MED |
| Low activation | 1 | 1 | 1 | 0.000 | LOW |
| Mixed (sudden, not urgent) | 5 | 1 | 3 | 0.500 | MED |

**Binning:** Apply `bin3` (see §D.2).

```
function mapArousal(suddenness, urgency, attention):
  s = norm(clampLikert(suddenness))
  u = norm(clampLikert(urgency))
  a = norm(clampLikert(attention))
  v = (s + u + a) / 3
  if v < 0.333: return "LOW"
  if v < 0.667: return "MED"
  return "HIGH"
```

**Design note:** `attention` in crowd-enVent measures directed focus ("How much did you attend to the event?"), which can be high even at low physiological arousal (e.g., calm concentration on a sad memory). Under the cognitive-activation definition adopted in v1.1, this is a feature, not a bug: attentional salience is part of what we mean by "arousal" in LoRa. Removing `attention` and using only `suddenness` + `urgency` would narrow the construct toward physiological arousal, which is a valid but different design choice. The 3-column mean is retained for the broader cognitive-activation construct.

---

### E.3 Agency

**LoRa dimension:** `agency`
**Type:** `Agency` = `"SELF" | "OTHER" | "SITUATION"`
**Source columns:** `self_responsblt`, `other_responsblt`, `chance_responsblt`

**Rationale:** Agency is categorical: who or what caused the event? The three responsibility columns map directly to the three LoRa agency bins. This is the only dimension where we use argmax rather than continuous aggregation.

**Formula:** Assign the bin corresponding to the highest-scoring responsibility source.

**Tiebreak policy** (deterministic, ordered): When two or more responsibility columns are tied at the maximum value, prefer **SITUATION > OTHER > SELF**. Rationale: defaulting to external/diffuse attribution is the most conservative choice and avoids over-attributing agency to specific actors under ambiguity.

| Example | self | other | chance | Result |
|---------|------|-------|--------|--------|
| Clear self | 5 | 1 | 1 | SELF |
| Clear other | 1 | 5 | 1 | OTHER |
| Clear chance | 1 | 1 | 5 | SITUATION |
| Self = other tie | 4 | 4 | 1 | OTHER |
| Self = chance tie | 4 | 1 | 4 | SITUATION |
| Other = chance tie | 1 | 4 | 4 | SITUATION |
| Three-way tie | 3 | 3 | 3 | SITUATION |

```
function mapAgency(self_responsblt, other_responsblt, chance_responsblt):
  s = clampLikert(self_responsblt)
  o = clampLikert(other_responsblt)
  c = clampLikert(chance_responsblt)

  max_val = max(s, o, c)

  // Tiebreak order: SITUATION > OTHER > SELF
  if c == max_val: return "SITUATION"
  if o == max_val: return "OTHER"
  return "SELF"
```

**Note on tiebreak implementation:** The order of the `if` statements IS the tiebreak policy. Because `chance_responsblt` is checked first, it wins any tie it participates in. This is intentional.

---

### E.4 Control

**LoRa dimension:** `control`
**Type:** `Control` = `"LOW" | "MED" | "HIGH"`
**Source columns:** `self_control`, `chance_control`, `other_control`

**Definition:** Control in the LoRa model represents **personal controllability** — the degree to which the experiencer (the self) could influence the event or its outcome. This is distinct from *situational* controllability, which asks whether *anyone* could control it.

**Why the v1 formula (`max(self_control, other_control)`) was incorrect:**

The v1 formula used `max(norm(self_control), norm(other_control))`. This conflated two different things:

- High `self_control` → "I could influence this" → high personal controllability (correct).
- High `other_control` → "Someone else controlled this" → high *other*-controllability, but **low personal controllability** (incorrect in v1; treated as high).

The sanity report confirmed the empirical consequence: fear averaged control = 0.674 (MED/HIGH), contradicting the appraisal-theory prediction that fear involves low perceived control. The inflation came from `other_control` being high in fear scenarios (e.g., "someone else had power over the situation") being treated as evidence of *personal* control.

**v1.1 formula — personal-controllability composite:**

```
control_continuous = 0.6 * norm(self_control)
                   + 0.2 * (1 - norm(chance_control))
                   + 0.2 * (1 - norm(other_control))
```

**Component logic:**

| Term | Weight | Direction | Rationale |
|------|--------|-----------|-----------|
| `norm(self_control)` | 0.6 | Direct | Primary signal: how much control *I* had. Dominant weight reflects that personal controllability is fundamentally about the self. |
| `1 - norm(chance_control)` | 0.2 | Inverted | If chance/fate controlled the outcome, personal controllability is lower. Inversion converts "high chance control" → "low personal control." |
| `1 - norm(other_control)` | 0.2 | Inverted | If another person controlled the outcome, personal controllability is lower. Inversion converts "high other control" → "low personal control." |

**Weight justification:** The 0.6/0.2/0.2 split is heuristic but theory-guided. Self-control is given dominant weight (0.6) because personal controllability is primarily about the agent's own perceived capacity. The two external-control detractors share the remaining weight equally (0.2 each) as secondary signals. These weights are deterministic constants, not learned from data. The weights sum to 1.0, preserving the [0, 1] output range.

**Output range proof:**
- Minimum: `0.6·0 + 0.2·(1−1) + 0.2·(1−1) = 0.0` (self_control=1, chance=5, other=5).
- Maximum: `0.6·1 + 0.2·(1−0) + 0.2·(1−0) = 1.0` (self_control=5, chance=1, other=1).
- Range: [0.0, 1.0] ✓

| Example | self_ctl | chance_ctl | other_ctl | Continuous | Bin |
|---------|---------|-----------|----------|-----------|-----|
| Full personal control | 5 | 1 | 1 | 1.000 | HIGH |
| No control (chance-driven) | 1 | 5 | 1 | 0.200 | LOW |
| No control (other-driven) | 1 | 1 | 5 | 0.200 | LOW |
| No control (all external) | 1 | 5 | 5 | 0.000 | LOW |
| Moderate self, low external | 3 | 2 | 2 | 0.450 | MED |
| High self, high external | 5 | 5 | 5 | 0.600 | MED |
| Mixed: self + chance | 4 | 4 | 1 | 0.650 | MED |
| Typical anger (self moderate, other high) | 3 | 2 | 4 | 0.500 | MED |
| Typical fear (low self, high chance) | 2 | 4 | 3 | 0.300 | LOW |

**Binning:** Apply `bin3` (see §D.2).

```
function mapControl(self_control, chance_control, other_control):
  sc = norm(clampLikert(self_control))
  cc = norm(clampLikert(chance_control))
  oc = norm(clampLikert(other_control))
  v = 0.6 * sc + 0.2 * (1 - cc) + 0.2 * (1 - oc)
  if v < 0.333: return "LOW"
  if v < 0.667: return "MED"
  return "HIGH"
```

---

### E.5 Certainty

**LoRa dimension:** `certainty`
**Type:** `Certainty` = `"LOW" | "HIGH"`
**Source columns:** `predict_event`, `predict_conseq`, `familiarity`

**Rationale:** Certainty captures how predictable or expected the event was. In Scherer's model, this corresponds to the "expectation" check. Three crowd-enVent columns contribute: whether the event itself was predictable, whether its consequences were predictable, and whether the event type was familiar. All three increase subjective certainty. Equal weighting is used.

**Formula:**

```
certainty_continuous = mean(norm(predict_event), norm(predict_conseq), norm(familiarity))
                     = (norm(predict_event) + norm(predict_conseq) + norm(familiarity)) / 3
```

| Example | predict_event | predict_conseq | familiarity | Continuous | Bin |
|---------|--------------|---------------|------------|-----------|-----|
| Fully expected | 5 | 5 | 5 | 1.000 | HIGH |
| Completely novel | 1 | 1 | 1 | 0.000 | LOW |
| Familiar but unpredictable | 1 | 1 | 5 | 0.333 | LOW |
| Predictable but novel | 5 | 5 | 1 | 0.667 | HIGH |

**Binning:** Apply `bin2` (see §D.3).

```
function mapCertainty(predict_event, predict_conseq, familiarity):
  pe = norm(clampLikert(predict_event))
  pc = norm(clampLikert(predict_conseq))
  f  = norm(clampLikert(familiarity))
  v = (pe + pc + f) / 3
  if v < 0.500: return "LOW"
  return "HIGH"
```

**Note on `suddenness`:** One might expect `suddenness` to contribute inversely to certainty (sudden = uncertain). However, `suddenness` is already consumed by the arousal dimension, and adding an inverted signal here introduces cross-dimension coupling. The three columns chosen are all *positively* oriented toward certainty, keeping the formula simple and auditable.

---

### E.6 GoalRelevance

**LoRa dimension:** `goalRelevance`
**Type:** `GoalRelevance` = `"LOW" | "HIGH"`
**Source columns:** `goal_relevance`

**Rationale:** This is a direct 1:1 mapping. The crowd-enVent column `goal_relevance` asks exactly what the LoRa dimension captures: how relevant was the event to the person's goals?

**Why `goal_support` is not included:** `goal_support` measures goal *congruence* (does the event help or hinder goals?), not goal *relevance*. An event can be highly goal-relevant but goal-incongruent (e.g., losing a job). Goal congruence is closer to valence than to relevance. Including it would conflate two distinct appraisal checks.

**Formula:**

```
goalRelevance_continuous = norm(goal_relevance)
                         = (clampLikert(goal_relevance) - 1) / 4
```

| Example | goal_relevance | Continuous | Bin |
|---------|---------------|-----------|-----|
| Highly relevant | 5 | 1.000 | HIGH |
| Moderately relevant | 3 | 0.500 | HIGH |
| Irrelevant | 1 | 0.000 | LOW |
| Slightly relevant | 2 | 0.250 | LOW |

**Binning:** Apply `bin2` (see §D.3).

```
function mapGoalRelevance(goal_relevance):
  v = norm(clampLikert(goal_relevance))
  if v < 0.500: return "LOW"
  return "HIGH"
```

---

## F. Full Pseudocode

### F.1 Complete row mapper

```
function mapCrowdEnventRow(row) -> AppraisalVector:

  // --- Valence ---
  p = clampLikert(row.pleasantness)
  u = clampLikert(row.unpleasantness)
  valence_c = (p - u + 4) / 8
  if valence_c < 0.333:
    valence = "NEG"
  else if valence_c < 0.667:
    valence = "NEU"
  else:
    valence = "POS"

  // --- Arousal ---
  s_a = norm(clampLikert(row.suddenness))
  u_a = norm(clampLikert(row.urgency))
  a_a = norm(clampLikert(row.attention))
  arousal_c = (s_a + u_a + a_a) / 3
  if arousal_c < 0.333:
    arousal = "LOW"
  else if arousal_c < 0.667:
    arousal = "MED"
  else:
    arousal = "HIGH"

  // --- Agency ---
  sr = clampLikert(row.self_responsblt)
  or_ = clampLikert(row.other_responsblt)
  cr = clampLikert(row.chance_responsblt)
  max_r = max(sr, or_, cr)
  if cr == max_r:
    agency = "SITUATION"
  else if or_ == max_r:
    agency = "OTHER"
  else:
    agency = "SELF"

  // --- Control (v1.1: personal-controllability composite) ---
  sc = norm(clampLikert(row.self_control))
  cc = norm(clampLikert(row.chance_control))
  oc = norm(clampLikert(row.other_control))
  control_c = 0.6 * sc + 0.2 * (1 - cc) + 0.2 * (1 - oc)
  if control_c < 0.333:
    control = "LOW"
  else if control_c < 0.667:
    control = "MED"
  else:
    control = "HIGH"

  // --- Certainty ---
  pe = norm(clampLikert(row.predict_event))
  pc = norm(clampLikert(row.predict_conseq))
  f  = norm(clampLikert(row.familiarity))
  certainty_c = (pe + pc + f) / 3
  if certainty_c < 0.500:
    certainty = "LOW"
  else:
    certainty = "HIGH"

  // --- GoalRelevance ---
  gr = norm(clampLikert(row.goal_relevance))
  if gr < 0.500:
    goalRelevance = "LOW"
  else:
    goalRelevance = "HIGH"

  return { valence, arousal, agency, control, certainty, goalRelevance }
```

### F.2 Shared helper functions

```
function clampLikert(x):
  if x is null or undefined or NaN or empty:
    return 3  // midpoint imputation
  x = toNumber(x)
  if x < 1: return 1
  if x > 5: return 5
  return round(x)

function norm(x):
  return (x - 1) / 4

function bin3(v):
  if v < 0.333: return "LOW"
  if v < 0.667: return "MED"
  return "HIGH"

function bin2(v):
  if v < 0.500: return "LOW"
  return "HIGH"
```

### F.3 Batch processing

```
function mapCrowdEnventDataset(rows[]) -> AppraisalRow[]:
  results = []
  imputation_log = []

  for each row in rows:
    // Count imputed fields for quality tracking
    imputed_count = count fields in appraisal columns where clampLikert applied midpoint
    if imputed_count >= 3:
      imputation_log.append({ text_id: row.text_id, imputed_count })

    vector = mapCrowdEnventRow(row)

    results.append({
      id: "ENVENT_" + row.text_id,
      text: row.generated_text,
      emotion: mapEmotionLabel(row.emotion),
      appraisals: vector,
    })

  log("Rows processed:", len(results))
  log("Rows with 3+ imputed columns:", len(imputation_log))
  return results
```

### F.4 Emotion label mapping

crowd-enVent has 13 emotion classes. The current LoRa `Emotion` type supports 6: JOY, ANGER, FEAR, SADNESS, DISGUST, SURPRISE. The `MergedEmotion` type adds NEUTRAL.

```
function mapEmotionLabel(crowdEnventEmotion: string) -> MergedEmotion | null:
  LABEL_MAP = {
    "joy":         "JOY",
    "anger":       "ANGER",
    "fear":        "FEAR",
    "sadness":     "SADNESS",
    "disgust":     "DISGUST",
    "surprise":    "SURPRISE",
    "no-emotion":  "NEUTRAL",
  }

  key = lowercase(crowdEnventEmotion)
  if key in LABEL_MAP:
    return LABEL_MAP[key]
  else:
    return null  // unmappable — see §F.5
```

### F.5 Unmappable emotion classes

Six crowd-enVent emotion classes have no current LoRa equivalent:

| crowd-enVent label | LoRa mapping | Recommendation |
|-------------------|-------------|----------------|
| `joy` | `JOY` | Direct |
| `anger` | `ANGER` | Direct |
| `fear` | `FEAR` | Direct |
| `sadness` | `SADNESS` | Direct |
| `disgust` | `DISGUST` | Direct |
| `surprise` | `SURPRISE` | Direct |
| `no-emotion` | `NEUTRAL` | Via `MergedEmotion` |
| `guilt` | **null** | Exclude or map to SADNESS (high self-responsibility variant). See Future Work. |
| `shame` | **null** | Exclude or map to SADNESS (high self-responsibility + social-norms variant). See Future Work. |
| `boredom` | **null** | Exclude or map to NEUTRAL (low arousal, low goal-relevance). See Future Work. |
| `pride` | **null** | Exclude or map to JOY (high self-responsibility variant). See Future Work. |
| `relief` | **null** | Exclude or map to JOY (high certainty, post-threat variant). See Future Work. |
| `trust` | **null** | Exclude. No reasonable LoRa target. See Future Work. |

**Default policy:** Rows with unmappable emotions are **excluded** from the Layer-2 training set. They are preserved in the raw dataset with their original labels for future use. Exclusion count must be logged.

Expected row counts after filtering:

| Label | Rows | Mapped to | Included? |
|-------|------|-----------|-----------|
| anger | 550 | ANGER | Yes |
| boredom | 550 | — | No |
| disgust | 550 | DISGUST | Yes |
| fear | 550 | FEAR | Yes |
| guilt | 275 | — | No |
| joy | 550 | JOY | Yes |
| no-emotion | 550 | NEUTRAL | Yes |
| pride | 550 | — | No |
| relief | 550 | — | No |
| sadness | 550 | SADNESS | Yes |
| shame | 275 | — | No |
| surprise | 550 | SURPRISE | Yes |
| trust | 550 | — | No |

**Included rows:** 3,850 of 6,600 (58.3%)
**Excluded rows:** 2,750 of 6,600 (41.7%)

---

## G. Edge-Case Policies

### G.1 Conflicting pleasantness / unpleasantness

**Scenario:** Both `pleasantness` and `unpleasantness` are high (e.g., both = 5).

**Behavior under formula:** `(5 - 5 + 4) / 8 = 0.500` → `NEU`.

**Interpretation:** Mixed or ambivalent feelings are mapped to neutral valence. This is the correct default for a bipolar dimension. The mapping does not attempt to detect or flag "mixed emotions" as a special state.

**Quality flag (optional):** If `pleasantness >= 4 AND unpleasantness >= 4`, the row may be flagged as `valence_conflict = true` for downstream analysis. This flag does NOT change the bin assignment.

### G.2 `not_consider` interaction

**Scenario:** High `not_consider` (≥ 4) indicates the annotator was actively trying to avoid thinking about the event. This may reduce the reliability of other appraisal ratings (the person may not have deeply reflected on the event's appraisal dimensions).

**Policy:**
- `not_consider` is NOT used as an input to any LoRa dimension.
- `not_consider` is used as a **data quality flag**: if `not_consider >= 4`, set `quality_flag_avoidance = true`.
- Rows with this flag are still included in the training set by default but should be evaluated in sensitivity analysis (accuracy with vs. without flagged rows).
- `not_consider` is NOT a reason to exclude a row outright.

### G.3 `attention` vs `not_consider` contradiction

**Scenario:** `attention = 5` (high focus) AND `not_consider = 5` (high avoidance). These are in tension.

**Policy:** No special handling. Both values are used as-is in their respective roles (`attention` feeds into arousal; `not_consider` is a quality flag only). The seeming contradiction may reflect a valid psychological state (involuntary attention to something one wishes to avoid — common in anxiety and rumination).

### G.4 Control split (self / other / chance) — v1.1

**Scenario:** All three control columns are low (all = 1).

**Behavior:** `0.6·0.0 + 0.2·(1−0.0) + 0.2·(1−0.0) = 0.0 + 0.2 + 0.2 = 0.400` → `MED`. When nobody had control, the detractor terms are both zero (external control is low), yielding a baseline of 0.4. This reflects the formula's design: the *absence* of external control is weakly positive, even if self-control is also absent. The value falls into MED, which is a reasonable default for ambiguous-control situations.

**Scenario:** `self_control = 1, other_control = 1, chance_control = 5`.

**Behavior:** `0.6·0.0 + 0.2·(1−1.0) + 0.2·(1−0.0) = 0.0 + 0.0 + 0.2 = 0.200` → `LOW`. Correct — chance dominated and the person had no control. The inverted `chance_control` term correctly penalizes the score.

**Scenario:** `self_control = 5, other_control = 5, chance_control = 5`.

**Behavior:** `0.6·1.0 + 0.2·(1−1.0) + 0.2·(1−1.0) = 0.6 + 0.0 + 0.0 = 0.600` → `MED`. Even with maximum self-control, maximum external control pulls the score down. This captures the appraisal-theoretic idea that perceived personal control is diminished when external agents are also highly controlling (contested control).

**Scenario:** `self_control = 5, other_control = 1, chance_control = 1`.

**Behavior:** `0.6·1.0 + 0.2·1.0 + 0.2·1.0 = 0.6 + 0.2 + 0.2 = 1.000` → `HIGH`. Full personal control with no external interference.

### G.5 Agency when all responsibility columns are 1

**Scenario:** `self_responsblt = 1, other_responsblt = 1, chance_responsblt = 1`.

**Behavior:** All tied at 1. Tiebreak: `chance_responsblt` is checked first → `SITUATION`. This defaults to diffuse/situational attribution, which is the most conservative choice when no clear causal agent is identified.

### G.6 Ceiling effects in certainty

**Scenario:** `predict_event = 5, predict_conseq = 5, familiarity = 5`.

**Behavior:** `certainty_continuous = 1.0` → `HIGH`. This is expected for routine, fully predictable events.

**Scenario:** `predict_event = 1, predict_conseq = 5, familiarity = 1`.

**Behavior:** `certainty_continuous = (0.0 + 1.0 + 0.0) / 3 = 0.333` → `LOW`. Correct — just because consequences were predictable doesn't mean the event was expected.

### G.7 Row-level output contract

Every output row MUST have all 6 dimensions populated. There is no concept of a "partial" appraisal vector. The midpoint imputation (§D.5) guarantees this even when source columns are missing.

---

## H. Versioning Notes

| Field | Value |
|-------|-------|
| Spec version | v1.1 |
| Date created | 2026-02-19 |
| Source dataset | crowd-enVent2023 (Troiano, Oberländer, Klinger 2023, Computational Linguistics 49(1):1–72) |
| Dataset file | `src/appraisal-lab/dataset/crowd-enVent2023/corpus/crowd-enVent_generation.tsv` |
| Dataset rows | 6,600 (6,600 unique texts, 2,379 unique writers) |
| LoRa dimension source | `src/appraisal-lab/types.ts` (lines 24–29, locked) |
| LoRa schema source | `src/appraisal-lab/schema.ts` (lines 39–41, locked) |
| Layer-1 mapper replaced | `src/appraisal-lab/dataset/appraisal_mapper.ts` (rule-based, emotion→vector) |
| Compatibility | This spec produces `AppraisalVector` objects compatible with the existing `LikelihoodTable` and `nb_inference.ts` pipeline |

### Version history

| Version | Date | Change |
|---------|------|--------|
| v1.1 | 2026-02-19 | Control formula rewrite (personal-controllability); arousal redefined as cognitive-activation; unmapped columns decision; emotion set decision. See Change Log for details. |
| v1 | 2026-02-19 | Initial spec. 21→6 mapping for crowd-enVent2023 generation set. |

---

## J. Unmapped Columns Decision (v1.1)

Of the 21 crowd-enVent appraisal columns, 15 are consumed by the LoRa-6 mapping. The remaining **6 columns** are listed below with their explicit disposition. None of these columns are used in Layer-2 likelihood estimation.

| # | Column | Status | Rationale | Future candidate? |
|---|--------|--------|-----------|-------------------|
| 1 | `goal_support` | **Excluded permanently in v1** | Measures goal congruence, not relevance. Collinear with pleasantness (valence). Including it would double-count hedonic signal. | No — collinearity risk outweighs marginal gain. |
| 2 | `accept_conseq` | **Excluded permanently in v1** | Post-hoc coping judgment, not a primary cognitive appraisal. Conflates the appraisal ("what happened") with the response ("how I dealt with it"). | No — coping ≠ appraisal. |
| 3 | `standards` | **Excluded in v1; candidate for future LoRa expansion** | Moral/ethical congruence ("was this consistent with my values?"). No current LoRa dimension captures moral judgment. | Yes — if a `moralCongruence` dimension is added (see §I.6), this column would be a primary input. |
| 4 | `social_norms` | **Excluded in v1; candidate for future LoRa expansion** | Social norm congruence. Same gap as `standards`. | Yes — would pair with `standards` for a `moralCongruence` dimension. |
| 5 | `not_consider` | **Excluded permanently; used as quality flag only** | Measures avoidance/suppression ("did you try not to think about it?"). Not an appraisal of the event but a coping strategy. Used as `quality_flag_avoidance` (see §G.2). | No — fundamentally different construct. |
| 6 | `effort` | **Excluded permanently in v1** | Coping effort is a behavioral response, not a cognitive appraisal. Ambiguous relationship to control (high effort occurs at both high and low control). | No — conflates behavior with appraisal. |

**Confirmation:** These 6 columns are NOT used as inputs to any LoRa-6 dimension formula. They are NOT included in the Layer-2 likelihood estimation P(D_i | E). They exist in the raw dataset and may be used for future exploratory analysis only.

---

## K. Emotion Set Decision (v1.1)

### Likelihood estimation: all 13 emotions

**Layer-2 likelihood estimation will use all 13 crowd-enVent emotion labels** (anger, boredom, disgust, fear, guilt, joy, no-emotion, pride, relief, sadness, shame, surprise, trust) for statistical robustness. This means:

- P(D_i | E) tables will be computed for all 13 emotions.
- All 6,600 rows contribute to likelihood estimation — no rows are discarded for having unmappable labels.
- The richer emotion space provides more granular appraisal-dimension distributions, which improves the statistical quality of even the 7 LoRa-mappable emotion classes (e.g., computing P(control=LOW | fear) benefits from having guilt and shame data that helps calibrate the shared appraisal space).

### Runtime inference: independent LoRa emotion space

The runtime LoRa `Emotion` type (`JOY | ANGER | FEAR | SADNESS | DISGUST | SURPRISE`) and `MergedEmotion` type (adds `NEUTRAL`) remain **independent** of the crowd-enVent emotion taxonomy. The mapping from crowd-enVent labels to LoRa labels (§F.4) applies only when emitting predictions or building LoRa-compatible output.

This decoupling means:
- The LoRa type system in `types.ts` does NOT need to change.
- Likelihood tables can carry richer emotion-conditioned distributions internally.
- At inference time, posteriors for non-LoRa emotions (guilt, shame, boredom, pride, relief, trust) can be marginalized out or reported separately.

### Rationale

Discarding 41.7% of rows (2,750 of 6,600) would weaken the statistical foundation of Layer-2. Several of the excluded emotions share appraisal profiles with LoRa emotions (guilt ≈ sadness, pride ≈ joy), and their data improves the conditional distributions for the dimensions that distinguish those emotions.

---

## I. Future Work (Not Done)

The following items are identified as needed but are explicitly NOT implemented in this spec or anywhere in the codebase. They are listed here to prevent scope creep and to document known gaps.

### I.1 Emotion taxonomy expansion

The current LoRa `Emotion` type supports 6 classes + NEUTRAL. crowd-enVent has 13 classes. Six classes (guilt, shame, boredom, pride, relief, trust) are currently excluded. Expanding the taxonomy would require:
- Modifying `types.ts` (schema-breaking change)
- Updating all downstream consumers (likelihood builder, inference engine, tests)
- Defining new appraisal prototypes for each added emotion
- Re-evaluating the 6-dimensional appraisal space (some emotions may not be separable in 6 dims)

**Potential interim mappings** (for future evaluation, not for v1):
- guilt → SADNESS (high self_responsblt, low standards)
- shame → SADNESS (high self_responsblt, low social_norms)
- pride → JOY (high self_responsblt, high standards)
- relief → JOY (high certainty, threat-resolved context)
- boredom → NEUTRAL (low arousal, low goal_relevance)
- trust → no mapping (requires a new dimension or emotion class)

### I.2 Validation set integration

`crowd-enVent_validation.tsv` (6,000 rows, 1,200 unique texts × 5 readers) provides reader-perspective appraisals. This spec covers only the generation set (writer self-annotations). Future work:
- Join validation rows to generation texts via `text_id`
- Compute inter-annotator agreement per appraisal dimension
- Use reader appraisals as a held-out test set or for ensemble averaging
- Decide whether to use writer-only, reader-only, or aggregated appraisals

### I.3 Weighted aggregation

All multi-column aggregations in this spec use equal weights (simple mean or max). Future work could:
- Learn optimal weights from data (but this would require ML, violating the current no-ML constraint)
- Use theoretically motivated weights from appraisal literature
- Perform sensitivity analysis on weight choices

### I.4 Train / dev / test split creation

crowd-enVent has no pre-defined splits. The implementation must create them. Recommended:
- Stratified by `emotion` to preserve class balance
- 70/15/15 or 80/10/10 split
- Seeded shuffle for reproducibility (match existing seed convention: 2024)
- Ensure no writer (`prolific_id`) appears in both train and test (to prevent annotator-level leakage)

### I.5 `chance_control` reconsideration — RESOLVED in v1.1

~~This spec excludes `chance_control` from the control dimension.~~ As of v1.1, `chance_control` is included in the control formula as an inverted detractor: `0.2 * (1 - norm(chance_control))`. See §E.4 for the full formula and rationale. This item is closed.

### I.6 Moral appraisal dimensions

`standards` and `social_norms` are unmapped. If the LoRa model ever adds a 7th or 8th dimension (e.g., `moralCongruence`), these columns are ready to map:
- `moralCongruence_continuous = mean(norm(standards), norm(social_norms))`

### I.7 `goal_support` integration with valence

`goal_support` partially overlaps with valence (goal congruence ≈ positive valence). A future revision could test:
- `valence_v2 = weighted_mean(valence_continuous, norm(goal_support))` with goal_support weighted at 0.25
- Requires empirical validation to ensure it improves rather than adds noise

### I.8 Code changes required for implementation

This spec is a document only. To operationalize it, the following code changes are needed (none have been made):

| Change | File | Scope |
|--------|------|-------|
| New TSV loader for crowd-enVent format | `dataset/crowd_envent_loader.ts` (new) | Parse TSV, extract columns, handle types |
| Mapping function implementing §F.1 | `dataset/crowd_envent_mapper.ts` (new) | Stateless function, pure transform |
| CLI to run the full pipeline | `cli/build_crowd_envent_dataset.ts` (new) | Load → map → filter → write JSON |
| Train/test split utility | `dataset/split.ts` (new) | Stratified, seeded, writer-disjoint |
| Likelihood table rebuild | Modify `cli/build_likelihood.ts` | Accept crowd-enVent JSON as input |
| Integration tests | `__tests__/crowd_envent_mapping.test.ts` (new) | Deterministic mapping tests |

**None of these changes have been made. This section documents what is needed, not what exists.**
