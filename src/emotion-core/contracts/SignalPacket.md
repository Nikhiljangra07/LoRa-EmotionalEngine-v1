# SignalPacket Contract

## Purpose
SignalPacket is a read-only snapshot of Layer-1 observations.
It represents observations, not interpretations.

## SentenceData Definition
SentenceData is a minimal structural carrier:
- `text`: the raw sentence text
- `position`: 0-indexed sentence position
- `esScore`: sentence-level Expression Strength
- `arousalScore`: sentence-level Arousal

No emotional or semantic fields are allowed because Layer-1 must remain
surface-only and auditable.

## Immutability Guarantee
INVARIANT:
SignalPacket objects are immutable after creation.
No analyzer or downstream consumer may mutate, enrich, or cache mutable references.

## Failure Modes Prevented
- Cross-sentence contamination
- Analyzer order dependency
- Heisenbugs from mutation
- Training / inference drift
