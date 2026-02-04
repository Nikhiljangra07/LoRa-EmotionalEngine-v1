This document is normative. Code must conform to it.

## Scope
- Phase-3 covers Layer-1 signal extraction, Layer-2 composition and semantics, and the EngineOrchestrator boundary.
- LLMs are non-authoritative and do not define system truth or outcomes.

## Core Principles (Design Law)
- Signal purity.
- Determinism.
- Single Source of Truth via `MASTER_CONSTANTS`.
- No interpretive leakage in Layer-1.
- Crash-early invariants over silent fallback.

## Layer Responsibilities
- Layer-1: Signal extraction only.
- Layer-2: Composition and semantics only.
- Orchestrator: Routing, degradation, and logging only.

## Invariants (MUST reference tests)
- `EIVScorer.invariants.test.ts`: Ensures EIV stays within [0,1], rejects invalid components, and enforces tiering via `getEIVTier`; prevents out-of-bounds math and tier drift.
- `InputProcessor.invariants.test.ts`: Ensures analyzer outputs are immutable and constants are centralized; prevents mutation and hardcoded configuration.
- `AmbiguityAnalyzer.invariants.test.ts`: Ensures Layer-1 ambiguity stays surface-marker only and excludes intent or emotion labels; prevents interpretive leakage.
- `EngineOrchestrator.invariants.test.ts`: Ensures deterministic outcomes, safe session termination, and bounded ETV; prevents nondeterminism and unsafe session handling.

## Degradation Contract
- Degradation is confidence-based and triggers when any Layer-1 confidence falls below the configured threshold in `MASTER_CONSTANTS.layer1.degradation.confidenceThreshold`.
- When degradation triggers, analyzer presence is suppressed to a conservative signal state for logging and routing; no new scores or meanings are inferred.

## What Phase-3 EXPLICITLY EXCLUDES
- Sarcasm.
- Intent inference.
- Relationship modeling.
- LLM correctness.

## Audit & Reproducibility
- Results are reproducible without OpenAI access because core scoring, tiering, and orchestration are deterministic and driven by local constants.
- The system can be peer-reviewed because boundaries, invariants, and constants are documented and enforced by tests.
