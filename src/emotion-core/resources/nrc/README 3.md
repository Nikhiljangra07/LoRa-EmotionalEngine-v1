# NRC Lexicon Resources (Layer-1 Safe)

The processed NRC lexicon at `processed/nrc_lexicon.json` is **Layer-1 safe**.
It contains only surface-level affect tokens and excludes pragmatic/intent
phenomena that are forbidden in Layer-1.

## Excluded Tokens
- `sarcasm`

## Rationale
Sarcasm is a pragmatic, intent-level phenomenon requiring speaker belief
modeling and contextual contradiction resolution. Layer-1 analyzers operate
on **observable surface signals only**, so sarcasm is explicitly excluded.

## Rebuild (Deterministic)
To regenerate the processed lexicon from the raw NRC file:

```
node src/emotion-core/resources/nrc/tools/build-nrc-lexicon.js
```

The rebuild script is deterministic and always excludes the tokens listed above.
