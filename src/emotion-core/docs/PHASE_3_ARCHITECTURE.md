# LoRa Emotion Core — Phase-3 Architecture Lock

This document is normative. Code must conform to it.

## Scope
- Applies to LoRa v1.x.
- Defines runtime behavior, system contracts, and test-enforced invariants.
- Future v2 paths are explicitly out of scope and listed only as deferred concepts.

## Layer-1 Definition
- Pure signal extraction only.
- No interpretation.
- No mutation.
- Deterministic for identical inputs.

## EIV Definition
- EIV = f(ES gain × base(|valence|, arousal)).
- Valence sign does not affect magnitude.
- ES cannot fabricate intensity.
- Direct component aggregation is explicitly disallowed in v1.

## Invariants As Law
- Bounds, determinism, Single Source of Truth, and Layer-1 purity are enforced.
- `EIVScorer.invariants.test.ts`: bounds, invalid component rejection, tier SSoT.
- `InputProcessor.invariants.test.ts`: immutability and centralized constants.
- `AmbiguityAnalyzer.invariants.test.ts`: Layer-1 purity (no intent/emotion leakage).
- `EngineOrchestrator.invariants.test.ts`: deterministic execution and safe session end.
- `EngineOrchestrator.llm.invariants.test.ts`: LLM isolation from emotional outcomes and bounded retries.

## Degradation Rules
- Driven by Layer-1 confidence only.
- No flat score access allowed.
- Thresholds are centralized and referenced from `MASTER_CONSTANTS` only.

## LLM Boundary
- LLM is downstream of emotion.
- LLM failure must not affect emotional state.
- Fallback is required behavior, not error recovery.

## Explicit Non-Goals
- No learning.
- No feedback loops.
- No adaptive semantics.
- No hidden state mutation.

## Forward Compatibility Note
- Component aggregation, interpretive intent inference, and adaptive semantics are deferred to v2 experimental paths.
