# LoRa V1 — Forensic Emotional Signal Trace Audit

**Type:** Pure diagnostic trace  
**Date:** 2026-02-25  
**Method:** Line-by-line code trace from signal origin to LLM prompt injection  
**Scope:** Every emotional signal from computation to ClaudeResponder

---

## PART 1 — SIGNAL ORIGIN TRACE

### 1.1 Appraisal Lab Outputs

**Pipeline:** 8 engines executed sequentially in `AppraisalBridgeRunner.step()`

| Engine | File | Function | Output Fields |
|--------|------|----------|---------------|
| Time Engine | `appraisal-lab/time-engine/` | internal | `deltaMessageSeconds`, `gainModifier` |
| Family Engine | `appraisal-lab/family-engine/family_classifier.ts` | `classifyFamily()` | `familyWeights: FamilyVector`, `dominantFamily: EkmanFamily`, `confidence` |
| Vector Pressure | `appraisal-lab/vector-pressure-engine/vector_pressure_engine.ts` | `updateVectorPressure()` | Per-family pressure scores |
| Pressure Engine | `appraisal-lab/pressure-engine/pressure_engine.ts` | `updatePressureState()` | `pressure` (scalar), `deltaPressure`, `slope`, `volatility`, `isShock` |
| Mood Engine | `appraisal-lab/mood-engine/mood_engine.ts` | `updateMoodState()` | `moodCategory`, `moodVector`, `moodDominance`, `moodConfidence` |
| Escalation Engine | `appraisal-lab/escalation-engine/escalation_engine.ts` | `updateEscalationState()` | `level` (0-3), `score` [0,1], `r`, `reasons`, `flags` |
| Collapse Engine | `appraisal-lab/collapse-engine/collapse_engine.ts` | `updateCollapseState()` | `collapseEvent`, `collapseSeverity` [0,1], `collapseDirection` |
| Post-Clarity Engine | `appraisal-lab/post-clarity-engine/post_clarity_engine.ts` | `updatePostClarityState()` | `postModeActive`, `agencyDeficit` [0,1], `isRelapse`, `recoveryPath` |
| Intervention Policy | `appraisal-lab/intervention-policy-engine/intervention_policy_engine.ts` | (policy derivation) | `pacingMode`, `toneMode`, `validationMode`, `actionMode`, `interruptionLevel` |

**Bridge output:** `AppraisalResult` via `AppraisalBridgeRunner.step()` (file: `appraisal-bridge/AppraisalBridgeRunner.ts`)

**Stored:** Local variable `appraisalResult` in `EngineOrchestrator.processMessage()` (line 308)

**Passed forward:** Yes — to hint pipeline (lines 456-695), guidance mode override (lines 426-446), memory encoder (lines 1625-1629), decision log (lines 1213-1227)

**Reaches prompt:** INDIRECT ONLY — via derived hints and guidanceMode, never as raw values

---

### 1.2 Ekman Emotion Family Classification

**File:** `appraisal-lab/family-engine/family_classifier.ts`  
**Function:** `classifyFamily(inputs: FamilyInputs): FamilyOutputs`

**Returned structure:**
```typescript
{
  familyWeights: { JOY, ANGER, FEAR, SADNESS, SURPRISE, DISGUST },  // normalized distribution
  dominantFamily: EkmanFamily,
  confidence: number,
  reasons: string[]
}
```

**Where stored:** Inside `AppraisalResult` (accessed as `appraisalResult.family.dominantFamily`, `appraisalResult.family.weights`)

**Passed forward:** To mood engine (drives mood category), to vector pressure engine (per-family pressure). NOT passed to EngineOrchestrator's prompt path.

**Reaches prompt:** **NO. COMPUTED BUT NOT APPLIED.**

The `EmotionalState.dominant` field in EngineOrchestrator (line 275) is hardcoded to `'NEUTRAL'`:
```typescript
const emotionalState: EmotionalState = emotionalStateOverride ?? {
  dominant: 'NEUTRAL',   // ← HARDCODED, Ekman family NEVER injected
  arousal: interpreted.arousal,
  valence: interpreted.valence,
  confidence: analyzerOutputs.valence.confidence,
};
```

The Ekman classification from the family engine exists only inside the appraisal bridge. It is never mapped to the `dominant` field. The `dominant` field exists in the `EmotionalState` type definition but is always `'NEUTRAL'` at runtime.

---

### 1.3 Escalation Pressure

**File:** `appraisal-lab/escalation-engine/escalation_engine.ts`  
**Function:** `updateEscalationState()`

