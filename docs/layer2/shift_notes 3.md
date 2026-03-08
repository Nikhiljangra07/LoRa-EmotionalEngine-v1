# Layer-2 Domain Shift & Bias Notes (crowd-enVent -> LoRa)

## 1. Dataset Origin Summary

crowd-enVent is a prompted corpus of autobiographical event narratives collected in English via crowd-sourcing (Prolific). Writers are asked to produce event descriptions under an explicit emotion prompt, and each sample is accompanied by 21 appraisal ratings on a 1-5 Likert scale. A separate reader-side reconstruction set provides five independent reader judgments per item, enabling inter-rater reliability analysis and writer-vs-reader comparisons.

This construction supports controlled appraisal analysis, but it is materially different from live conversational interaction. The text is retrospective, episode-centered, and generated under an emotion condition rather than emerging spontaneously in turn-by-turn dialogue.

This is not spontaneous conversational data.

## 2. Prompt-Induced Bias

### 2.1 Emotion-Priming Bias

Writers are prompted with a template equivalent to "I felt [emotion] when...". This creates label-conditioned generation: the target emotion is known before writing, and lexical content is selected under that frame.

Implications:
- Emotion salience is increased relative to unconstrained messaging.
- Signal-to-noise is cleaner than in natural chat.
- Appraisal patterns can appear more separable than in real deployment.

Risk:
The model may overestimate class separability when applied to short, ambiguous user messages where emotion is not pre-specified.

### 2.2 Narrative Coherence Bias

The corpus is dominated by coherent, sentence-level narratives of events. These narratives are more complete than typical chat turns and often contain causal framing, actor roles, and evaluative language.

Implications:
- Appraisal cues (agency, control, relevance) are more explicit.
- Surface markers for certainty and valence are easier to extract.

Risk:
Performance measured on coherent narratives may not transfer to fragmented, colloquial, or elliptical chat text where cues are sparse.

### 2.3 Intensity Inflation

Prompted recollection of emotional episodes tends to favor memorable events. Memorable events are often higher in arousal and goal relevance than everyday conversational content.

Implications:
- Distribution shift toward stronger affective episodes.
- Potential under-representation of low-intensity, mixed, or neutral drifts.

Risk:
LoRa may map mild or uncertain conversational signals to stronger emotional states than intended if calibrated only on episodic narratives.

## 3. Self-Report vs Observer Bias

### 3.1 Writer Appraisals

Writer annotations have privileged internal access to experienced meaning. This usually improves alignment for subjective dimensions such as valence and perceived relevance. In current Layer-2 artifacts, valence-related reliability is comparatively stronger than several control/certainty-related channels.

### 3.2 Reader Reconstructions

Reader annotations are inferred from text only, without access to internal state. This induces observational uncertainty:
- Emotion Fleiss/Cohen-style agreement is moderate-to-unstable (reported around kappa = 0.47 in current analysis context).
- Most appraisal dimensions fall below 0.50 agreement in reader reconstruction settings.

Implication:
Control, certainty, and arousal are inherently noisier when inferred from text than when self-reported by the writer.

LoRa reliability weighting in Layer-2 was derived from IRR estimates specifically to encode this instability into inference weighting, rather than treating all dimensions as equally trustworthy.

## 4. Domain Gap: crowd-enVent vs LoRa Chat

| Feature | crowd-enVent | LoRa Chat |
|---|---|---|
| Turn structure | Single narrative | Multi-turn |
| Emotion knowledge | Prompted | Unknown |
| Length | Paragraph | Short message |
| Explicit cues | High | Often implicit |
| Intensity | Episodic peak | Often low/mixed |
| Social dynamics | Retrospective | Live interaction |

### 4.1 Short-Form Compression

LoRa chat inputs are frequently short, compressed, and context-light. Many turns lack explicit lexical cues required for stable appraisal reconstruction, especially for certainty and control. Under short-form conditions, posterior distributions become flatter and gate behavior becomes a major determinant of safety-coverage tradeoff.

### 4.2 Mixed-Emotion Turns

Real chat often mixes signals (for example, irritation plus humor, frustration plus resignation, or sarcasm with neutral wording). crowd-enVent instances are emotion-prompted and comparatively single-focus. This difference can increase confusion among adjacent negative classes and reduce confidence calibration quality on live traffic.

### 4.3 Temporal Drift

Chat meaning unfolds across turns. A single-turn snapshot can miss escalation, de-escalation, recovery, or affective persistence. crowd-enVent provides static event slices rather than trajectories. This mismatch justifies trajectory-aware modules (Pressure and Escalation) as architectural additions rather than local threshold tweaks.

## 5. Known Failure Modes Under Domain Shift

- **Anger <-> Fear confusion in low-text contexts:** when lexical evidence is sparse, high arousal with negative valence can collapse into adjacent threat-related classes.
- **Certainty instability without predictability markers:** absent explicit temporal/predictive language, certainty estimates become underdetermined.
- **Control instability in short utterances:** sparse references to actor roles or causal structure degrade control inference reliability.
- **Neutral sarcasm misread as positive valence:** polite or surface-positive wording with pragmatic negativity can bias valence upward unless multi-turn context is available.

These are expected failure modes under distribution shift, not implementation defects in the current Layer-2 evaluators.

## 6. Mitigations Already Implemented

Current Layer-2 mitigations include:
- IRR-derived dimension weighting.
- Blended priors to reduce collapse bias from skewed class frequencies.
- Temperature calibration for probability scaling.
- Conservative gating to trade coverage for safety.
- Harmful-pair detection in evaluation and guard analysis.

These mechanisms reduce overconfidence and improve defensibility of decisions, but they do not eliminate domain shift. They operate within the statistical assumptions of the available dataset and cannot fully recover missing conversational context.

## 7. What Pressure & Escalation Will Fix

The next architectural step is temporal modeling across turns.

Pressure module contributions:
- Multi-turn accumulation of weak signals.
- Temporal smoothing of noisy per-turn estimates.
- Confidence amplification only when directional consistency persists.

Escalation module contributions:
- Explicit modeling of transition dynamics.
- Tracking state drift over dialogue time.
- Improved cross-turn separation for confusable classes such as anger vs sadness and anger vs fear.

These are architectural extensions, not patches to existing gate thresholds. They address a structural gap (single-turn static inference) rather than only retuning confidence criteria.

## 8. Honest Conclusion

Within current evidence, crowd-enVent provides strong grounding for valence, moderate grounding for agency, and weaker grounding for certainty/control under observer-style reconstruction. The Layer-2 pipeline is statistically defensible inside its dataset assumptions and useful as a structured prior for safety-aware inference evaluation.

The same pipeline remains domain-limited when transferred directly to live chat, where messages are shorter, more implicit, and temporally dependent. Deployment should treat these estimates as constrained probabilistic guidance, not universal psychological truth.

Layer-2 is statistically valid within dataset assumptions. External generalization requires temporal modeling and real-chat validation.

