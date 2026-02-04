

⸻


# LoRa v1 — Emotional & Social Intelligence Architecture
**Version:** 1.0  
**Status:** Design Locked (Pre-Implementation)  
**Scope:** Text-only LoRa v1 (No vision, no voice)  
**Primary Goal:** Build a trustworthy, auditable, emotionally & socially intelligent companion using signal-first, rule-based architecture.

---

## 0. CORE DESIGN PRINCIPLES (NON-NEGOTIABLE)

These principles govern every layer and module.

1. **Observation Before Interpretation**
   - No module may infer emotions, intent, or meaning unless explicitly designed to.
   - Layer-1 observes. Layer-2 organizes. Layer-3 decides.

2. **Signal Purity**
   - Signals are measurable properties of text, not psychological claims.
   - Emotional meaning is constructed only after signal aggregation.

3. **Strict Layer Separation**
   - No upward logic leaks downward.
   - No analyzer depends on emotional labels.
   - No emotional logic alters raw signals.

4. **Auditability**
   - Every output must be traceable to:
     - Observed signals
     - Defined rules
     - Centralized constants

5. **No Black-Box ML in v1**
   - Rule-based, testable, explainable systems only.
   - ML may appear only after empirical validation in later versions.

---

## 1. HIGH-LEVEL THREE-LAYER MODEL

User Text
↓
────────────────────────────
Layer 1 — Signal Observation
────────────────────────────
↓
────────────────────────────
Layer 2 — Emotional Structuring
────────────────────────────
↓
────────────────────────────
Layer 3 — Response Intelligence
────────────────────────────
↓
LLM Prompt → LoRa Response

Each layer has **strict responsibilities**.

---

## 2. LAYER 1 — SIGNAL OBSERVATION LAYER
**Purpose:** Extract observable, non-emotional, non-interpretive signals from raw text.

Layer-1 answers:
> “What is objectively present in this text?”

### 2.1 RULES FOR LAYER 1
- ❌ No emotion labels
- ❌ No intent inference
- ❌ No user psychology
- ✅ Only measurable linguistic features

---

### 2.2 LAYER 1 ANALYZERS (COMPLETE LIST)

#### 2.2.1 SentenceBoundaryAnalyzer
**Purpose:**  
Segment text into structurally meaningful units.

**Why it exists:**
- Escalation, onset/offset, and narrative arcs require boundaries.
- Without boundaries, all downstream signals smear.