**Returned structure:**
```typescript
{
  level: 0 | 1 | 2 | 3,   // CALM, RISING, ESCALATED, CRITICAL
  score: number,            // [0, 1]
  r: number,                // raw risk
  reasons: string[],
  flags: { warmedUp, isFlapping, enteredCritical }
}
```

**Where stored:** `appraisalResult.escalation` in EngineOrchestrator

**Passed forward:** Yes — to guidanceMode override (line 435-437), hint derivation (lines 467-468, 545-546, 668, 691-692), decision log (line 1217), memory encoder (line 1628)

**Reaches prompt:** INDIRECT — via `guidanceMode` when level >= 2 triggers `'DE_ESCALATE'`, which maps to the STABILIZE/DE_ESCALATE mode overlays and derived hints (pacingHint, toneHint, etc.)

---

### 1.4 Arousal / Valence Classification

**Valence:**  
**File:** `analyzers/content/ValenceAnalyzer.ts`  
**Function:** `ValenceAnalyzer.analyze(text: string): ValenceResult`  
**Output:** `{ valence: 'POSITIVE'|'NEGATIVE'|'NEUTRAL', score: [-1,1], confidence: [0,1], semanticScore: [-1,1] }`  
**Stored:** `analyzerOutputs.valence`  
**Reaches prompt:** YES — `emotionalState.valence` drives `mapEmotionToGuidance()` in PromptTemplateBuilder (line 311-312), which selects the RESPONSE PRINCIPLES emotional guidance text.

**Arousal:**  
**File:** `analyzers/content/ArousalAnalyzer.ts`  
**Function:** `ArousalAnalyzer.analyze(text: string): ArousalAnalysis`  
**Output:** `{ arousal: [0,1], confidence: [0,1], sources: ArousalSources[] }`  
**Stored:** `analyzerOutputs.arousal`  
**Reaches prompt:** YES — via EIV composition → `EmotionalStateInterpreter.classifyArousal(eiv)` → `emotionalState.arousal` → `mapEmotionToGuidance()` and `allowMomentumInitiative()`

---

### 1.5 AVI (Appraisal Volatility Index)

**File:** `scorers/AVIScorer.ts`  
**Function:** `AVIScorer.computeAVI(eivBuffer, windowSize?, saturation?): number`  
**Computation:** RMSSD of EIV values, normalized: `clamp(RMSSD / 0.5, 0, 1)`  
**Range:** [0, 1]

**Where stored:** `EngineOrchestrator.sessionAVIs[]` ring buffer (line 292)

**Passed forward:** To ETV V1 session summary → evidence score → ETV update (session-end only). Also to memory V1 encoder (line 1618).

**Reaches prompt:** **NO. COMPUTED BUT NOT APPLIED.**

AVI is never passed to `PromptTemplateBuilder.build()`. It influences ETV over multiple sessions (session-end summary), which in turn affects band classification and ETV policy. But AVI itself never appears in the prompt. It is a session-level ETV input, not a per-message prompt input.

---

### 1.6 EIV (Emotional Intensity Value)

**File:** `scorers/EIVScorer.ts`  
**Function:** `EIVScorer.calculate(components, enhanced?): EIVResult`  
**Composition (file `EIVComposer.ts`):**
- Legacy: `base(arousal, |valence|) × ES_gain`
- Enhanced (v1.1): `0.4×|semanticScore| + 0.35×arousalScore + 0.15×repetitionWeight + 0.10×capsWeight`

**Range:** [0, 1]

**Where stored:** `eivResult` local variable (line 270), pushed to `this.sessionEIVs[]` (line 282)

**Reaches prompt:** YES — through TWO paths:
1. **Direct:** Passed as `eiv: currentEiv` to `PromptTemplateBuilder.build()` (line 1061). Used for `classifyIntensity(eiv)` → `intensity` label in the RELATIONAL CONTEXT block and RSC intensity overlay.
2. **Indirect:** `eivResult.value` → `EmotionalStateInterpreter.classifyArousal(eiv)` → `emotionalState.arousal` → `mapEmotionToGuidance()` → RESPONSE PRINCIPLES text.

---

### 1.7 GuidanceMode

**File:** `engines/EngineOrchestrator.ts` (lines 383-451)  
**Not a separate module.** Computed inline with 4 layers of assignment:

**Layer 1 — Base classification (lines 383-392):**
```
high/extreme EIV OR HIGH arousal → ENERGY_MATCH
NEGATIVE valence + moderate EIV → STABILIZING
HIGH session volatility          → CONTAINMENT
else                             → CALM_NEUTRAL
```

**Layer 2 — Momentum override (lines 396-411):**
```
high arousalBias + high confidence → ENERGY_MATCH
negative valenceBias + high confidence → DE_ESCALATE
```

