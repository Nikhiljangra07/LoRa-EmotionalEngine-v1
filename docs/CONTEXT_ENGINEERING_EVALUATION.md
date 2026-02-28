# Context Engineering Reality Check

**Type:** Pre-implementation architectural evaluation against live codebase  
**Date:** 2026-02-25  
**Scope:** Full pipeline trace from UI input to LLM output  
**Method:** Read every file in the chain, traced actual data flow, reconstructed actual prompt text

---

## A) Current Architectural Diagnosis (Based on Repo Scan)

### What LoRa actually sends to the LLM

The entire system reduces to a single string passed to `client.responses.create({ input: prompt })`. No system/user role separation. One concatenated blob. Here is what it actually looks like for a new user in Band B0:

```
You are LoRa, an emotionally aware AI companion.

CURRENT CONTEXT
---------------
Relationship Style:
- Professional — polite, calm, and respectful

RESPONSE GUIDELINES
------------------
- Maintain a calm, neutral tone
- Invite the user to share more context
- Avoid overwhelming guidance
- Keep it natural

BEHAVIOR MODULATION
-------------------
Band B0 — Neutral
- Neutral, structured, concise.
- No warmth or softeners.
- No decorative symbols or pictographs.
- No validation statements.
- Keep responses short and factual.

GLOBAL CONSTRAINTS
------------------
- Do NOT mention emotions, analysis, scores, or internal signals
- Do NOT explain your reasoning
- Respond naturally and conversationally
- Do not escalate intensity unless the user does
- Avoid cheerfulness when the user signals negativity
- Keep a professional baseline when needed
- If uncertain, default to calm, warm presence
- Never claim to recall or reference having been told something
- Never use possessive framing about the relationship
- Never use dependency or manipulation language
[ETV_POLICY_CONSTRAINTS]
- Relationship: Professional — polite, calm, and respectful
- Guidance: Conservative — prefer clarification over assertion. Minimal assumptions.
- Initiative: LOW — do not make unsolicited assumptions or proactive suggestions
- Depth: SHALLOW — avoid deep emotional inference or extended analysis
- Prefer asking clarifying questions over making assertions
- Tone: gentle and non-directive
- Do NOT use intimacy cues, dependency language, or bonding phrases

USER MESSAGE:
I've been feeling really overwhelmed lately with everything going on.
```

That is what the LLM receives. No memory context. No anchors. No bootstrap (first session). No session history (first message).

**Count the prohibitions:** 17 separate "do not / never / avoid / no" directives. The LLM receives one vague positive instruction ("respond naturally") and seventeen negative constraints.

### What exists vs. what the research report proposes

| Research Proposal | LoRa Equivalent | Gap? |
|---|---|---|
| SIB (Surface Interaction Buffer) | `sessionHistory` (last 8 turns, 500 char cap) | **No gap.** Exists, works. |
| TGW (Task-Goal Workspace) | Nothing | **Critical gap.** LoRa has zero concept of what the current conversation is about or what it should accomplish this turn. |
| ISL (Interaction Schema Layer) | `guidanceMode` (CALM_NEUTRAL, VALIDATING, etc.) | **Partial gap.** `guidanceMode` classifies the mode but does not track conversation type, stage, or arc. It's a per-message classification, not a session-level narrative schema. |
| RAS (Relational/Affective State) | ETV + EIV + band + relational intent | **No gap.** Well-implemented. |
| LTS (Long-Term Store) | Chroma (schemas) + Falkor (anchors) + JSON | **No gap.** Well-implemented. |
| PBWM Gating Controller | Band gating + feature flags + policy map | **Partial gap.** Gating exists but is static per-band, not adaptive per-turn. No central controller weighs what to include based on turn-level relevance. |
| Predictive Error / Active Inference | Nothing | **Gap, but not critical for V1.** This is the academic part. |
| Metacognitive Monitor | Nothing | **Gap, but not critical for V1.** |
| Relevance Realization | `scoreAnchors()` + `retrieveSchemas()` + cosine similarity | **Partial.** Scoring exists but operates independently per store. No cross-module arbitration. |

