# Capitalization Intensity Component – Documentation 

## 1. Purpose and Design Goals

The capitalization component is a **signal extractor + math layer** for an Emotional Intensity Value (EIV) engine. It converts orthographic cues—especially capitalization—into a **bounded intensity contribution on ** that reflects **perceived emotional intensity/arousal**, not sentiment polarity. [veterinaria](https://veterinaria.org/index.php/REDVET/article/download/848/542/)

Design goals:

- Capture capitalization patterns that **humans reliably interpret as emphasis/intensity**.
- Keep intensity **bounded** in `[0,1]`, **monotonic** in the amount of signal.
- Use **simple, unit-testable formulas** with **research-backed parameter ranges** (not arbitrary magic numbers).
- **Separate layers**:
  - Detection layer: “Is this capitalization an intensity cue?”
  - Math/policy layer: “How much should it move the EIV score, and with what confidence?”

***

## 2. Empirical Foundations (What the Research Actually Shows)

### 2.1 Core evidence on capitalization and intensity

The most important empirical result comes from VADER (Hutto & Gilbert, 2014): [eegilbert](http://eegilbert.org/papers/icwsm14.vader.hutto.pdf)

- Controlled experiments where human raters judged the sentiment intensity of texts that differed **only** in formatting (e.g., `great` vs `GREAT`).
- For ALL-CAPS sentiment words, the average perceived intensity shift was:

> **+0.733** on a **-4 to +4** scale (95% CI ≈ [0.682, 0.784])

This effect is:

- **Highly significant** (t ≈ 28.95, p < 2.2e-16).
- **Symmetric across polarity**: ALL-CAPS increases intensity of both positive and negative terms.
- **Substantially larger** than punctuation effects (one exclamation mark is ~+0.29 on the same scale).

Psycholinguistic and pragmatics work (Liebrecht et al. 2019; Reisenzein et al. 2024) shows: [journals.sagepub](https://journals.sagepub.com/doi/10.1177/0261927X18808562)

- Perceived **intensity** behaves as a **continuous, additive quantity**.
- Human rating data are well fit by **linear** models for intensity scaling (no need for logarithmic/power-law curves in text).

Prosodic analysis (Heath 2021): [repository.upenn](https://repository.upenn.edu/bitstreams/106c9eff-3c3c-45d6-8dd9-9481b3f2d7c6/download)

- ALL-CAPS resembles spoken **high-arousal** prosody: higher pitch, higher loudness.
- Interpretations (anger vs excitement) depend on **lexical polarity**, not capitalization itself.

Repeated lengthening forms (Wang et al. 2024; Mansur et al. 2024): [aclanthology](https://aclanthology.org/2024.findings-emnlp.952.pdf)

- Repeated letters (e.g., `soooo good`) and repeated punctuation are used to **exaggerate emotional expression**.
- Handling these forms correctly improves classifier accuracy by **~7.6%** over baselines.

### 2.2 Best-source summary table

| Rank | Source | What it supports for this component |
|------|--------|-------------------------------------|
| 1 | Hutto & Gilbert 2014 (VADER) [eegilbert](http://eegilbert.org/papers/icwsm14.vader.hutto.pdf) | Quantified ALL-CAPS effect: **+0.733 on -4…4**, strongest formatting cue; validated linear additive rule design. |
| 2 | Liebrecht et al. 2019 [journals.sagepub](https://journals.sagepub.com/doi/10.1177/0261927X18808562) | Intensity is perceived roughly **linearly**; intensity effects can be stronger than polarity alone. |
| 3 | Reisenzein et al. 2024 [pmc.ncbi.nlm.nih](https://pmc.ncbi.nlm.nih.gov/articles/PMC11402726/) | Theoretically justifies treating emotion intensity as an **additive continuous quantity**. |
| 4 | Heath 2021 (All-Caps Prosody) [repository.upenn](https://repository.upenn.edu/bitstreams/106c9eff-3c3c-45d6-8dd9-9481b3f2d7c6/download) | ALL-CAPS as a general **high-arousal** marker, not specific to anger; supports interpreting caps as arousal rather than polarity. |
| 5 | Wang et al. 2024 (RLF) [aclanthology](https://aclanthology.org/2024.findings-emnlp.952.pdf) | Repeated letters/caps are a distinct **emphasis** channel that improves sentiment models; justifies including repeated-letters as a separate signal. |
| 6 | Mansur et al. 2024 / PLOS ONE [pmc.ncbi.nlm.nih](https://pmc.ncbi.nlm.nih.gov/articles/PMC10956744/) | Shows repeated letters are systematic, not noise; motivates separate handling and normalization instead of discarding. |
| 7 | Ehrmann et al. 2013 (Acronyms) [aclanthology](https://aclanthology.org/R13-1031.pdf) | High-accuracy acronym detection; supports **excluding acronyms** from emotional capitalization. |
| 8 | Emoji/sentiment work (e.g., Bai 2019; Singh 2024) [nature](https://www.nature.com/articles/s41598-024-58944-5) | Emoji and punctuation interact with text via additive or attention-like mechanisms; supports additive composition for v1. |

***

## 3. What Counts as an Intensity Signal

### 3.1 Positive signals

These patterns are treated as **emotionally motivated** capitalization signals:

1. **ALL-CAPS sentiment words** in mixed-case context  
   - Example: `This is VERY important`  
   - Empirical effect: ~+0.733 on -4…+4 scale (~+0.18 on ) for each such word. [veterinaria](https://veterinaria.org/index.php/REDVET/article/download/848/542/)

2. **ALL-CAPS sequences that look like repeated emotional tokens**  
   - Example: `STOP STOP STOP`  
   - Each `STOP` contributes a caps signal; effect is modeled **additively** but clamped.

3. **Repeated letters as orthographic elongation**  
   - Example: `soooo good`, `nooooo`  
   - Repeated letters correlate with **stronger emotional expression** and are present in ~5–6% of social posts. [pmc.ncbi.nlm.nih](https://pmc.ncbi.nlm.nih.gov/articles/PMC10956744/)
   - Treated as a **weaker but similar** signal compared to ALL-CAPS.

### 3.2 Non-signals and must-exclude patterns

These should **not** contribute emotional intensity via capitalization:

- **Acronyms / abbreviations**: `USA`, `API`, `CPU`, `NASA`.  
- **Technical identifiers**: `MAX_LENGTH`, `user_id`, `MyClassName`.  
- **Proper nouns in normal casing**: `Paris`, `John`, `Microsoft`.  
- **Headings / titles / UI labels**: `TERMS OF SERVICE`, `LOGIN`, etc.  
- **Single-letter tokens**: `A`, `I` (too ambiguous).

To prevent false positives, these are filtered in the detection layer via heuristic rules (see Section 6).

***

## 4. Core Intensity Model (Math Layer)

### 4.1 High-level structure

The capitalization component outputs:

- **Intensity contribution**: `caps_intensity ∈ [0,1]`
- **Confidence score**: `caps_confidence ∈ [0,1]`

No policy decisions (e.g., “ignore if low confidence”) are made here; downstream layers decide how to use `(intensity, confidence)`.

### 4.2 Per-token contributions

**Key design choice:** Using VADER’s empirically measured effect size as the anchor.

1. **Base per-word CAPS boost**

- From VADER: `+0.733` intensity shift on a **-4…+4** scale. [eegilbert](http://eegilbert.org/papers/icwsm14.vader.hutto.pdf)
- Normalized to  by dividing by the upper bound magnitude 4: [veterinaria](https://veterinaria.org/index.php/REDVET/article/download/848/542/)

  \[
  0.733 / 4 \approx 0.18325
  \]

- **Default parameter**:  
  - `base_caps_boost = 0.18`  
- **Recommended range**:  
  - `[0.16, 0.20]` to respect the 95% CI and allow domain tuning.

**Why 0.18 matters:**  

- This is the **only parameter directly grounded in a large, peer-reviewed human-rating experiment**.  
- Using this as the anchor ties the EIV scale quantitatively to human perception instead of arbitrary scaling.

2. **Per-token repeated-letters boost**

- Research shows repeated letters are used as emphasis and improve sentiment detection, but **no direct numeric effect** (like VADER’s 0.733) is published. [aclanthology](https://aclanthology.org/2024.findings-emnlp.952.pdf)
- Engineering decision: treat repeated letters as **weaker but similar** to caps:
  - Chosen default: approximately **70%** of the caps effect.
  - `base_repeated_boost = 0.13` (since 0.18 × 0.7 ≈ 0.126).

**Why 0.13 and not equal to caps?**

- Repeated letters are more likely to be:
  - Typographical quirks
  - Domain- or user-specific habits
- Caps are more standardized and salient. A lower weight reduces the risk of over-amplifying noisy signals while acknowledging the empirical benefit (7.6% accuracy improvement) of modeling them. [aclanthology](https://aclanthology.org/2024.findings-emnlp.952.pdf)

### 4.3 Document-level intensity formula

Let:

- `n_caps` = number of qualifying ALL-CAPS sentiment tokens
- `n_repeated` = number of qualifying repeated-letter tokens

Then:

\[
\text{raw_intensity} = (n_{\text{caps}} \times 0.18) + (n_{\text{repeated}} \times 0.13)
\]

\[
\text{caps_intensity} = \min(\text{raw_intensity}, 1.0)
\]

Properties:

- **Monotonic**: Increasing `n_caps` or `n_repeated` cannot reduce intensity.
- **Bounded**: Intensity is always in `[0,1]`, even with 200 caps words.
- **Linear** until clamping: Each additional caps/repeated token adds a constant increment until the score hits 1.0.

**Why linear, not log/power/sigmoid?**

- Empirical human perception work (Liebrecht; Reisenzein) supports **approximate linearity** of intensity ratings over the range used in sentiment tasks. [pmc.ncbi.nlm.nih](https://pmc.ncbi.nlm.nih.gov/articles/PMC11402726/)
- VADER’s rule system is **explicitly additive** (caps, punctuation, intensifiers each add a term). [eegilbert](http://eegilbert.org/papers/icwsm14.vader.hutto.pdf)
- No published evidence of a saturation curve for capitalization within realistic message lengths.

Sigmoid/other non-linear options are reserved for a future version if internal data show clear diminishing returns; starting with linear is the most **defensible and auditable** choice.

***

## 5. Detection Layer (Signal vs. Non-Signal)

### 5.1 ALL-CAPS detection

A token `w` is considered a caps signal if:

- `len(w) ≥ 2`
- All alphabetic characters are uppercase.
- It is **not** excluded by acronym/proper noun/code rules.
- Optionally, it matches or is close to a known sentiment-bearing lemma in the lexicon (to avoid random codes).

Pseudo-logic:

```python
def detect_caps(token):
    if len(token) < 2:
        return False
    if not token.isalpha():
        return False
    if not token.isupper():
        return False
    if should_exclude(token):
        return False
    return True
```

### 5.2 Repeated-letter detection

A token is a repeated-letter signal if:

- Maximum count of consecutive identical characters ≥ 3  
  (e.g., `sooo` → 3; `goooood` → 4)

Pseudo-logic:

```python
def has_repeated_letters(token, min_run=3):
    max_run = 1
    current = 1
    for i in range(1, len(token)):
        if token[i] == token[i-1]:
            current += 1
            max_run = max(max_run, current)
        else:
            current = 1
    return max_run >= min_run
```

**Why threshold 3?**

- Two repeated letters (`good` vs `goood`) can arise from normal spelling variations.
- Three or more is much more likely to be **deliberate emphasis** according to social media normalization work. [journals.plos](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0299652)

***

## 6. Exclusion Heuristics (Avoiding False Positives)

The component uses a **high-precision exclusion layer** to filter out caps that are **not emotional**:

### 6.1 Acronym filter

**Why:** Many all-caps tokens are stable acronyms, not emotional shouting.

- Maintain a hash set of common acronyms (500–5000 entries) from general and domain-specific lists (e.g., USA, FBI, GPU, API, SQL, NASA). [aclanthology](https://aclanthology.org/R13-1031.pdf)

Rule:

```python
if token in ACRONYM_LEXICON:
    exclude (no intensity contribution)
```

**Importance:** This is the **single biggest reducer** of false positives; standard acronym recognition can reach 80–98% accuracy. [pmc.ncbi.nlm.nih](https://pmc.ncbi.nlm.nih.gov/articles/PMC3932450/)

### 6.2 Proper nouns and sentence-initial capitals

**Why:** Sentence-initial capitalization or names like `PARIS` can be misinterpreted as emphasis.

- If a capitalized token appears early in the sentence and is tagged by an NER model as `PERSON`, `ORG`, `GPE`, etc., treat it as **non-emotional capitalization**.

Rule sketch:

```python
if is_sentence_initial(token) and is_proper_noun(token):
    exclude
```

### 6.3 Code patterns & identifiers

**Why:** Technical text often uses ALL_CAPS for constants or MACRO_NAMES.

- Patterns:
  - `SCREAMING_SNAKE_CASE`: `[A-Z_]{2,}`
  - `CamelCase`: `[A-Z][a-z]+[A-Z]`
  - `__dunder__`: `__\w+__`

If a token matches these and context is code/technical, ignore capitalization as emotional.

### 6.4 High-density caps penalty

If **more than 40%** of tokens in the segment are ALL-CAPS (after filtering):

- Keep intensity signal (for monotonicity), but **drastically lower confidence** (see next section).

Rationale:

- Normal expressive text has occasional caps; very high caps density is characteristic of:
  - Acronym-heavy documents.
  - Structured headers.
  - Spammy “SHOUTING” lists.

***

## 7. Confidence Model (How Sure Is the System This Is Emotion?)

Intensity tells “how strong if real”; **confidence estimates how likely it is real** vs. noise/structure.

### 7.1 Factors

1. **Base confidence** by pattern count:
   - `0 caps` → 1.0 (no capitalization signal, nothing to question).
   - `1 caps` → `base_conf = 0.50` (could be typo or random acronym missed by lexicon).
   - `≥2 caps` → `base_conf = 0.80` (repeated pattern is likely deliberate).

2. **Domain factor** (how this register uses caps):

   | Domain          | Factor | Rationale                          |
   |-----------------|--------|------------------------------------|
   | Social media    | 0.95   | Caps common; emphasis meaningful. |
   | Product reviews | 0.90   | Moderate emphasis.                |
   | Formal/news     | 0.85   | Rare but strong when present.     |
   | Code/technical  | 0.0    | Caps usually structural.          |

3. **Density factor**:

   - If caps density ≤ 0.30 → `density_factor = 1.0`
   - If caps density > 0.40 → `density_factor = 0.30`
   - Between 0.30–0.40: linearly interpolate.

   This sharply reduces confidence for cap-saturated text.

4. **(Optional) Pattern/position factor**:

   - Caps mid-sentence, surrounded by lowercase, especially before punctuation → small positive adjustment.
   - Caps only at sentence start → small negative adjustment.

### 7.2 Combined confidence formula

Let:

- `base_conf` be from count.
- `domain_factor` from domain.
- `density_factor` from caps density.
- (Optionally) `position_factor` ~ 1.0 ± 0.1.

Then:

\[
\text{caps_confidence} = \min \left( base\_conf \times domain\_factor \times density\_factor \times position\_factor,\ 1.0 \right)
\]

**Interpretation:**  
`caps_confidence` is an estimate of **P(“caps are intentional emotional emphasis”)**. Downstream systems can:

- Require a minimum confidence (e.g., ≥0.3) to use the signal.
- Weight intensity by confidence if desired.

***

## 8. Interaction with Punctuation and Emoji

This component is **caps-only**, but must coexist with other paralinguistic modules.

### 8.1 Composition rule in v1

Use **additive composition** across channels:

\[
\text{total_intensity} = \min(\text{caps_intensity} + \text{punct_intensity} + \text{emoji_intensity} + \dots, 1.0)
\]

**Why additive?**

- VADER adds independent rule effects (caps, exclamations, intensifiers), reflecting human rating changes combinatorially. [eegilbert](http://eegilbert.org/papers/icwsm14.vader.hutto.pdf)
- Emoji & punctuation are proven to **intensify** sentiment beyond text alone, and attention-based models often reduce to weighted sums. [nature](https://www.nature.com/articles/s41598-024-58944-5)

No empirical support currently exists for **multiplicative** or power-law interaction specific to caps × emoji; a gated/attention model can be introduced in a later version once there is domain-specific data.

***

## 9. Domain and Multilingual Considerations

### 9.1 Domains

- **Social media / chat**:  
  - Caps are common and expressive; use default parameters as given.
- **Formal writing / news**:  
  - Caps rare and often structural (section headings) or acronyms.
  - Recommended: keep `base_caps_boost` but adjust `domain_factor` to 0.85 and rely more heavily on exclusion heuristics.
- **Code / technical docs**:  
  - Treat `domain_factor = 0`. Capitalization signals are almost always structural.

### 9.2 Scripts without case

For scripts with **no case distinction** (e.g., Chinese, Japanese, Arabic, Hebrew):

- The capitalization component should effectively output **(0 intensity, 1 confidence)** always.
- Emotional intensity must be inferred from:
  - Repetition
  - Punctuation (e.g., `！！！`)
  - Emojis/emoticons
  - Lexical cues

Script detection at token or document level should gate whether caps logic is even applied.

***

## 10. Parameter Table with Ranges and “Why”

| Parameter | Default | Range | Why this value matters |
|----------|---------|-------|------------------------|
| `base_caps_boost` | **0.18** | [0.16, 0.20] | Directly derived from VADER’s +0.733 on a -4…4 scale; the **most empirically grounded** parameter. |
| `base_repeated_boost` | **0.13** | [0.10, 0.15] | Calibrated heuristic: ~70% of caps strength, acknowledging repeated letters as **weaker but real** emphasis. |
| `clamp_max` | **1.0** | [0.95, 1.0] | Ensures bounded EIV component; prevents runaway scores for long spammy inputs while maintaining monotonicity. |
| `min_repeated_run` | **3** |  [thesai](https://thesai.org/Downloads/Volume12No7/Paper_30-LSTM_VADER_and_TF_IDF_based_Hybrid_Sentiment.pdf) | Based on normalization work: ≥3 identical consecutive chars strongly suggests deliberate elongation. |
| `high_density_threshold` | **0.40** | [0.35, 0.50] | Above ~40% caps, the text is more likely structural/spam; used only for confidence, not intensity. |
| `density_conf_multiplier` | **0.30** | [0.20, 0.40] | Sharp penalty to indicate “caps are untrustworthy as emotional cue” at extreme densities. |
| `base_conf_single` | **0.50** | [0.45, 0.60] | Single caps word is ambiguous (typo/acronym), so confidence is moderate, not high. |
| `base_conf_multi` | **0.80** | [0.75, 0.85] | Repeated caps strongly suggest intentional emphasis; thus higher base confidence. |
| `domain_factor_social` | **0.95** | [0.90, 1.0] | VADER’s primary domain; trust caps strongly in this environment. |
| `domain_factor_formal` | **0.85** | [0.80, 0.90] | Caps rarer here; when they appear, treat as impactful but monitor FP rate. |
| `domain_factor_code` | **0.0** | [0.0, 0.1] | Caps almost always structural; safest default is to ignore caps as emotion. |

Each parameter is either:

- **Empirical** (caps_boost) → locked tight with narrow range.
- **Calibrated heuristic** (repeated_boost, thresholds) → adjustable during A/B tests and domain adaptation.

***

## 11. Implementation Summary and Testing Checklist

### 11.1 Implementation outline

1. **Tokenize** text.
2. **For each token**:
   - Apply exclusion heuristics (acronym, proper noun, code pattern).
   - Detect ALL-CAPS and repeated letters.
   - Add `0.18` for caps; `0.13` for repeated letters.
3. **Clamp** the sum to `[0,1]` for `caps_intensity`.
4. Compute `caps_confidence` from:
   - Number of caps tokens.
   - Domain factor.
   - Caps density.
5. Output `(caps_intensity, caps_confidence)`.

### 11.2 Tests

At minimum, include tests for:

- **Monotonicity**: More caps → never lower intensity.
- **Clamping**: Very large caps counts saturate at 1.0.
- **False positives**:
  - `“USA GDP is rising”` → intensity near 0.
  - `“CALL API v2 NOW”` in technical domain → intensity = 0.
- **True positives**:
  - `“This is VERY important”` → noticeable intensity (>0.15) with moderate-high confidence (>0.7 in social domain).
  - `“STOP STOP STOP”` → intensity near or at 1.0 with reasonably high confidence (unless density considered spammy by design).

***