**Layer 3 — Appraisal override (lines 426-446, gated by `appraisalBridgeModeEnabled`):**
```
collapse event    → STABILIZE
escalation >= 2   → DE_ESCALATE
postClarity active → SUPPORTIVE_REFLECTION
```

**Layer 4 — Dwell lock (line 451):**
Prevents oscillation. Holds previous mode if dwell lock is active.

**Reaches prompt:** YES — passed as `guidanceMode` to `PromptTemplateBuilder.build()` (line 1040). Used for:
- `allowMomentumInitiative()` (line 154-167)
- `getGuidanceModeOverlay()` (line 176) — produces overlay text for STABILIZE and SUPPORTIVE_REFLECTION modes
- Strict mode validation (line 108-116)

**But:** `PromptTemplateBuilder.mapEmotionToGuidance()` does NOT use `guidanceMode`. It uses `emotionalState.arousal` and `emotionalState.valence` directly. The `guidanceMode` only affects `getGuidanceModeOverlay()` which fires only for `STABILIZE` and `SUPPORTIVE_REFLECTION`. All other modes (`CALM_NEUTRAL`, `ENERGY_MATCH`, `STABILIZING`, `CONTAINMENT`, `DE_ESCALATE`) produce **no overlay text** — the `default:` case returns `''`.

---

## PART 2 — PIPELINE FLOW MAPPING

### Full signal flow diagram

```
User Input (raw text)
    │
    ├──→ ValenceAnalyzer.analyze()     → { score, confidence, semanticScore }
    ├──→ ArousalAnalyzer.analyze()     → { arousal, confidence }
    ├──→ ExpressionStrengthScorer.compute() → { es, breakdown }
    │
    └──→ AnalyzerOutputs (combined)
              │
              ├──→ EIVComponentAssembler.assemble() → EIVComponents
              │         │
              │         └──→ EIVScorer.calculate() → EIVResult { value, tier }
              │                   │
              │                   ├──→ EmotionalStateInterpreter.interpret()
              │                   │         │
              │                   │         ├──→ classifyArousal(eiv) → 'LOW'|'MEDIUM'|'HIGH'
              │                   │         ├──→ classifyValence(outputs) → 'POSITIVE'|'NEGATIVE'|'NEUTRAL'
              │                   │         └──→ updateMomentum() → MomentumState
              │                   │
              │                   ├──→ sessionEIVs[] (ring buffer)
              │                   │         │
              │                   │         ├──→ AVIScorer.computeAVI() → avi  ── → sessionAVIs[]
              │                   │         │                                         ↓
              │                   │         │                              ETV session summary (session-end)
              │                   │         │
              │                   │         └──→ computeSessionVolatility() → { value, state }
              │                   │                   │
              │                   │                   └──→ guidanceMode (if state === 'HIGH' → 'CONTAINMENT')
              │                   │
              │                   └──→ passed to prompt: eiv (line 1061)
              │
              ├──→ AppraisalBridgeRunner.step(snapshot)
              │         │
              │         ├──→ Family Engine → familyWeights, dominantFamily  ── → ⚠️ DEAD END (not in prompt)
              │         ├──→ Pressure Engine → pressure, slope, volatility   ─┐
              │         ├──→ Mood Engine → moodCategory, moodDominance       ─┤── → hints only
              │         ├──→ Escalation Engine → level, score                ─┤
              │         ├──→ Collapse Engine → collapseEvent, severity       ─┤
              │         ├──→ Post-Clarity Engine → agencyDeficit             ─┤
              │         └──→ Intervention Policy → all modes/levels          ─┘
              │                                                                │
              │                                                                ├──→ guidanceMode override
              │                                                                ├──→ pacingHint
              │                                                                ├──→ toneHint
              │                                                                ├──→ validationHint
              │                                                                ├──→ actionHint
              │                                                                ├──→ interruptHint
              │                                                                ├──→ stepHint
              │                                                                └──→ questionBudgetHint
              │
              └──→ emotionalState { dominant:'NEUTRAL', arousal, valence, confidence }
                        │
                        └──→ PromptTemplateBuilder.build(emotionalState, etvState, options)
                                  │
                                  ├── emotionalState.arousal + valence → mapEmotionToGuidance() → RESPONSE PRINCIPLES text
                                  ├── eiv → classifyIntensity() → 'low'|'medium'|'high' → RELATIONAL CONTEXT label
                                  ├── guidanceMode → getGuidanceModeOverlay() → overlay (STABILIZE/SUPPORTIVE_REFLECTION only)
                                  ├── pacingHint → getPacingOverlay() → [PACING_HINT:SLOW/FAST]
                                  ├── toneHint → getToneOverlay() → [TONE_HINT:GENTLE/FIRM]
                                  ├── validationIntensity → getValidationOverlay() → [VALIDATION_INTENSITY:MEDIUM/HIGH]
                                  ├── validationHint → getValidationHintOverlay() → [VALIDATION_HINT:STRONG/LIGHT]
                                  ├── actionHint → getActionHintOverlay() → [ACTION_HINT:*]
                                  ├── interruptHint → getInterruptHintOverlay() → [INTERRUPT_HINT:*]
                                  ├── stepHint → getStepHintOverlay() → [STEP_HINT:*]
                                  ├── questionBudgetHint → getQuestionBudgetOverlay() → [QUESTION_BUDGET:*]
                                  ├── band → getBandBehaviorBlock() (fixed text, not dynamic)
                                  ├── narrativeMomentum → getNarrativeMomentumBlock()
                                  ├── responseShapeContract → getResponseShapeContractBlock()
                                  └── etvPolicy → renderConstraintOverlay() (if flag enabled)
                                           │
                                           └──→ System prompt string
                                                    │
                                                    └──→ ClaudeResponder.generateResponse(systemPrompt, userMessage)
                                                              │
                                                              └──→ messages: [{ role: 'system', ... }, { role: 'user', ... }]
```

