# Expression Strength Analyzer (Layer-1)

## Purpose (Visual-Expressive Only)
Measures visual expressivity in text using surface signals (caps, punctuation repetition, emoji density, and character elongation). It does not infer meaning.

## Explicit Non-Goals
- No emotion, sentiment, valence, arousal, or intent inference
- No semantic interpretation
- No probabilistic or ML-based inference

## Formal Signal Definitions
Let `N = max(totalCharacters, 1)`.

1) **Capitalization density**
```
capsDensity = uppercaseCharacters / N
```

2) **Punctuation repetition**
For each run of consecutive `!` or `?`, repetition is `(runLength - 1)`.
```
exclamationRepetition = Σ(max(runLength("!")+ - 1, 0))
questionRepetition    = Σ(max(runLength("?")+ - 1, 0))
punctuationDensity    = repetition / N
```

3) **Character elongation (word-level)**
For each word, count consecutive repeated letters (case-insensitive).
If a run length ≥ `expressionStrength.elongation.minRepeat`,
elongation adds `(runLength - 1)` for that run.

Examples:
- “sooo” → 2
- “nooooo” → 4
- “cool” → 0
- “!!!!!” → 0 (punctuation is excluded)

4) **Emoji density**
```
emojiDensity = emojiCount / N
```

## Signal Ownership
| Signal | Owner |
| --- | --- |
| Capitalization ratio | ExpressionStrength |
| Punctuation repetition (!, ?) | ExpressionStrength |
| Character elongation | ExpressionStrength |
| Emoji density | ExpressionStrength |

## MASTER_CONSTANTS Reference
All numeric values are sourced from `MASTER_CONSTANTS.expressionStrength`:
- `weights`, `saturation`, `scoring`, `clip`
- `elongation.minRepeat`
- `density.minTotalChars`
- `baselineFloor`

## Audit Guarantees
- Deterministic, single-pass computation
- No semantic inference
- No cross-analyzer signal leakage
- Outputs bounded by constants only
