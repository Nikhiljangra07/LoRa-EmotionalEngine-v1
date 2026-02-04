# EIV Components → Inputs Mapping

## Why EIVComponents ≠ EIVInputs

`EIVComponents` represent raw Layer-1 analyzer outputs (scores with analyzer confidence).
`EIVInputs` represent the normalized composition inputs that the EIV math consumes.
They live at different semantic layers, even if the numeric values are aligned.

## Why explicit mapping is required

The EIV composition step must be auditable and deterministic. An explicit adapter
makes field-level provenance clear, ensures each value is intentionally routed,
and prevents silent semantic drift between layers.

Type coercion is prohibited in the EIV pipeline to preserve semantic validity.