### Per-stage field survival matrix

| Signal | Computed | Stored | Used in GuidanceMode | Used in Hints | Passed to Builder | Rendered in Prompt | Influences LLM |
|--------|----------|--------|---------------------|---------------|-------------------|--------------------|----------------|
| Valence score | ✅ | analyzerOutputs | ✅ (enhanced classification) | — | via emotionalState | ✅ (mapEmotionToGuidance) | ✅ |
| Valence label | ✅ | emotionalState.valence | ✅ | — | ✅ | ✅ | ✅ |
| Arousal score | ✅ | analyzerOutputs | ✅ (enhanced classification) | — | via EIV→arousal | ✅ (mapEmotionToGuidance) | ✅ |
| Arousal label | ✅ | emotionalState.arousal | ✅ | — | ✅ | ✅ | ✅ |
| Expression Strength | ✅ | analyzerOutputs | — | — | via EIV | ✅ (via EIV→arousal) | ✅ (indirect) |
| EIV value | ✅ | sessionEIVs[] | ✅ (tier classification) | ✅ (validationIntensity) | ✅ (eiv field) | ✅ (intensity label) | ✅ |
| EIV tier | ✅ | local variable | ✅ (primary driver) | — | — | — | ✅ (via guidanceMode) |
| AVI | ✅ | sessionAVIs[] | — | — | ❌ | ❌ | ❌ (session-end ETV only) |
| Session Volatility | ✅ | local variable | ✅ (HIGH→CONTAINMENT) | — | — | — | ✅ (via guidanceMode, but CONTAINMENT has no overlay) |
| Dominant Emotion (Ekman) | ✅ (in family engine) | appraisalResult | — | — | ❌ | ❌ | ❌ |
| EmotionalState.dominant | HARDCODED 'NEUTRAL' | emotionalState | — | — | ✅ (passed) | ❌ (not read by builder) | ❌ |
| Pressure scalar | ✅ | appraisalResult | — | ✅ (pacingHint) | — | ✅ (via pacingHint) | ✅ (indirect) |
| Pressure slope | ✅ | appraisalResult | — | — | — | — | ❌ (only in collapse/escalation math) |
| Pressure volatility | ✅ | appraisalResult | — | ✅ (pacingHint) | — | ✅ (via pacingHint) | ✅ (indirect) |
| Escalation level | ✅ | appraisalResult | ✅ (>=2→DE_ESCALATE) | ✅ (tone, step, qBudget) | — | ✅ (via guidanceMode + hints) | ✅ (indirect) |
| Escalation score | ✅ | appraisalResult | — | — | — | — | ❌ (logged only) |
| Collapse event | ✅ | appraisalResult | ✅ (→STABILIZE) | ✅ (pacingHint) | — | ✅ (via guidanceMode + hints) | ✅ (indirect) |
| Collapse severity | ✅ | appraisalResult | — | — | — | — | ❌ (logged only) |
| Mood category | ✅ | appraisalResult | — | — | — | — | ❌ |
| Mood dominance | ✅ | appraisalResult | — | — | — | — | ❌ |
| Agency deficit | ✅ | appraisalResult | — | — | — | — | ❌ |
| Post-clarity active | ✅ | appraisalResult | ✅ (→SUPPORTIVE_REFLECTION) | — | — | ✅ (via guidanceMode overlay) | ✅ (indirect) |
| Intervention modes | ✅ | appraisalResult | — | ✅ (all 7 hints) | — | ✅ (via hint overlays) | ✅ (indirect) |
| GuidanceMode | ✅ | local variable | — | — | ✅ | ✅ (STABILIZE/SUPPORTIVE_REFLECTION overlay only) | ✅ (partial — see note below) |
| Momentum | ✅ | interpreter.momentum | ✅ (override) | — | ✅ (confidence) | ✅ (initiative guidance) | ✅ |

