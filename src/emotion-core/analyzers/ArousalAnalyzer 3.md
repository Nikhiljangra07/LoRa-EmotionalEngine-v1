# Arousal Analyzer (Layer-1)

## Definition (Cognitive Load Only)
Arousal is defined as **structural cognitive load** derived from surface text form. It does **not** infer meaning.

## Signal Whitelist
Only these signals are used:
1. Sentence length variance
2. Rare / low-frequency word usage
3. Question density (interrogative structure)
4. Imperative verb presence
5. Clause stacking / run-on structures

## Explicit Non-Goals
- No emotion, sentiment, valence, or affect inference
- No punctuation-based signals
- No capitalization, elongation, or emoji signals
- No ML or probabilistic inference

## Separation Guarantees
Signals owned by `ExpressionStrengthAnalyzer` and `ValenceAnalyzer` are excluded.
This analyzer uses only structural and lexical rarity cues.

## Constants Used
All numeric values are sourced from `MASTER_CONSTANTS.arousalCalibrationConstants`:
- `weights.*`
- `saturation.*`
- `thresholds.*`
- `confidence.*`
- `bounds.*`
- `numbers.*`
- `regex.token`
- `question.starters`
- `imperative.verbs`
- `clause.conjunctions`
- `rarity.commonTokens`

## Layer-1 Safety
All inputs are explicit and enumerable (`sources[]`).
No hidden heuristics or downstream coupling.

## Why this Enables Layer-2
Layer-2 can safely interpret arousal as a deterministic, bounded structural load score
without risk of emotional leakage.

## Constraint (Verbatim)
CONSTRAINT:
ArousalAnalyzer MUST NOT use:
- punctuation-based signals
- capitalization
- elongation
- emoji
- sentiment or emotion lexicons

Violation of this rule invalidates Layer-1 separation.
