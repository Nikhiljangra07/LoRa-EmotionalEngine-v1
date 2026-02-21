
⸻

Expression Strength (ES)

Module: emotion-core
Status: V1 – Frozen
Type: Deterministic, rule-based signal

⸻

1. What Expression Strength (ES) Is

Expression Strength (ES) is a surface-level expressivity signal that quantifies how strongly a user is expressing an emotional stance in text, independent of:
	•	which emotion is present,
	•	whether the emotion is positive or negative,
	•	how confident the system is in its inference.

ES answers one question only:

How emphatically is the user expressing themselves in this message?

It captures textual paralanguage—the written equivalents of prosody, volume, emphasis, and gesture—using observable, rule-based features.

⸻

2. What ES Is Not (Critical)

ES is not:
	•	❌ an emotion category (anger, joy, sadness, etc.)
	•	❌ sentiment polarity (positive / negative)
	•	❌ arousal (activation level of emotion)
	•	❌ Emotional Intensity Value (EIV)
	•	❌ inference confidence or reliability
	•	❌ uncertainty estimation
	•	❌ psychological certainty
	•	❌ user intent classification

ES must never:
	•	choose an emotion,
	•	flip valence,
	•	override semantic meaning,
	•	increase inference confidence,
	•	replace IR (Inference Reliability).

If ES is used for any of the above, the system is incorrect by design.

⸻

3. Conceptual Definition

ES is a display-side signal, not a semantic one.

It measures how the message is written, not what the message means.

In speech terms:
	•	Emotion = what you feel
	•	Arousal = how activated you are
	•	ES = how loudly / emphatically you are speaking

⸻

4. Inputs to ES

ES is computed only from textual paralinguistic features, including:
	•	Capitalization intensity
(e.g., ALL CAPS, emphasized words)
	•	Punctuation emphasis
(e.g., !!!, ???, ?!?)
	•	Emoji / emoticon presence and density
	•	Expressive character lengthening
(e.g., soooo, noooo)
	•	Intensifier usage
(e.g., very, extremely, absolutely)
	•	Interjections
(e.g., wow, ugh, omg, haha)

These signals are feature-isolated, additive, and bounded.

⸻

5. Output Contract
	•	Type: scalar number
	•	Range: 0.0 ≤ ES ≤ 1.0
	•	Deterministic: same input → same output
	•	Saturating: expressive cues cap quickly
	•	Monotonic: more emphasis → never lower ES
	•	Explainable: feature-level breakdown available

⸻

6. Baseline Behavior
	•	Plain declarative text with no paralinguistic markers must produce near-baseline ES.
	•	Emotion words alone do not imply high ES.

Examples:
	•	"I am disappointed." → low ES
	•	"I am VERY disappointed!!! 😡" → high ES

Semantic emotion ≠ expressive strength.

⸻

7. Relationship to Other Signals

Signal	Role
Valence	Direction of emotion (positive/negative/neutral)
Arousal	Activation level of emotion
EIV	Model-level emotional intensity
ES	Surface-level expressivity amplifier
IR	Inference reliability / safety

ES may modulate how strongly EIV is expressed, within strict bounds.
ES must never influence IR.

⸻

8. Integration Rules (Hard Constraints)
	•	ES may scale display intensity
	•	ES may inform response tone
	•	ES may affect pacing or emphasis

But ES may never:
	•	select emotion category
	•	override semantic interpretation
	•	increase certainty
	•	bypass IR or safety governors

⸻

9. Safety & Stability Guarantees
	•	ES is bounded (prevents runaway amplification)
	•	ES is rule-based (auditable)
	•	ES is non-probabilistic (no randomness)
	•	ES is observable (feature breakdown logged)

Any violation of these guarantees is a bug, not a tuning issue.

⸻

10. Versioning Policy
	•	ES V1 is frozen
	•	Behavior changes require:
	1.	config update,
	2.	test updates,
	3.	explicit version bump.

No silent behavior drift is allowed.

⸻

11. Summary (One-Line Contract)

Expression Strength (ES) is a bounded, deterministic, surface-level signal that measures how emphatically a user expresses emotion in text, independent of emotion type, valence, arousal, or inference confidence.

⸻

Baseline Expressivity Floor (BEF) represents the minimal expressivity inherent in any intentional human utterance. It does not encode emotion, intensity, or sentiment, and exists solely to distinguish uttered text from silence. BEF acts as a floor, not an amplifier.

