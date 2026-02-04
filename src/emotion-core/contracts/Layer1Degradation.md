# Layer-1 Degradation Contract

## Purpose
Silent failure is worse than conservative fallback. This contract makes low-confidence
signals operational so downstream layers cannot over-trust weak evidence.

## Degradation Rule (Verbatim)
DEGRADATION RULE:
If any Layer-1 analyzer produces a confidence score < 0.3,
Layer-2 MUST:
	1.	Fall back to message-level metrics only
	2.	Suppress sentence-level family classification confidence
	3.	Treat all sentence-derived signals as non-authoritative

## Downstream Obligation (Mandatory)
Layer-2 Enforcement:
When layer1Health.degraded === true,
Layer-2 MUST:
	•	Ignore sentence-level ES / Valence / Arousal
	•	Compute family classification at message level only
	•	Suppress confidence amplification
	•	Mark outputs as low-resolution

## Failure Modes Prevented
- False precision
- Sentence-level hallucinations
- Overconfident family assignment
- Audit rejection
