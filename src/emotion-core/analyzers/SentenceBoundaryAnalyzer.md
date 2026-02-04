# Sentence Boundary Analyzer (Layer-1)

## Purpose (Syntactic-Only)
Segments text into syntactic sentence units using punctuation and clause boundaries. Does not infer meaning.

## Explicit Non-Goals
- No emotion, sentiment, valence, arousal, or affect inference
- No intent or meaning inference
- No discourse-level interpretation
- No probabilistic or ML-based segmentation

### Explicit Exclusion: Sarcasm

Sarcasm is a pragmatic, intent-level phenomenon requiring
speaker belief modeling and contextual contradiction resolution.

Layer-1 analyzers operate on **observable surface signals only**.

Therefore:
- Sarcasm is NOT detected
- Sarcasm is NOT inferred
- Sarcasm is NOT modeled

Any apparent sarcasm-related behavior in tests refers solely to
surface-level polarity inversion or expression strength patterns,
without intent attribution.

This is critical for audit defense.

## boundaryConfidence (Routing / Safety Signal)
`boundaryConfidence` is an ordinal control signal, not a calibrated probability.

**Invariant:** If `boundaryConfidence < MASTER_CONSTANTS.sentenceBoundaryAnalyzer.confidence.hardMinimum`,
all downstream sentence-level analyzers MUST fall back to message-level computation.

This invariant is documented only; it is not enforced in Layer-1 runtime.

## Heuristics (All Config-Driven)
Each heuristic is mapped to `MASTER_CONSTANTS.sentenceBoundaryAnalyzer`:
- **Punctuation boundaries** → `confidence.punctuationBoost.*`
- **Capitalized next token** → `confidence.capitalizationBoost`
- **Abbreviation handling (Punkt)** → `punkt.abbreviations`, `confidence.abbreviationPenalty`, `punkt.llr`, `punkt.llrThreshold`, `confidence.llrBoost`
- **Decimal suppression** → `confidence.decimalPenalty`, `regex.digit`
- **URL/email suppression** → `confidence.urlOrEmailPenalty`, `regex.urlOrEmail`
- **Ellipsis context** → `heuristics.ellipsisMinLength`, `confidence.ellipsisPenalty`
- **Emoji adjacency** → `heuristics.emojiAdjacencyWindow`, `confidence.emojiAdjacencyPenalty`, `regex.emoji`
- **Chat fragments** → `heuristics.chatFragmentMaxLength`, `confidence.chatFragmentPenalty`, `regex.chatFragmentPrefix`
- **Code-like context** → `confidence.codeBlockPenalty`, `regex.codeLike`, `regex.codeBlock`
- **Newline normalization** → `regex.newlineWindows`, `regex.newlineClassic`

## Abbreviation Handling (Punkt-Style)
A period after an abbreviation suppresses a boundary only when:
1) The next token starts with a lowercase letter
2) It is not end-of-text
3) It is not a newline boundary

Otherwise, the boundary is emitted.

## Calibration Outside Layer-1
All UNJUSTIFIED constants are calibrated outside Layer-1 using an audit set.
Layer-1 does not learn or update parameters at runtime.

## Determinism & Non-Leakage
- Deterministic output for identical inputs
- All decisions include `boundarySources`
- No emotional terms are emitted by sources or ambiguity flags
