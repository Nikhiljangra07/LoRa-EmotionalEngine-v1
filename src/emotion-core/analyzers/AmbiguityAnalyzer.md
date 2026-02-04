# Ambiguity Analyzer (Layer-1)

## Scope
Ambiguity is a surface-only structural signal. **Ambiguity ≠ emotion.**

## Explicit Non-Goals
- No emotion or sentiment inference
- No intent or pragmatic inference
- No sarcasm labeling

## Control Signal Contract
`confidencePenaltyHint` is a control signal, not metadata.

INVARIANT:
If ambiguityScore > MASTER_CONSTANTS.ambiguity.threshold,
ALL downstream confidence scores MUST be multiplied by confidencePenaltyHint.

The analyzer does not apply the penalty itself; downstream layers must enforce it.

## Signals (Surface-Only)
- Hedging markers
- Modal markers
- Contrast markers
- Rhetorical question patterns
- Passive constructions
- Polarity contradictions (lexical proximity only)

## Constants
All numeric values are sourced from `MASTER_CONSTANTS.ambiguityAnalyzer`.