---

## PART 3 — PROMPT INJECTION VERIFICATION

### 3.1 Where does guidanceMode alter prompt text?

**Two places only:**

1. **`allowMomentumInitiative()` (line 154-167):** If the function returns `true`, adds:
   `"- You may use light, anticipatory phrasing to show shared engagement"`
   This requires specific guidanceMode + momentum + valence + arousal conditions to be true.

2. **`getGuidanceModeOverlay()` (line 393-416):** Only fires for two modes:
   - `'STABILIZE'` → 4 lines of grounding guidance
   - `'SUPPORTIVE_REFLECTION'` → 4 lines of reflective guidance
   - **All other modes return `''` (empty string)**

**Critical finding:** `CALM_NEUTRAL`, `ENERGY_MATCH`, `STABILIZING`, `CONTAINMENT`, and `DE_ESCALATE` produce **zero overlay text** from `getGuidanceModeOverlay()`. These five modes affect the prompt ONLY through the hints they trigger (if appraisal flags are enabled).

### 3.2 Do Ekman families influence the prompt?

**NO. COMPUTED BUT NOT APPLIED.**

The family engine computes `dominantFamily` (JOY, ANGER, FEAR, etc.) inside the appraisal bridge. This value:
- Is never extracted from `appraisalResult` in the orchestrator
- Is never passed to `PromptTemplateBuilder`
- `EmotionalState.dominant` is hardcoded to `'NEUTRAL'` (line 275)
- The prompt builder never reads `emotionalState.dominant`

### 3.3 Does escalation pressure influence tone instructions?

**YES, but INDIRECTLY only, via 3 mechanisms:**

1. `escalation.level >= 2` → `guidanceMode = 'DE_ESCALATE'` → but DE_ESCALATE has no overlay (returns `''`)
2. `escalation.level >= 2` → `toneHint = 'GENTLE'` → renders `[TONE_HINT:GENTLE]` in prompt
3. `escalation.level >= 2` → `questionBudgetHint = 'ZERO'` → renders `[QUESTION_BUDGET:ZERO]` in prompt

All require `appraisalBridgeModeEnabled` + respective intervention hint flags to be enabled.

### 3.4 Does AVI influence instructions?

**NO. COMPUTED BUT NOT APPLIED.**

AVI is computed per-message, stored in `sessionAVIs[]`, and used ONLY in:
- ETV V1 session summary (session-end, via `buildSessionSummary`)
- Memory V1 encoder input (as `avi` dimension in emotion vector)
- Decision logging

It is never passed to `PromptTemplateBuilder`. It never appears in prompt text. It never influences any hint or guidanceMode.

### 3.5 Does volatility influence instructions?

**Partially. Through two different signals:**

1. **Session Volatility** (`computeSessionVolatility`): If `state === 'HIGH'`, sets `guidanceMode = 'CONTAINMENT'`. But `CONTAINMENT` produces no overlay text from `getGuidanceModeOverlay()` (falls through to `default: return ''`). So session volatility sets a mode that **has no prompt effect** unless hint flags also fire.

2. **Pressure Volatility** (from pressure engine): If `appraisalResult.pressure.volatility >= 1.2`, triggers `pacingHint = 'SLOW'`. This produces `[PACING_HINT:SLOW]` in the prompt. **This is the only path where volatility reaches the prompt.**

### 3.6 Does emotional classification influence system-level framing?

**YES — arousal and valence, NO — everything else.**

`mapEmotionToGuidance(emotionalState)` (lines 300-383 in builder) selects one of 7 guidance text blocks based on the `arousal × valence` matrix:

| Arousal | Valence | Guidance Text |
|---------|---------|---------------|
| LOW | NEGATIVE | "Acknowledge difficulty briefly, offer concrete step..." |
| LOW | NEUTRAL/POSITIVE | "Calm, neutral tone, invite context..." |
| MEDIUM | POSITIVE | "Warm and friendly, match energy..." |
| MEDIUM | NEGATIVE | "Validate experience, maintain calm..." |
| HIGH | POSITIVE | "Match enthusiasm, stay grounded..." |
| HIGH | NEGATIVE | "Stay grounded, validate strongly but calmly..." |
| (fallback) | — | "Respond calmly and naturally..." |