**Outputs:**
```ts
{
  sentences: string[],
  sentenceCount: number,
  boundaryConfidence: number
}


⸻

2.2.2 ExpressionStrengthAnalyzer (ES)
Purpose:
Measure expressive force without emotional meaning.

Signals used:
	•	Capitalization
	•	Repetition
	•	Elongation
	•	Exclamation density

Outputs:

{
  score: number,        // 0–1
  confidence: number    // 0–1
}


⸻

2.2.3 ValenceAnalyzer
Purpose:
Measure linguistic polarity direction only.

Important:
	•	Valence ≠ emotion
	•	Valence ≠ intensity

Outputs:

{
  score: number,        // -1 to +1
  confidence: number
}


⸻

2.2.4 ArousalAnalyzer
Purpose:
Measure activation level (energy, urgency).

Outputs:

{
  arousal: number,     // 0–1
  confidence: number
}


⸻

2.2.5 AmbiguityAnalyzer
Purpose:
Detect linguistic multiplicity and interpretive uncertainty.

Why it exists:
	•	Prevent premature emotional collapse
	•	Downweight confidence when meaning is unstable

Signals:
	•	Hedging
	•	Contradiction
	•	Modal verbs
	•	Rhetorical questions
	•	Passive constructions
	•	Discourse contrasts

Outputs:

{
  ambiguityScore: number,        // 0–1
  ambiguitySources: string[],
  contradictionDetected: boolean,
  confidencePenaltyHint: number  // control signal for downstream confidence
}


⸻

2.3 LAYER 1 OUTPUT CONTRACT

Layer-1 produces a Signal Packet:

SignalPacket {
  sentences: SentenceData[],
  expressionStrength: ES,
  valence: Valence,
  arousal: Arousal,
  ambiguity: Ambiguity
}

This packet is immutable beyond Layer-1.

⸻

3. LAYER 2 — EMOTIONAL STRUCTURING LAYER

Purpose: Organize signals into emotional structures without generating responses.

Layer-2 answers:

“What emotional patterns are emerging over time?”

⸻

3.1 CORE RULES FOR LAYER 2
	•	❌ No natural language responses
	•	❌ No advice
	•	❌ No moral framing
	•	✅ Pattern detection
	•	✅ Temporal dynamics
	•	✅ Emotional categorization

⸻

3.2 COMPONENTS OF LAYER 2

⸻

3.2.1 Escalation Engine
Purpose:
Track emotional velocity, not emotion itself.

Subcomponents:
	•	Onset: Rate of intensity increase
	•	Offset: Rate of decay to baseline

Inputs:
	•	Sentence-level ES
	•	Sentence-level arousal
	•	Temporal order

Outputs:

{
  onsetRate: number,
  offsetRate: number,
  volatility: number
}


⸻

3.2.2 Pressure Engine
Purpose:
Track accumulated unresolved emotional force across messages and sessions.

Key idea:
	•	Pressure ≠ intensity
	•	Pressure = density of unresolved activation

Inputs:
	•	Repeated themes
	•	Recurring emotional families
	•	Looping narratives

Outputs:

{
  pressureScore: number,    // 0–1
  pressureTrend: 'rising' | 'stable' | 'releasing'
}


⸻

3.2.3 Looping Detector (Textual Refractory Analog)
Purpose:
Detect when a user is cognitively looping on the same emotional content.

Indicators:
	•	Repetition of grievances
	•	Circular justification
	•	Inability to integrate new framing

Outputs:

{
  loopingActive: boolean,
  loopDepth: number
}


⸻

3.2.4 Emotion Family Classifier
Purpose:
Classify emotion families, not specific emotions.

Families (v1):
	•	Anger
	•	Sadness
	•	Fear
	•	Embarrassment
	•	Joy
	•	Mixed / Unclear

Inputs:
	•	Valence direction
	•	Arousal level
	•	Action tendency (approach vs withdraw)
	•	Narrative focus

Outputs:

{
  primaryFamily: string,
  secondaryFamily?: string,
  confidence: number
}


⸻

3.2.5 EIV (Emotional Intensity Value)
Purpose:
Represent intensity only, independent of meaning.

Definition:
	•	EIV ∈ [0,1]
	•	Session-aggregated
	•	Feeds ETV later (not part of this layer)

Inputs:
	•	ES
	•	Arousal
	•	Escalation gating
	•	Ambiguity penalty

Outputs:

{
  eiv: number,
  confidence: number
}


⸻

3.3 LAYER 2 OUTPUT: EMOTIONAL PROFILE

EmotionalProfile {
  eiv: number,
  emotionFamily: {
    primary: string,
    secondary?: string,
    confidence: number
  },
  escalation: EscalationMetrics,
  pressure: PressureMetrics,
  looping: LoopMetrics,
  ambiguity: AmbiguitySummary
}

This profile is passed read-only to Layer-3.

⸻

4. LAYER 3 — RESPONSE INTELLIGENCE LAYER

Purpose: Decide how LoRa should respond.

Layer-3 answers:

“What kind of response is appropriate right now?”

⸻

4.1 CORE RULES FOR LAYER 3
	•	❌ No raw signal access
	•	❌ No recomputation of emotion
	•	✅ Strategy selection
	•	✅ Prompt construction
	•	✅ Safety & trust enforcement

⸻

4.2 CONVERSATION MODE SELECTOR

Modes:
	•	Companionship
	•	Emotional Crisis
	•	Problem Solving
	•	Creative Exploration
	•	Reflective Coaching

Selection Inputs:
	•	EIV
	•	Emotion Family
	•	Pressure
	•	Looping

⸻

4.3 REGULATORY STRATEGY SELECTOR

Strategies:
	•	Validation
	•	Reappraisal
	•	Attentional Redirection
	•	Suppression / De-escalation
	•	Meta-Attention Training

Rules:
	•	Active looping → Validation first
	•	High pressure → Cooling before reframe
	•	Embarrassment → Dignity restoration
	•	Anger → Agency restoration

⸻

4.4 PROMPT CONSTRUCTION PIPELINE
	1.	Inject EmotionalProfile (structured, non-prose)
	2.	Inject selected strategy instructions
	3.	Inject tone constraints
	4.	Append user message
	5.	Generate final LLM prompt

⸻

5. WHAT THIS ARCHITECTURE DELIBERATELY EXCLUDES (v1)
	•	Facial microexpressions
	•	Vocal prosody
	•	Automatic appraisal timing
	•	True physiological refractory periods
	•	ML-based emotion inference

These are future layers, not missing features.

⸻

6. FINAL ARCHITECTURAL CLAIM

LoRa v1 is not an emotion detector.

It is a:

Signal-grounded, narrative-aware, emotionally responsible conversational system.

Its strength is restraint, not overreach.

⸻

END OF DOCUMENT

---

