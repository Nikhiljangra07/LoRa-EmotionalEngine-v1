# LoRa Emotion Core — Full System Audit Blueprint

**Date:** 2026-02-25
**Scope:** emotion-core, appraisal-bridge, appraisal-lab (read-only), hint pipeline, prompt builder
**Methodology:** Static inventory + machine-checkable test pack (33 tests across 5 suites)
**Runtime changes:** NONE

---

## Executive Summary

| Subsystem | Verdict | Evidence |
|---|---|---|
| EIV Computation | **PASS** | `EIVAudit.test.ts` — bounded [0,1], monotonic, stable, flag-independent |
| ETV Engine | **PASS** | Static analysis — pure static methods, no bridge/flag deps |
| Appraisal Bridge Isolation | **PASS** | `LeakageAudit.test.ts` — 6 scenarios (300-step long-run), 0 forbidden keys |
| Intervention Policy Integration | **PASS** | `CoherenceAudit.test.ts` — all safety gates hold across 500 steps |
| Hint Pipeline Correctness | **PASS** | `PipelineOrderAudit.test.ts` — density cap, present-or-absent, guard monotonicity |
| Cross-Layer Coherence | **PASS** | `CoherenceAudit.test.ts` — no contradictions across 500 mixed-stress steps |
| Determinism | **PASS** | `DeterminismAudit.test.ts` — byte-identical prompts, stable payloads, golden hashes |
| Leakage Prevention | **PASS** | `LeakageAudit.test.ts` — no appraisal/policy objects in builder args or payloads |
| Safety Invariants | **PASS** | `CoherenceAudit.test.ts` — no tone whiplash, no escalation reinforcement, no HARD_STOP during STABILIZE |
| Observability Contract | **PASS** | `PipelineOrderAudit.test.ts` — present-or-absent only; no falsy/neutral string values |

**Red Flags:** NONE

---

## 1. Module-by-Module Map

### Layer A — Signal Extraction (emotion-core)

| Module | File | Responsibility | Forbidden Dependencies |
|---|---|---|---|
| InputProcessor | `processors/InputProcessor.ts` | Runs analyzers (valence, arousal, ES) on text | Must NOT import appraisal-bridge/lab |
| EIVComponentAssembler | `processors/EIVComponentAssembler.ts` | Maps analyzer outputs to EIV components | Must NOT import appraisal-bridge/lab |
| EIVScorer | `scorers/EIVScorer.ts` | Computes EIV from components | Must NOT import featureFlags |
| EIVComposer | `scorers/EIVComposer.ts` | Confidence-weighted base + ES gain | Must NOT import featureFlags |
| EmotionalStateInterpreter | `processors/EmotionalStateInterpreter.ts` | Derives arousal/valence + momentum | Must NOT import appraisal-bridge/lab |
| ETVEngine | `engines/ETVEngine.ts` | Updates Emotional Trust Value | Must NOT import appraisal-bridge/lab |

### Layer B — Appraisal Bridge

| Module | File | Responsibility | Forbidden Dependencies |
|---|---|---|---|
| mapLayerASnapshot | `appraisal-bridge/mapLayerASnapshot.ts` | Sanitizes + maps Layer A → snapshot | Must NOT import PromptTemplateBuilder |
| AppraisalBridgeRunner | `appraisal-bridge/AppraisalBridgeRunner.ts` | Orchestrates all appraisal-lab engines | Must NOT import emotion-core engines |
| mapAppraisalResult | `appraisal-bridge/mapAppraisalResult.ts` | Freezes raw outputs → AppraisalResult | Must NOT import emotion-core |
| types | `appraisal-bridge/types.ts` | Contract types (LayerASnapshot, AppraisalResult) | Type-only import from analysis.types |

### Layer C — Orchestration (EngineOrchestrator)