This is the ONLY place where raw emotional state influences the system-level response framing. EIV tier, Ekman family, AVI, escalation score, mood category, collapse severity, and agency deficit do NOT influence this selection.

---

## PART 4 — BEHAVIORAL IMPACT TEST

### If we disable EIV:

**Prompt CHANGES:**

1. `classifyIntensity(eiv)` defaults to `classifyIntensity(0)` → always `'low'`. The RELATIONAL CONTEXT block would always show `Emotional intensity (current turn): low`.

2. `EmotionalStateInterpreter.classifyArousal(eiv)` → always `'LOW'`. The `mapEmotionToGuidance()` selection would only ever choose LOW×POSITIVE, LOW×NEGATIVE, or LOW×NEUTRAL guidance.

3. `guidanceMode` base classification: `eivTier` would always be `'minimal'`, so ENERGY_MATCH could never fire from EIV alone. Would always fall through to CALM_NEUTRAL (unless session volatility or momentum override).

4. `validationIntensity` would never reach MEDIUM or HIGH thresholds.

5. RSC intensity overlay would always show "Intensity is low" or empty.

**Diff example (MEDIUM arousal, NEGATIVE valence input → with EIV disabled):**
```diff
 RELATIONAL CONTEXT
-Emotional intensity (current turn): medium
+Emotional intensity (current turn): low

 RESPONSE PRINCIPLES
-- Validate the user's experience clearly
-- Maintain calm support
-- Avoid minimizing or escalating
+- Maintain a calm, neutral tone
+- Invite the user to share more context
+- Avoid overwhelming guidance
+- Keep it natural

-[VALIDATION_INTENSITY:MEDIUM]
-- Acknowledge the user's feelings clearly before responding to content.
+(no validation overlay)

 RESPONSE SHAPE CONTRACT
-Intensity is low — match the calm. Do not inject urgency.
+(same — defaults to low)
```

**Verdict:** EIV removal causes visible prompt change. **EIV is structurally active.**

---

### If we disable AVI:

**Prompt DOES NOT CHANGE.**

AVI is never passed to `PromptTemplateBuilder.build()`. No prompt text depends on AVI. Removing AVI would:
- Remove values from `sessionAVIs[]` buffer
- Remove AVI from ETV session summary (session-end, affects next-session ETV, which affects band over time)
- Remove AVI from memory V1 encoder input

**Verdict:** AVI has ZERO per-message prompt influence. It has a slow, indirect, multi-session effect through ETV. **AVI is structurally dormant for per-message behavior.**

---

### If we disable Appraisal Lab (entire bridge):

**Prompt changes ONLY if appraisal-driven hints were active.**

With `appraisalBridgeEnabled = false`:
- `appraisalResult` is `undefined`
- Guidance mode override (lines 426-446) never fires → no STABILIZE, DE_ESCALATE (from escalation), or SUPPORTIVE_REFLECTION override
- ALL 7 hint variables remain `undefined`:
  - No `[PACING_HINT:SLOW]`
  - No `[TONE_HINT:GENTLE]` or `[TONE_HINT:FIRM]`
  - No `[VALIDATION_HINT:STRONG]` or `[VALIDATION_HINT:LIGHT]`
  - No `[ACTION_HINT:*]`
  - No `[INTERRUPT_HINT:*]`
  - No `[STEP_HINT:*]`
  - No `[QUESTION_BUDGET:ZERO]` or `[QUESTION_BUDGET:ONE]`
- No guidance mode overlay for STABILIZE or SUPPORTIVE_REFLECTION
- Memory V1 encoder loses enhanced dimensions (pressureScalar, pressureSlope, pressureVolatility, moodDominance, escalationScore, collapseSeverity, agencyDeficit)

**Diff example (escalated user with collapse → with Appraisal Lab disabled):**
```diff
 RESPONSE PRINCIPLES
 ...
-(guidanceMode overlay for STABILIZE):
-- Prioritize emotional grounding and stability
-- Use simple, clear language
-- Avoid probing or challenging the user
-- Default to a calm, steady presence
+(no overlay — guidanceMode falls to base classification)

 BAND CALIBRATION
 ...
-[PACING_HINT:SLOW]
-- Pacing: slow down. Use shorter sentences. Pause between ideas.
-[TONE_HINT:GENTLE]
-- Soften wording. Avoid confrontational phrasing.
-[VALIDATION_HINT:STRONG]
-- Provide clear emotional reassurance.
-[QUESTION_BUDGET:ZERO]
-- Ask zero questions. Use statements, reflections, and grounding.
+(none of these overlays present)
```

**Verdict:** Appraisal Lab removal causes visible prompt changes in escalated/collapsed scenarios. **Appraisal Lab is structurally active for crisis states. Structurally inert for calm/neutral states** (all hints stay `undefined` when no escalation/collapse/intervention triggers).