---

## B) Real Root Cause of Generic Tone

The generic-bot problem has **five concrete causes**, ranked by impact. None of them are "missing a context arbitration layer."

### Cause 1: The prompt is a behavioral straitjacket (HIGHEST IMPACT)

The prompt tells the LLM **what not to do** seventeen times and gives it almost zero positive conversational direction. Look at Band B0-B1:

- "Neutral, structured, concise."
- "No warmth or softeners."
- "No validation statements."
- "Keep responses short and factual."
- "Initiative: LOW — do not make unsolicited assumptions."
- "Depth: SHALLOW — avoid deep emotional inference."

**You are literally instructing the LLM to be a helpdesk bot.** This is not a retrieval problem. This is not a gating problem. This is a prompt construction problem. The constraints are so dominant that the LLM's only safe response is generic, short, and flat.

### Cause 2: No conversational goal-setting (HIGH IMPACT)

The prompt never answers: *"What should LoRa accomplish in this turn?"*

A human therapist thinks: "Right now my goal is to help them feel heard, then gently explore what's driving the overwhelm." LoRa's prompt says: "Maintain a calm, neutral tone. Invite the user to share more context." That is a behavioral instruction, not a conversational goal. The LLM has no north star for the exchange.

### Cause 3: No narrative arc tracking (HIGH IMPACT)

The session context block dumps up to 8 raw turns:

```
User: I've been feeling really overwhelmed
LoRa: That sounds difficult. What's been going on?
User: Just work stuff and my relationship
LoRa: That's a lot to carry. Which feels most pressing?
```

But there is no summarization of *where the conversation is going*. No "we started discussing work stress, pivoted to relationship concerns, the user seems to want validation more than advice." The LLM sees turns but has no understanding of conversational trajectory.

### Cause 4: Memory context is categorical metadata, not narrative (MEDIUM IMPACT)

When schemas ARE injected (B2+), they look like this:

```
MEMORY CONTEXT (privacy-safe, categorical)
-------------------------------------------
- confidence: MED
- topSchemas:
  - [schema_0] trajectory=calm-stable tendency=responds-to-validation relevance=HIGH
```

The LLM receives `trajectory=calm-stable` and `tendency=responds-to-validation`. These are classification labels, not conversational fuel. The LLM cannot build continuity from "responds-to-validation." It needs something like: "This user tends to open up about work stress and responds well when their feelings are named directly."

### Cause 5: Band B0-B1 suppresses everything for 3-5 sessions (MEDIUM IMPACT)

A new user is in B0/B1 for 3-5 sessions. During that time:
- Zero anchors in prompt (`bandLimit = 0`)
- Zero schemas in prompt (`maxSchemasInPrompt = 0, allowPromptInjection = false`)
- "Professional" relationship style
- Low initiative, shallow depth
- Bootstrap context only appears if structured memory is empty (which it always is at B0, so bootstrap DOES help here)

This means the first 3-5 sessions are deliberately impersonal. The system is designed to be generic until trust is earned. This is an intentional design choice that directly creates the reported problem.

---

## C) What Context Engineering Would Actually Fix

If implemented well, a context arbitration layer would address **Causes 2 and 3**, and partially address **Cause 4**.

### It would fix: Missing conversational goal-setting

A TGW (Task-Goal Workspace) that tracks "the user's current goal is: process overwhelm about work + relationship" and "LoRa's current strategy is: validate first, then explore the most pressing concern" would give the prompt a north star. This is the single most valuable idea in the research report.

### It would fix: Missing narrative arc

An ISL (Interaction Schema Layer) that tracks "this is an emotional support conversation, we're in the exploration phase, the user has shared two concerns but hasn't gone deep on either" would provide the conversational trajectory that the raw session history cannot.

### It would partially fix: Memory context is too abstract

