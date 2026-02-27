# LoRa -- Emotionally Adaptive AI

LoRa is an AI system that adapts its behavior based on the emotional state of the person it's talking to.

It is not a chatbot with a personality prompt. It is a multi-engine architecture with mathematically grounded models, persistent memory, and privacy-first design.

> This repository is in active development and not yet public. This README provides a high-level overview only.

---

## What LoRa Does

Most AI systems treat every conversation as stateless and emotionally flat. LoRa is designed to:

- Detect emotional signals from text across multiple analytical dimensions
- Build calibrated trust over time -- not from a single message, but from sustained interaction
- Remember emotional patterns across sessions without storing transcripts
- Adjust its response behavior (depth, directness, safety margins) based on earned trust
- Handle escalation, pressure, and emotional collapse with structured policies

---

## System Architecture

LoRa is composed of three major subsystems:

### Emotion Core

The central processing layer. Analyzes incoming messages across semantic, structural, temporal, behavioral, and content dimensions. Produces calibrated emotional signals that feed into all downstream systems.

Includes:
- Multi-layer analyzers (semantic, structural, temporal, behavioral, content)
- Emotional Trust Value (ETV) -- a per-user trust model with temporal decay and uncertainty-aware scoring
- Policy mapping from trust bands to behavioral knobs
- Prompt construction with memory-informed context injection

### Leaky Schema Memory

A persistent memory system grounded in cognitive science (Fuzzy-Trace Theory). Stores generalized emotional patterns -- not transcripts.

Includes:
- 21-dimensional emotion vector encoder with block weighting and L2 normalization
- Episodic buffer with salience-gated writes
- Schema store with EWMA consolidation and deterministic pruning
- Retrieval engine with softmax similarity and Retrieval-Induced Forgetting
- Anti-oscillation guards for schema dominance prevention
- Dual-database persistence: ChromaDB (emotional patterns) + FalkorDB (factual anchors)
- Privacy-first: no verbatim content stored, template-only fact summaries, GDPR-compliant unified purge

### Appraisal Lab

A suite of specialized engines that model specific emotional dynamics:

- **Pressure Engine** -- detects and responds to sustained emotional pressure
- **Escalation Engine** -- identifies escalation patterns and triggers safety policies
- **Collapse Engine** -- handles emotional collapse scenarios
- **Mood Engine** -- tracks mood trajectory across sessions
- **Family Engine** -- models relational dynamics in family-context conversations
- **Vector Pressure Engine** -- multi-dimensional pressure analysis
- **Time Engine** -- temporal pattern detection
- **Post-Clarity Engine** -- post-crisis stabilization
- **Intervention Policy Engine** -- governs when and how to intervene
- **Cross-Module Stability** -- ensures consistency across engines

---

## Research Foundations

LoRa's architecture draws from:

- **Fuzzy-Trace Theory** (Reyna & Brainerd) -- gist-based memory without verbatim storage
- **Appraisal Theory** (Scherer, Smith & Lazarus) -- structured emotional signal decomposition
- **Beta-Binomial models** -- uncertainty-aware trust estimation with temporal decay
- **RMSSD** -- emotional volatility measurement from signal processing

---

## Repository Metrics

| Metric | Count |
|--------|-------|
| Source files | 238 |
| Test files | 197 |
| Memory layer source lines | 3,800+ |
| Appraisal engines | 10 |
| Engineering blueprints | 8 |
| Audit reports | 10+ |

---

## Engineering Blueprints

The following design documents govern the system architecture:

- `ETV_V1_BLUEPRINT` -- Emotional Trust Value model specification
- `LEAKY_MEMORY_V2_BLUEPRINT` -- Full memory architecture with invariants
- `DUAL_DATABASE_PIPELINE_PLAN` -- ChromaDB + FalkorDB integration plan
- `PHASE2_CONTRACT_LOCK` -- Behavioral contract specifications
- `RUNBOOK_STABILITY` -- Operational stability guidelines

---

## Privacy

LoRa is designed as privacy-first:

- No transcripts or verbatim content are ever stored
- Emotional patterns are stored as irreversible numerical vectors
- Factual anchors use a closed ontology of template-based summaries -- no freeform text
- All user data can be fully purged via a single unified deletion entrypoint across all storage layers
- Designed with GDPR compliance as an architectural constraint, not an afterthought

---

## Status

In active development. Not yet available for public use.

---

## Author

Nikhil Jangra -- AI Architect

Designed and architected independently. Built with AI-assisted development.