---

### If we disable Escalation Pressure (specifically):

**Prompt changes only in escalated scenarios:**

Without escalation data:
- `guidanceMode` never receives the `DE_ESCALATE` appraisal override (line 435-437)
- `toneHint` never receives escalation-driven `'GENTLE'` (line 545-546)
- `stepHint` never receives escalation suppression (line 668)
- `questionBudgetHint` never receives escalation-driven `'ZERO'` (line 691-692)

In calm conversations, escalation level is 0, so removing it changes nothing.

**Verdict:** Escalation pressure is active only in elevated states. **Dormant during normal conversation.**

---

## PART 5 — SUMMARY VERDICT

### 1. Modules that ACTIVELY influence output

| Module | Path to LLM | Condition |
|--------|-------------|-----------|
| **ValenceAnalyzer** | → `emotionalState.valence` → `mapEmotionToGuidance()` → RESPONSE PRINCIPLES text | Always active |
| **ArousalAnalyzer** | → via EIV → `emotionalState.arousal` → `mapEmotionToGuidance()` → RESPONSE PRINCIPLES text | Always active |
| **ExpressionStrengthScorer** | → via EIV composition → arousal classification | Always active (indirect) |
| **EIV** | → intensity label in RELATIONAL CONTEXT; → arousal classification; → validationIntensity overlay; → guidanceMode base; → RSC intensity overlay | Always active |
| **GuidanceMode** | → STABILIZE/SUPPORTIVE_REFLECTION overlay; → initiative guidance | Active for those two modes only |
| **Appraisal-driven hints** (pacing, tone, validation, action, interrupt, step, question budget) | → `[HINT:VALUE]` overlay blocks in prompt | Active only during escalation/collapse/intervention triggers |
| **NarrativeStateEngine** | → NARRATIVE MOMENTUM block (theme, trajectory, phase, strategy) | Always active (when flag enabled) |
| **ResponseShapeContract** | → RESPONSE SHAPE CONTRACT block (structural guidance) | Always active (when flag enabled) |
| **Momentum** | → initiative guidance; → guidanceMode override | Active when confidence exceeds threshold |

### 2. Modules that are DORMANT

| Module | Reason | Impact |
|--------|--------|--------|
| **AVI** | Never passed to prompt builder. Only affects ETV session summary at session end. | Zero per-message prompt influence |
| **Session Volatility** | Sets `guidanceMode = 'CONTAINMENT'` but CONTAINMENT has no overlay text. Falls through to `default: return ''` | Mode is set but prompt text is unchanged |
| **Escalation Score** (the numeric `score` vs `level`) | Only `level` (integer 0-3) is used for thresholds. The floating-point `score` is logged but never drives behavior. | Zero prompt influence |
| **Collapse Severity** | Only `collapseEvent` (boolean) drives guidanceMode. `collapseSeverity` (float) is logged but never used. | Zero prompt influence |
| **Mood Category / Mood Dominance** | Computed in mood engine. Never extracted from `appraisalResult` in orchestrator. Never passed to builder. | Zero prompt influence |
| **Agency Deficit** | Computed in post-clarity engine. Never drives hints or guidanceMode (only `postClarity.active` does). | Zero prompt influence |
| **Pressure Slope** | Used internally for escalation/collapse math. Never directly influences any hint or mode. | Zero direct prompt influence |

### 3. Modules that are DECORATIVE

| Module | Reason |
|--------|--------|
| **Ekman Family Classification** | Computed in `family_classifier.ts`. Lives inside appraisal bridge. Never mapped to `EmotionalState.dominant`. `dominant` is hardcoded `'NEUTRAL'`. The builder never reads `dominant`. The entire family engine output is dead weight for prompt generation. |
| **EmotionalState.dominant field** | Type definition allows JOY/SADNESS/ANGER/FEAR/CONTENTMENT/NEUTRAL. Runtime always produces NEUTRAL. Builder never inspects it. It exists only in the type contract and memory encoder. |
| **EmotionalProfile type** (analysis.types.ts) | Explicitly documented as "NOT wired into v1 runtime. Wiring is deferred to v1.1+." Pure type contract with zero runtime usage. |
| **GuidanceMode 'CONTAINMENT'** | Can be set by session volatility. But `getGuidanceModeOverlay('CONTAINMENT')` returns `''`. No hint is triggered by CONTAINMENT specifically. The mode is assigned, passed to the builder, and produces nothing. |
| **GuidanceMode 'STABILIZING'** | Same issue. `getGuidanceModeOverlay('STABILIZING')` returns `''`. No overlay. No hint triggered by this mode name specifically. |
| **GuidanceMode 'ENERGY_MATCH'** | Same issue. `getGuidanceModeOverlay('ENERGY_MATCH')` returns `''`. No overlay. Prompt text is identical whether CALM_NEUTRAL or ENERGY_MATCH. |