| Module | File | Responsibility | Forbidden Dependencies |
|---|---|---|---|
| EngineOrchestrator | `engines/EngineOrchestrator.ts` | Full pipeline: EIV → state → bridge → hints → prompt | Must NOT pass appraisal objects to builder |
| hintResolver | `engines/hintResolver.ts` | Priority trimming + density cap (pure) | No deps |
| hintStickiness | `engines/hintStickiness.ts` | Hysteresis for hint persistence (pure) | No deps |
| hintSemanticGuard | `engines/hintSemanticGuard.ts` | Cross-hint consistency enforcement (pure) | Imports ResolvableHints type only |

### Layer D — Prompt Construction

| Module | File | Responsibility | Forbidden Dependencies |
|---|---|---|---|
| PromptTemplateBuilder | `prompt/PromptTemplateBuilder.ts` | Builds prompt from state + primitive hints | Must NOT import appraisal-bridge/lab |
| momentumInitiative | `prompt/momentumInitiative.ts` | Momentum-based initiative check | Must NOT import appraisal-bridge/lab |

### Logging & Config

| Module | File | Responsibility |
|---|---|---|
| DecisionLogger | `logging/DecisionLogger.ts` | Structured decision payload logging |
| featureFlags | `config/featureFlags.ts` | Load-time env-based flag constants |
| master.constants | `config/master.constants.ts` | Centralized numeric constants |

---

## 2. Feature Flag Matrix

| Flag | Default | What It Gates |
|---|---|---|
| `LORA_APPRAISAL_BRIDGE` | OFF | AppraisalBridgeRunner instantiation |
| `LORA_APPRAISAL_BRIDGE_MODE` | OFF | Guidance mode override from appraisal |
| `LORA_APPRAISAL_PACING_HINT` | OFF | pacingHint computation |
| `LORA_VALIDATION_INTENSITY` | OFF | validationIntensity computation |
| `LORA_APPRAISAL_TONE_HINT` | OFF | toneHint computation |
| `LORA_ADAPTIVE_OVERRIDE_COOLDOWN` | OFF | Override cooldown (2-message suppress) |
| `LORA_DRIFT_MONITOR` | OFF | Drift detection + driftDetected payload |
| `LORA_STRICT_GUIDANCE_MODE` | OFF | Dev-only mode validation in builder |
| `LORA_INTERVENTION_VALIDATION_HINT` | OFF | validationHint from intervention policy |
| `LORA_INTERVENTION_PACING_HINT` | OFF | pacingHint fallback from intervention |
| `LORA_INTERVENTION_TONE_HINT` | OFF | toneHint fallback from intervention |
| `LORA_INTERVENTION_ACTION_HINT` | OFF | actionHint from intervention policy |
| `LORA_INTERVENTION_INTERRUPT_HINT` | OFF | interruptHint from intervention policy |
| `LORA_INTERVENTION_STEP_HINT` | OFF | stepHint from intervention policy |
| `LORA_INTERVENTION_QUESTION_BUDGET` | OFF | questionBudgetHint computation |
| `LORA_HINT_RESOLVER` | OFF | Priority trimming + density cap |
| `LORA_HINT_STICKINESS` | OFF | Hint hysteresis |
| `LORA_GUIDANCE_DWELL_LOCK` | OFF | Guidance mode dwell enforcement |
| `LORA_HINT_SEMANTIC_GUARD` | OFF | Cross-hint semantic consistency |

All flags are load-time constants (`Object.freeze`). No runtime toggling.

---

## 3. Hint Axis Catalog

