## Definition of Arousal
Arousal represents physiological activation or mobilization of the organism. It is orthogonal to valence and does not indicate positivity or negativity. Arousal is modeled as a bounded scalar with a non-zero baseline to reflect resting activation in intentional human utterances.

## Why Arousal ≠ Valence
Valence encodes pleasantness versus unpleasantness. Arousal encodes activation intensity. The same arousal level can accompany positive or negative content. The analyzer therefore avoids sentiment lexicons and does not infer emotion categories.

## Why Baseline ≠ Zero
Intentional language typically carries minimal activation even when semantically neutral. The baseline floor captures this resting activation without implying emotion or expressivity.

## Feature Explanations
- Exclamation marks: additive activation with soft cap.
- Mixed punctuation: modest activation increment without semantic meaning.
- Capitalization ratio: surface-level activation cue, soft-capped.
- High-arousal emoji: explicit activation markers with a cap.
- Elongation: low-confidence activation modifier, not a driver.

## Confidence Penalties
Confidence is governed independently of arousal magnitude:
- Potential sarcasm cues reduce confidence.
- Conflicting activation cues reduce confidence.
- Low-evidence or very short inputs reduce confidence.
- Window variance reduces confidence for long texts.

## DO NOT
- Use sentiment lexicons (NRC, VADER, etc.).
- Average or couple with valence or ES.
- Interpret punctuation as polarity.
- Allow punctuation alone to saturate arousal.

## Citations
- ANEW norms (Bradley & Lang) — affective ratings: https://aclanthology.org/
- Warriner et al. norms (valence/arousal): https://aclanthology.org/
- EmoBank (valence/arousal corpus): https://aclanthology.org/
- Russell circumplex model: https://pmc.ncbi.nlm.nih.gov/
- Emoji and affective cues: https://www.nature.com/
