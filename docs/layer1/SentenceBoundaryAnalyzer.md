# Sentence Boundary Analyzer (SBA) — Layer 1

## 1) Purpose & Scope
The Sentence Boundary Analyzer (SBA) performs **surface-only** sentence boundary detection. It detects segmentation boundaries and emits boundary confidence and auditable sources. It does **not** perform emotion, sentiment, or psychological inference.

**Explicit statement:** This analyzer performs no emotional inference.

## 2) Architectural Guarantees
- **Layer-1 only:** Surface-level segmentation signals only.
- **Deterministic:** No stochastic behavior, no ML inference.
- **Auditable:** Every boundary includes `boundarySources[]`.
- **No post-hoc inference:** Decisions are made from observable text cues.
- **No retraining in code:** Punkt artifacts are loaded from constants only.

## 3) Two-Stage Punkt Design
### Stage 1 — Type-Level (Unsupervised)
- Loads pretrained Punkt artifacts:
  - Abbreviation list
  - Log-Likelihood Ratios (LLR)
- No runtime learning.
- Artifacts are sourced from `MASTER_CONSTANTS`.

### Stage 2 — Token-Level (Deterministic Rules)
- Capitalization of next token
- Abbreviation exceptions
- Decimal / URL / Email suppression
- Newline normalization
- Emoji adjacency rules (gated)
- Ellipsis handling (gated)
- Code-like / chat heuristics (gated)

## 4) Constants Used (Audit Table)
All numeric values are defined in `MASTER_CONSTANTS.sentenceBoundaryAnalyzer`.

| Constant Path | Value | Source | Justification |
| --- | --- | --- | --- |
| `enableChatHeuristics` | `true` | SOURCE-JUSTIFIED | Toggle for chat/emoji/code heuristics |
| `numbers.zero` | `0` | SOURCE-JUSTIFIED | Control flow index baseline |
| `numbers.one` | `1` | SOURCE-JUSTIFIED | Control flow step increment |
| `bounds.min` | `0` | SOURCE-JUSTIFIED | Confidence lower bound |
| `bounds.max` | `1` | SOURCE-JUSTIFIED | Confidence upper bound |
| `confidence.base` | `0.55` | UNJUSTIFIED | Calibrate on boundary audit set |
| `confidence.punctuationBoost.period` | `0.12` | UNJUSTIFIED | Calibrate on boundary audit set |
| `confidence.punctuationBoost.exclamation` | `0.16` | UNJUSTIFIED | Calibrate on boundary audit set |
| `confidence.punctuationBoost.question` | `0.16` | UNJUSTIFIED | Calibrate on boundary audit set |
| `confidence.punctuationBoost.newline` | `0.08` | UNJUSTIFIED | Calibrate on boundary audit set |
| `confidence.capitalizationBoost` | `0.08` | UNJUSTIFIED | Calibrate on boundary audit set |
| `confidence.abbreviationPenalty` | `0.18` | UNJUSTIFIED | Calibrate on boundary audit set |
| `confidence.decimalPenalty` | `0.2` | UNJUSTIFIED | Calibrate on boundary audit set |
| `confidence.urlOrEmailPenalty` | `0.22` | UNJUSTIFIED | Calibrate on boundary audit set |
| `confidence.emojiAdjacencyPenalty` | `0.16` | UNJUSTIFIED | Calibrate on boundary audit set |
| `confidence.ellipsisPenalty` | `0.14` | UNJUSTIFIED | Calibrate on boundary audit set |
| `confidence.chatFragmentPenalty` | `0.12` | UNJUSTIFIED | Calibrate on boundary audit set |
| `confidence.codeBlockPenalty` | `0.2` | UNJUSTIFIED | Calibrate on boundary audit set |
| `confidence.llrBoost` | `0.1` | UNJUSTIFIED | Calibrate on boundary audit set |
| `punkt.abbreviations` | list | SOURCE-JUSTIFIED | Punkt abbreviation artifacts |
| `punkt.llr` | `{}` | SOURCE-JUSTIFIED | Punkt LLR artifacts (placeholder) |
| `punkt.llrThreshold` | `0` | UNJUSTIFIED | Requires Punkt calibration set (≥500k tokens) |
| `heuristics.ellipsisMinLength` | `3` | UNJUSTIFIED | Calibrate ellipsis detection |
| `heuristics.emojiAdjacencyWindow` | `1` | UNJUSTIFIED | Calibrate emoji adjacency |
| `heuristics.chatFragmentMaxLength` | `40` | UNJUSTIFIED | Calibrate chat fragment detection |

## 5) Risk Mitigations
### Risk 1: Confidence Semantics Drift
**Mitigation:** `boundaryConfidence` is documented and implemented as a **monotonic ordinal score**, **not** a calibrated probability until calibration is complete.

### Risk 2: Emoji / Code Fragility
**Mitigation:** All emoji, ellipsis, and code/chat heuristics are gated behind:
`enableChatHeuristics` (config).

### Risk 3: Punkt Retraining Misuse
**Mitigation:** Punkt artifacts are **loaded only**. Retraining is not permitted in code.
Retraining requires **≥500k tokens**; otherwise use default Punkt + overrides only.

## 6) Failure Taxonomy (Known)
- **Title abbreviations:** Title abbreviations may suppress boundaries that are true sentence ends.
- **Domain-specific abbreviations:** Unknown abbreviations may be misclassified.
- **Code-like text:** Line-based boundaries may be conservative for dense code blocks.
- **Emoji adjacency:** May downrank boundaries near emoji even when true.
- **Ellipsis style:** Ellipsis used stylistically may be under-segmented.

## 7) Freeze Criteria for V1
- Punkt artifacts are externalized and stable.
- All UNJUSTIFIED constants are calibrated and documented.
- Audit tests pass deterministically.
- No emotional inference appears in outputs or sources.

## 8) Explicit Non-Inference Statement
This analyzer performs no emotional inference.