| Hint | Type | Computed In | Gating Flags | Safety Rules | Overlay Marker |
|---|---|---|---|---|---|
| pacingHint | `'SLOW'` | EngineOrchestrator L293-317 | bridge+mode+pacing+horizon | STABILIZE/DE_ESCALATE forces SLOW | `[PACING_HINT:SLOW]` |
| toneHint | `'GENTLE' \| 'FIRM'` | EngineOrchestrator L369-412 | bridge+mode+tone+horizon | STABILIZE/DE_ESCALATE blocks FIRM | `[TONE_HINT:*]` |
| validationIntensity | `'MEDIUM' \| 'HIGH'` | EngineOrchestrator L353-367 | validationIntensity+horizon | LOW suppressed | `[VALIDATION_INTENSITY:*]` |
| validationHint | `'LIGHT' \| 'STRONG'` | EngineOrchestrator L420-445 | bridge+mode+interventionValidation+horizon | STABILIZE/DE_ESCALATE forces STRONG | `[VALIDATION_HINT:*]` |
| actionHint | `'ASK_ONE_QUESTION' \| 'OFFER_STEPS' \| 'ENCOURAGE_BREATH' \| 'SUGGEST_BREAK' \| 'NO_ACTION'` | EngineOrchestrator L457-495 | bridge+mode+interventionAction+horizon | STABILIZE blocks active hints | `[ACTION_HINT:*]` |
| interruptHint | `'SOFT' \| 'FIRM' \| 'HARD_STOP'` | EngineOrchestrator L479-510 | bridge+mode+interventionInterrupt+horizon | STABILIZE/DE_ESCALATE downgrades HARD_STOP | `[INTERRUPT_HINT:*]` |
| stepHint | `'ONE_STEP' \| 'TWO_STEPS'` | EngineOrchestrator L512-555 | bridge+mode+interventionStep+horizon | STABILIZE blocks; interrupt/SLOW/escalation blocks | `[STEP_HINT:*]` |
| questionBudgetHint | `'ZERO' \| 'ONE'` | EngineOrchestrator L555-565 | bridge+mode+interventionQuestionBudget+horizon | STABILIZE/interrupt forces ZERO | `[QUESTION_BUDGET:*]` |

All hints follow present-or-absent contract: `undefined` when neutral, never `'NONE'`/`'NORMAL'`.

---

## 4. Hint Pipeline Stages (Exact Code Path)

```
EngineOrchestrator.processMessage():

1. Raw hint computation (L293–L565)
   Each hint block gated by: featureFlags + messageCount >= 3 + appraisalResult exists

2. Hint pipeline block (L568–L631):
   L569: let currentHints = { guidanceMode, pacingHint, toneHint, ... }

   L582: if (hintResolverEnabled) currentHints = resolveHints(currentHints)
         → priority trimming + density cap ≤ 5

   L587: if (hintStickinessEnabled && messageCount >= 3)
         → applyHintStickiness(resolved, previous, holds, config)
         → holds: pacing:2, questionBudget:2, interrupt:2, tone:1, validation:1, action:1, validationIntensity:1, step:0

   L613: if (hintResolverEnabled) currentHints = resolveHints(currentHints)
         → re-enforce cap after stickiness

   L618: if (hintSemanticGuardEnabled) currentHints = enforceHintSemanticCoherence(currentHints)
         → cross-hint consistency (6 rules, never inflates)

   L622–L631: assign back to local variables

3. Build prompt (L633):
   PromptTemplateBuilder.build(emotionalState, etvState, { guidanceMode, ...hints })
   → Only primitive string hints passed; never appraisal objects
```

---

## 5. Safety Invariants (with Proving Tests)

| Invariant | Test File | Test Name |
|---|---|---|
| STABILIZE never with TONE_HINT:FIRM | CoherenceAudit.test.ts | "STABILIZE never with toneHint=FIRM" |
| DE_ESCALATE never with TONE_HINT:FIRM | CoherenceAudit.test.ts | "DE_ESCALATE never with toneHint=FIRM" |
| STABILIZE never with INTERRUPT_HINT:HARD_STOP | CoherenceAudit.test.ts | "STABILIZE never with interruptHint=HARD_STOP" |
| interruptHint ⇒ questionBudget ≠ ONE | CoherenceAudit.test.ts | "interruptHint present ⇒ questionBudgetHint not ONE" |
| SLOW pacing suppresses stepHint | CoherenceAudit.test.ts | "pacingHint=SLOW suppresses stepHint" |
| STABILIZE blocks unsafe actionHints | CoherenceAudit.test.ts | "STABILIZE blocks unsafe actionHints" |
| Marker density ≤ 5 (resolver ON) | CoherenceAudit.test.ts | "marker density ≤ 5 when resolver enabled" |
| Semantic guard never inflates | PipelineOrderAudit.test.ts | "never increases hint count" |
| Present-or-absent contract | PipelineOrderAudit.test.ts | "no hint has falsy string value" |
| No appraisal leakage to Layer D | LeakageAudit.test.ts | 6 scenario tests |
| Deterministic replay | DeterminismAudit.test.ts | "identical inputs produce identical prompts" |
| Golden hashes stable | DeterminismAudit.test.ts | "golden replay hashes unchanged" |
| EIV bounded [0,1] | EIVAudit.test.ts | "EIV is bounded [0, 1]" |
| EIV monotonic | EIVAudit.test.ts | "EIV is monotonic" |
| EIV flag-independent | EIVAudit.test.ts | "EIV does not depend on bridge/policy flags" |

