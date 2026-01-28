## Problem Statement
Mixed affect phrases like "not good bad" are not a bug. They reflect conflicting lexical evidence under negation, which produces uncertainty rather than a forced directional dominance. Forcing dominance in these cases collapses a valid neutral state and overstates certainty.

## Neurobiological Model
Stage 1: Initial negativity bias (amygdala) biases rapid appraisal toward potential threat or loss.
Stage 2: Cortical integration (ACC, vmPFC) resolves conflict signals and permits mixed affect to persist as a distinct, stable state.
Mixed affect is therefore valid and expected under competing cues.

## Linguistic Negation Findings
Negation attenuates valence magnitude but does not invert polarity.
"not good" is weakened positivity, not equivalent to "bad."
Scope and semantic specificity limit how far attenuation extends, preserving directional meaning when evidence is clear.

## Why Tests Accept Ranges (Not Single Labels)
Ambiguous lexical evidence yields lower confidence by design.
Accepting bounded ranges prevents artificial certainty and keeps outputs auditably conservative.
Engineering policy prefers defensible intervals over hard labels when signals conflict.

## Test Design Philosophy (V1)
Allowed:
- NEUTRAL or NEGATIVE when mixed affect is attenuated by negation
- Confidence bounded and non-overconfident
Forbidden:
- POSITIVE classification for "not good bad"
- Overconfident outputs under lexical conflict

## References
- Russell, J.A. Circumplex model of affect (PMC): https://pmc.ncbi.nlm.nih.gov/
- Mehrabian & Russell. PAD model (OUP): https://academic.oup.com/
- Negation in sentiment analysis (ACL Anthology): https://aclanthology.org/
- Mixed emotions and neural integration (Nature): https://www.nature.com/
