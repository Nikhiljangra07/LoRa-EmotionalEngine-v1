# Nikhil Jangra

Building **LoRa** — a privacy-first emotional intelligence layer for AI.

LoRa is not a chatbot. It's the decision engine that sits between users and LLMs — it decides *what* to say, *how much* to say, and *when to hold back*, before the language model ever sees the prompt.

---

### What I Built

**LoRa Emotional Engine v1** — a modular emotional state engine with dual-database memory, trust calibration, and behavioral continuity across sessions.

**Signal Pipeline**
- 7 real-time analyzers: valence, arousal, expression strength, emoji sentiment, capitalization pressure, punctuation dynamics, repetition detection
- Emotional State Interpreter with momentum tracking and dominant-emotion classification
- EIV (Emotional Intensity Value) scoring with per-message granularity

**Trust Calibration (ETV System)**
- Beta-with-decay model for longitudinal trust estimation
- Session-boundary updates with temporal decay on pseudo-counts
- AVI (Appraisal Volatility Index) — emotional instability scoring using RMSSD
- 5-band policy map gating LoRa's initiative, depth, and assertiveness
- Grounded in: Beta-Binomial inference, affect dynamics (Jahng et al., 2008)

**Appraisal Lab**
- Pressure Engine — 6-family vector pressure model with per-family decay
- Vector Dynamics — emotional trajectory and momentum computation
- Mood Engine — session-level mood dominance with confidence scoring

**Memory Layer (in design)**
- Dual-database architecture: ChromaDB (emotional patterns) + FalkorDB (factual context graph)
- 21-dimensional emotion vector encoding with block-weighted L2 normalization
- Schema consolidation via EWMA with retrieval-induced forgetting (RIF) and anti-oscillation guards
- Fact Anchor extraction with confidence scoring, quarantine mechanism, and relevance arbitration
- Privacy-first: no raw transcripts stored — only numeric patterns and structured extractions survive
- Grounded in: Fuzzy-Trace Theory (Reyna & Brainerd, 1995), Appraisal Theory (Scherer, 2001)

**Engineering Discipline**
- 1,170+ automated tests including architectural drift-prevention guards
- Formal engineering blueprints with peer-reviewed citations
- Feature-flagged rollouts — every new system integrates with zero disruption to existing functionality
- Runtime invariant contracts with dev-mode validation

---

### Stack

TypeScript · Node.js · Jest · ChromaDB · FalkorDB

---

### About

21, self-taught. Started LoRa with no technical background. 9 months later it has formal engineering specs that cite Reyna & Brainerd, Scherer, Anderson, Jahng, and Houben — and an architecture that hasn't broken once.

Not building another AI wrapper. Building the emotional cognition layer that doesn't exist yet.

---

### Contact

nikhiljangra051@gmail.com