---

## 6. Dependency Boundary Enforcement

### Verified Clean Boundaries

| Module | Must NOT Import | Verified |
|---|---|---|
| PromptTemplateBuilder | appraisal-bridge, appraisal-lab | YES — imports only emotion-core types/config |
| EIVScorer | featureFlags, appraisal-bridge | YES — imports only EIVComposer, eivTiers, mapEIVComponentsToInputs |
| EIVComposer | featureFlags, appraisal-bridge | YES — imports only MASTER_CONSTANTS |
| hintResolver | any runtime module | YES — zero imports |
| hintStickiness | any runtime module | YES — zero imports |
| hintSemanticGuard | any runtime module | YES — imports ResolvableHints type only |
| appraisal-bridge types | emotion-core engines | YES — imports EmotionalState type only |

---

## 7. Golden Replay Hashes

| Fixture | SHA-256 | Status |
|---|---|---|
| calm_baseline_50.json | `48225cb02b2b85c891ad515c5dfebe14363f27beaa472f853bd595413a4486ee` | UNCHANGED |
| escalation_burst_30.json | `7527ad065d2839d652b55e919f1a841b326f23a4b9b5de1b3307cbdf32bf850f` | UNCHANGED |
| oscillation_100.json | `12ad623e950e28f0cbaf726641e8345f5278164bb85fd7a39b6123f8cc85afb3` | UNCHANGED |
| recovery_80.json | `b1a665d175ad9d7d6bd7fd1707a9dd0e7765e35cdb9157ed7559c0272162c31e` | UNCHANGED |

---

## 8. What Remains to Verify

| Item | Status | Notes |
|---|---|---|
| ETV runtime path integration | NOT VERIFIED | ETVEngine is pure static; wiring in EngineOrchestrator uses it but ETV state is session-scoped. No test exercises ETV update path end-to-end through orchestrator in this audit. |
| LLM response generation | NOT VERIFIED | `generateLLMResponse` is mocked in all tests. Real LLM integration is out of scope. |
| Date.now in EIVScorer.calculate | NOTED | `EIVResult.timestamp` uses `Date.now()` (L32 of EIVScorer.ts). This does NOT affect EIV value computation but means `EIVResult` objects are not fully deterministic. The `value` field IS deterministic. |
| Production deployment flag state | NOT VERIFIED | All audit tests run with flags explicitly set. Actual production env var state is not auditable from code. |

---

## 9. Audit Test Pack Summary

| Suite | File | Tests | Runtime |
|---|---|---|---|
| Phase 1 — Leakage | `audit/__tests__/LeakageAudit.test.ts` | 6 | ~0.5s |
| Phase 2 — Determinism | `audit/__tests__/DeterminismAudit.test.ts` | 4 | ~0.5s |
| Phase 3 — EIV | `audit/__tests__/EIVAudit.test.ts` | 5 | ~0.1s |
| Phase 4 — Coherence | `audit/__tests__/CoherenceAudit.test.ts` | 10 | ~0.5s |
| Phase 5 — Pipeline | `audit/__tests__/PipelineOrderAudit.test.ts` | 8 | ~0.1s |
| **Total** | | **33** | **~2.1s** |

Command: `npx jest --no-coverage -- audit/`