### 4. Where the pipeline loses emotional data

| Loss Point | Signal Lost | Reason |
|------------|-------------|--------|
| **Line 275 — `dominant: 'NEUTRAL'`** | Ekman family classification | Hardcoded instead of wired from family engine or interpreter |
| **`getGuidanceModeOverlay()` default case** | CALM_NEUTRAL, ENERGY_MATCH, STABILIZING, CONTAINMENT, DE_ESCALATE | 5 of 7 modes return empty string — mode is computed but produces no text |
| **Builder options — no AVI field** | AVI value | Never included in the options passed to `build()` |
| **Builder options — no escalation field** | Escalation level/score raw values | Only indirect via hints |
| **Builder options — no mood field** | Mood category, mood dominance | Never included |
| **Builder options — no pressure field** | Pressure scalar, slope, volatility raw values | Only indirect via hints |
| **Builder options — no collapse field** | Collapse severity | Only collapse event affects guidanceMode boolean |
| **Builder options — no agency field** | Agency deficit | Never included |

### 5. Minimal structural changes to make architecture visibly influence behavior

These are observations, not recommendations (per audit constraints):

1. **Wire `dominantFamily` → `EmotionalState.dominant`:** The family engine already computes this. One mapping line in `EngineOrchestrator` (line 275) would replace `'NEUTRAL'` with the actual Ekman classification. The prompt builder would then need to consume `dominant` in `mapEmotionToGuidance()` or the RELATIONAL CONTEXT block.

2. **Add overlay text for ENERGY_MATCH, CONTAINMENT, STABILIZING, DE_ESCALATE modes:** Currently 5 of 7 guidance modes produce zero prompt text. Adding 3-4 lines per mode in `getGuidanceModeOverlay()` would make the guidanceMode computation structurally meaningful for all states, not just crisis states.

3. **Pass AVI to prompt builder as a volatility indicator:** AVI is already computed per-message. Adding it to the RELATIONAL CONTEXT block (e.g., "Emotional volatility: high/low") would give the LLM a stability signal.

4. **Pass escalation level directly to prompt:** Instead of relying solely on hints (which require multiple feature flags to be enabled), injecting `escalation: RISING/ESCALATED/CRITICAL` into the RELATIONAL CONTEXT block would give the LLM direct awareness of conversational pressure.

---

## FINAL STATUS MATRIX

```
Signal                    Status
─────────────────────────────────────
Valence (label)           ✅ ACTIVE — drives guidance text
Arousal (label)           ✅ ACTIVE — drives guidance text
EIV (value)               ✅ ACTIVE — drives intensity, arousal, validation overlay
EIV (tier)                ✅ ACTIVE — drives guidanceMode base
GuidanceMode              ⚠️ PARTIAL — only STABILIZE + SUPPORTIVE_REFLECTION produce text
Momentum                  ✅ ACTIVE — drives initiative + guidanceMode override
NarrativeStateEngine      ✅ ACTIVE — drives NARRATIVE MOMENTUM block
ResponseShapeContract     ✅ ACTIVE — drives RESPONSE SHAPE CONTRACT block
Appraisal hints (7)       ⚠️ CONDITIONAL — active only during crisis/intervention
Pressure scalar           ⚠️ CONDITIONAL — active only via pacingHint threshold
Pressure volatility       ⚠️ CONDITIONAL — active only via pacingHint threshold
Escalation level          ⚠️ CONDITIONAL — active via guidanceMode + hints during escalation
Collapse event            ⚠️ CONDITIONAL — active via guidanceMode during collapse
Post-clarity active       ⚠️ CONDITIONAL — active via SUPPORTIVE_REFLECTION mode
Session volatility        ❌ DORMANT — sets CONTAINMENT mode that produces no text
AVI                       ❌ DORMANT — computed, never reaches prompt
Ekman families            ❌ DECORATIVE — computed in bridge, never mapped to prompt
Dominant emotion          ❌ DECORATIVE — hardcoded 'NEUTRAL', builder ignores it
Mood category             ❌ DECORATIVE — computed, never extracted
Mood dominance            ❌ DECORATIVE — computed, never extracted
Escalation score (float)  ❌ DECORATIVE — logged only
Collapse severity (float) ❌ DECORATIVE — logged only
Agency deficit            ❌ DECORATIVE — computed, never in prompt
Pressure slope            ❌ DECORATIVE — internal math only
```

**End of audit.**
