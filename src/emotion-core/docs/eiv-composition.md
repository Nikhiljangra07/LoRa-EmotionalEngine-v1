## Overview
This document defines the EIV composition formulas used to combine arousal, valence magnitude, and expression strength (ES) into a bounded intensity signal. These formulas are engineering aggregators designed to preserve signal integrity and stability; they are not physiological models.

## Base Fusion (Arousal + Valence Magnitude)
Base intensity is computed as a confidence-weighted mean of arousal and absolute valence:
- Purpose: fuse orthogonal dimensions without polarity leakage.
- Problem solved: prevents negative valence from cancelling activation.
- Failure mode avoided: flat averaging that conflates direction with intensity.
Grounding: affective dimensional theory (Russell, 1980; PAD model) treats arousal and valence as orthogonal axes.

## Confidence-Weighted Mean
Confidence-weighted aggregation:
- Purpose: emphasize reliable signals and downweight ambiguous ones.
- Problem solved: noisy or weak evidence inflating intensity.
- Failure mode avoided: treating all signals as equally reliable.
Grounding: psychometrics and reliability weighting (e.g., inter-rater reliability and confidence-weighted measures in annotation studies).

## Absolute Valence Usage
Absolute valence magnitude is used in base fusion:
- Purpose: intensity should reflect strength, not direction.
- Problem solved: valence polarity inversion affecting intensity.
- Failure mode avoided: negative valence reducing arousal magnitude.
Grounding: dimensional emotion models treat valence direction separately from arousal magnitude.

## ES Gain Modulation
Expression Strength (ES) acts as a multiplicative gain:
- Purpose: modulate intensity based on expressivity without contributing to base.
- Problem solved: ES fabricating intensity in low-activation messages.
- Failure mode avoided: ES dominating intensity via additive averaging.
Grounding: prosody and emphasis literature treat expressivity as a modifier, not a semantic driver.

## Floor Gating
When base intensity is near the baseline floor, ES gain is attenuated:
- Purpose: prevent amplification of near-zero base intensity.
- Problem solved: expressive styling creating false intensity.
- Failure mode avoided: low-content messages inflating intensity via ES.
Grounding: baseline activation in affective norms (ANEW, EmoBank) and attenuation of emphasis when semantic content is weak.

## Gain Bounding and Saturation
Gain is bounded and final EIV is clamped:
- Purpose: protect stability and prevent runaway amplification.
- Problem solved: extreme surface expressivity causing outliers.
- Failure mode avoided: saturation from punctuation or style.
Grounding: emphasis discounting and sarcasm literature highlights unreliability of surface cues without semantic support.

## Limits and Non-Claims
- These formulas are engineering aggregators, not physiological measurements.
- They preserve signal integrity and stability, not “true emotion.”
- No semantic category inference is performed in composition.

## References
- Russell, J. A. (1980). Circumplex model of affect.
- Scherer, K. R. (2005). Component process model.
- EmoBank / SemEval affective annotation reliability.
- ANEW and Warriner et al. norms for baseline activation.
- Prosody and emphasis literature on intensity modulation.
