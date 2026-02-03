# Sentence Boundary Analyzer (Layer-1)

## Purpose (Layer-1 Segmentation Only)
The Sentence Boundary Analyzer (SBA) detects sentence segmentation boundaries from surface text cues. It emits boundary locations, sources, and ambiguity flags. It does **not** infer emotion, sentiment, intent, or psychological state.

## Explicit Non-Goals
- No emotion, sentiment, valence, arousal, sarcasm, or affect inference
- No discourse-level interpretation
- No probabilistic or ML-based segmentation

## Boundary Decision Sources
Each emitted boundary includes `boundarySources[]` populated from observable cues:
- Punctuation markers (`.` `!` `?`)
- Newline boundaries
- Capitalization of the next token
- Abbreviation handling (Punkt-style)
- Contextual heuristics (emoji, ellipsis, chat, code) gated by config

## Abbreviation Handling (Punkt-Style)
Abbreviations suppress a boundary **only** when:
1. The next token starts with a lowercase letter
2. It is not end-of-text
3. It is not a newline boundary

Otherwise, the boundary is emitted.

Examples:
- Continuation: “Dr. smith…” → suppression with `punkt_abbreviation_continuation`
- Sentence end: “I met Dr.” → boundary with `punkt_abbreviation_sentence_end`

## Why Punkt-Style Logic (Kiss & Strunk 2006)
Punkt-based segmentation is a deterministic, explainable approach for sentence boundary detection in unannotated corpora. The SBA uses fixed Punkt artifacts (abbreviations, LLR thresholds) without runtime training.

Reference: Kiss & Strunk (2006), “Unsupervised Multilingual Sentence Boundary Detection.”

## Constants Provenance
All constants and regex policies are defined in `MASTER_CONSTANTS.sentenceBoundaryAnalyzer`.

**Source-Justified:**
- `punkt.abbreviations`, `punkt.llr` (pretrained artifacts)
- `bounds`, `numbers`
- `enableChatHeuristics` (explicit gating)
- `regex.*` (policy definitions centralized for audit)

**Calibrated / UNJUSTIFIED (Requires Audit Set):**
- `confidence.*` (ordinal confidence weights)
- `punkt.llrThreshold`
- `heuristics.*` (ellipsis length, emoji adjacency window, chat fragment max length)

## Determinism & Audit Guarantees
- Deterministic output for identical inputs
- No stochastic behavior
- Every boundary decision includes sources
- All thresholds and regex policies are centralized in `MASTER_CONSTANTS`

## Explicit Non-Inference Statement
This analyzer performs no emotional inference.
