# Valence Analyzer (Layer-1)

## Scope Definition (Polarity Only)
This analyzer computes lexical polarity using **polarity-only** lexicons plus mechanical negation and contrast handling. It does **not** infer meaning.

## Signal Whitelist
ValenceAnalyzer MAY use only:
- Polarity-only lexicons (binary/scalar positive/negative polarity)
- Negation scope detection
- Contrastive conjunctions

## Explicit Prohibition
CONSTRAINT:
ValenceAnalyzer MUST NOT use emotion-labeled lexicons
(e.g., anger, sadness, fear words).

## Constants Used (Paths)
All numeric values come from `MASTER_CONSTANTS.valenceAnalyzer`:
- `lexicon.polarity.*`
- `negation.scope`, `negation.tokens`
- `contrast.markers`, `contrast.preWeight`, `contrast.postWeight`
- `thresholds.minMagnitude`, `confidence.minAffectiveTokens`, `confidence.lowEvidenceMultiplier`
- `normalization.*`, `bounds.*`, `iteration.indexStep`

## Non-Goals
- No emotion categories or affect labels
- No arousal/intensity coupling
- No expressivity (caps, punctuation, emoji) influence
- No ML or probabilistic inference

## Audit Guarantees
- Deterministic output only
- Inputs are explicit and enumerable: `polarityHits`, `negationSpans`, `contrastiveMarkers`
- Runtime guard rejects emotion-labeled lexicon tokens in non-production