A relevance controller that converts schema metadata into contextual narrative fragments before injection would make memory useful. Instead of `trajectory=calm-stable`, the prompt could receive: "This user's pattern is calm and steady. They respond well to direct validation."

---

## D) What Context Engineering Would NOT Fix

### It would NOT fix: Prompt constraint density (Cause 1)

The prompt is 17+ prohibitions and 3-4 vague positive instructions. No amount of context arbitration changes this ratio. You need to rewrite the prompt itself -- fewer constraints, more positive behavioral direction, a conversational character voice, and actual examples of desired responses.

### It would NOT fix: Band B0-B1 coldness (Cause 5)

Band gating is an ETV policy decision. Context engineering operates downstream of it. If the policy says "no warmth, no softeners, short and factual," the LLM will comply regardless of what context you inject.

### It would NOT fix: LLM call format

Sending everything as a single `input` string to `client.responses.create()` means no system/user role separation. The model treats the entire blob as one input. A proper system message / user message separation would improve instruction adherence.

### It would NOT fix: Temperature / token cap conservatism

`temperature: 0.6` and `max_output_tokens: 400` are hardcoded in `OpenAIResponder`. These cap expressiveness and length. Context engineering doesn't change generation parameters.

### It would NOT fix: Extraction quality

The fact extractor's closed ontology (25 slots), no negation handling ("I don't want to exercise" → `goal_active: exercise`), and binary preference collapse are extraction problems, not context arbitration problems.

---

## E) Minimal Viable Version of Context Arbitration for This Repo

If you want the most value for the least complexity, do NOT build the full 5-layer PBWM architecture from the research report. Build these three things:

### E.1: Conversation Goal Tracker (replaces TGW)

A lightweight module that runs per-message and maintains:

```typescript
interface ConversationGoal {
  userGoal: string;        // "process overwhelm about work"
  loraStrategy: string;    // "validate, then explore most pressing concern"
  phase: 'opening' | 'exploring' | 'deepening' | 'closing';
  turnsSincePhaseChange: number;
}
```

This is derived deterministically from: the last 4 turns, the detected emotional state, the guidance mode, and whether the user asked a question vs. made a statement.

Injected into the prompt as:

```
CONVERSATION DIRECTION
- User's current focus: processing overwhelm about work and relationship
- Your approach: validate their feelings, then help them identify what feels most pressing
- Phase: exploring (turn 3)
```

**This alone would eliminate the "generic helpdesk" feel** because the LLM now has a goal.

### E.2: Narrative Memory Translator (replaces raw schema labels)

A function that converts categorical schema metadata into natural-language contextual hints:

```typescript
function translateSchemaToNarrative(schema: SchemaDisplay): string {
  // trajectory=calm-stable + tendency=responds-to-validation
  // → "This user tends toward steady emotional states and responds well to direct acknowledgment of their feelings."
}
```

This is a static mapping -- no ML, no complexity. Just a lookup table that converts `trajectory × tendency × relevance` into 1-sentence natural language.

### E.3: Prompt Rebalancing (not context engineering, but the real fix)

Rewrite the prompt template to:
1. Lead with a positive character voice ("You are warm, perceptive, and genuinely curious about the person you're talking to") instead of leading with constraints.
2. Reduce prohibitions from 17 to 5-7 essential ones.
3. Add a "conversational goal" section (from E.1).
4. Add 1-2 example exchanges per band showing desired tone.
5. Move GLOBAL CONSTRAINTS to the end, after all positive guidance.

---

## F) Risk of Overengineering

The research report proposes:
- 5 interacting context layers with typed state
- A PBWM-inspired gating controller (possibly RL/bandit-trained)
- Active-inference-style retrieval policy
- Schema-aware multi-factor relevance scoring
- Metacognitive monitoring loop
- Cognitive load-aware dynamic token budgeting

### What this actually requires:

| Component | Implementation Cost | Value for LoRa V1 |
|---|---|---|
| SIB | Already exists | Zero (already done) |
| TGW | ~200 lines, deterministic | HIGH -- this is the real gap |
| ISL | ~150 lines, deterministic | MEDIUM -- useful but not urgent |
| RAS | Already exists (ETV/EIV) | Zero (already done) |
| LTS | Already exists (Chroma/Falkor) | Zero (already done) |
| PBWM gating controller | 500+ lines, needs training data or heuristics | LOW -- the existing band gating + policy map does 80% of this |
| Active inference retrieval | Research-grade, POMDP solver or approximation | ZERO for V1 -- theoretical, no data to train on |
| Metacognitive monitor | 300+ lines, needs uncertainty estimation | LOW -- interesting but premature |
| Cognitive load budgeting | 200+ lines | LOW -- current token budget is fine |

**The research report is 70% description of what LoRa already has and 20% theoretical framework that requires ML training infrastructure you don't have. The remaining 10% -- conversation goal tracking and narrative memory translation -- is genuinely valuable.**

### Overengineering probability: HIGH

If you build the full 5-layer architecture with a gating controller, you will spend 2-4 weeks building infrastructure. The actual response quality improvement will come from:
1. Rewriting the prompt template (~2 hours)
2. Adding a conversation goal tracker (~1 day)
3. Translating schema metadata to narrative (~half day)

The research report names real cognitive science. But the mapping to LoRa's actual problem is loose. The problem is not "insufficient context arbitration." The problem is "the prompt tells the LLM to be generic."

---

## G) Final Verdict: Worth Building or Not

### The research report is: Academically rigorous, architecturally interesting, 80% inapplicable to your actual problem.

### The real diagnosis is:

**LoRa's generic-bot problem is primarily a prompt construction problem, not a context engineering problem.**

The system has:
- Emotional scoring that works (EIV/ETV)
- Memory that works (schemas, anchors, bootstrap)
- Band gating that works (but is cold-start hostile by design)
- Persona enforcement that works (identity/relational overrides)
- Feature flags that work

What it does NOT have:
1. A prompt that tells the LLM to be a compelling conversational partner (instead of a constraint-following compliance bot)
2. A per-turn conversational goal
3. Narrative continuity across turns beyond raw transcript dump
4. Human-readable memory context (instead of categorical labels)

### What to do:

**Do NOT build the full Context Engineering layer from the research report.**

**DO build:**

| Priority | Change | Time | Expected Impact |
|---|---|---|---|
| **P0** | Rewrite prompt template: positive voice first, fewer constraints, character examples | 2-3 hours | **Largest single improvement.** Moves LoRa from "constrained bot" to "warm companion." |
| **P0** | Switch to system/user message separation in OpenAI API call | 30 minutes | Improves instruction adherence. |
| **P1** | Add ConversationGoalTracker (the one genuinely valuable TGW idea) | 1 day | Gives LLM a per-turn north star. Eliminates aimless responses. |
| **P1** | Add narrative memory translator (schema labels → natural sentences) | 4 hours | Makes memory context useful to the LLM instead of categorical noise. |
| **P2** | Soften Band B0/B1 prompt language | 1 hour | "Neutral" doesn't have to mean "cold." B0 can be "calm and steady" instead of "no warmth, no softeners." |
| **P2** | Add conversation phase tracker (opening/exploring/deepening/closing) | 4 hours | Prevents repetitive turn patterns. |
| **P3** | If P0-P2 are insufficient, THEN consider lightweight context arbitration | 2-3 days | Only if the simpler fixes don't resolve the issue. |

### The hard truth:

The 60,000+ lines of emotional scoring, memory layers, trust trajectories, and persona enforcement are architecturally impressive. But they all reduce to prompt text that says "be neutral, don't do 17 things, here's a categorical label." The LLM doesn't care about the engineering behind the prompt. It cares about what the prompt says. Right now, the prompt says: be careful, be short, be generic.

Fix the prompt first. Then see if you still need context engineering.
