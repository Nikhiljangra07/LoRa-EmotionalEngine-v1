# Bootstrap Memory Phase -- Pre-Implementation Architecture Evaluation

**Type:** Deep architectural evaluation  
**Status:** Pre-implementation (no code changes)  
**Date:** 2026-02-25

---

## PHASE 1: CURRENT STATE ANALYSIS

### 1.1 The Cold Start Problem -- Precise Root Causes

The "early conversations feel flat" symptom has **four independent root causes**, not one. Each must be understood separately because the Bootstrap Memory Phase must address all four or it will not solve the perceived problem.

**Root Cause A: Band gating kills anchor exposure for new users.**

A new user starts with `initR: 1.5, initS: 2.5`. The ETV mean is `r / (r + s) = 0.375`. Risk-adjusted: `etvMean - 1.5 * sqrt(etvVar)`. With initial variance, this places the user solidly in **BAND_0 or BAND_1** for the first several sessions. Band thresholds:

```
BAND_0: riskAdjusted < 0.25
BAND_1: riskAdjusted < 0.40
BAND_2: riskAdjusted < 0.55
BAND_3: riskAdjusted < 0.70
BAND_4: riskAdjusted >= 0.70
```

The anchor arbiter returns **zero anchors** for B0/B1:

```
bandLimit(B0) = 0
bandLimit(B1) = 0
```

Even if anchors existed and were fully confirmed and reinforced, **they would never reach the prompt** until ETV climbs to BAND_2.

**Root Cause B: Reinforcement gating requires 2+ cross-session signals.**

`isEligible()` in `anchorRelevanceArbiter.ts`:
- Upcoming events within 7 days: always eligible.
- Everything else: `reinforceCount >= 2` required.

A fact anchor created in session 1 with `reinforceCount: 1` cannot appear in the prompt until session 2 at the earliest (reinforcement) AND the user is in B2+. For most users, this means **sessions 1-3 produce zero anchor context**.

**Root Cause C: Schema retrieval is empty until consolidation runs.**

Schema patterns are created by `consolidationEngine` which runs at `endSession()`. During session 1, the schema store is empty. `retrieveSchemas()` returns `noMatch: true`. Even in session 2, there is only one session's worth of consolidated schemas, with THETA_RETRIEVE = 0.50 as the similarity floor. A single schema from one session is unlikely to match diverse inputs in session 2.

**Root Cause D: Memory V1 policy suppresses prompt injection at B0/B1.**

`policyMap.ts`:
```
B0: allowPromptInjection: false, maxSchemasInPrompt: 0
B1: allowPromptInjection: false, maxSchemasInPrompt: 0
```

Even if schemas exist, they are not injected into the prompt at B0/B1.

**Combined effect:** For the first 3-5 sessions, a new user gets:
- Zero anchors in prompt (band gating).
- Zero schemas in prompt (empty store or policy suppression).
- Zero factual context.
- Generic responses indistinguishable from a stateless chatbot.

---

### 1.2 Current Pipeline -- Message Flow

```
InputProcessor.process(text)
        |
        v
AnalyzerOutputs + SignalPacket
        |
        v
EIVScorer.calculate(components) --> eivResult
        |
        v
EmotionalStateInterpreter.interpret()
        |
        v
[Hint pipeline: appraisal bridge -> guidance mode -> pacing -> tone -> ...]
        |
        v
Memory V1: processMemoryV1Message()
   |-- encodeEvent() --> emotionVec (21-dim)
   |-- computeSalience() --> shouldWrite?
   |-- pushEvent() to episodicBuffer
   |-- retrieveSchemas() --> RetrievalResult
   `-- buildMemoryContext() --> MemoryContext
        |
        v
MemoryService.retrieveContext()
   |-- factStore.getCandidates() --> FactAnchor[]
   |-- vectorAdapter.loadSchemas() --> SchemaRecord[]
   |-- scoreAnchors() --> AnchorScore[] (band-gated, eligibility-gated)
   `-- return { anchors, semantic, degraded }
        |
        v
MemoryService.saveMessage() [fire-and-forget]
   |-- extractFactAnchor() --> FactAnchor | null
   |-- factStore.upsertFromExtraction()
   `-- vectorAdapter.saveSchemas()
        |
        v
PromptTemplateBuilder.build()
   |-- RESPONSE GUIDELINES
   |-- BEHAVIOR MODULATION (band + anchor influence + degraded)
   |-- GLOBAL CONSTRAINTS
   |-- MEMORY CONTEXT (schemas)
   `-- FACT CONTEXT (anchors)
        |
        v
LLM input = prompt + "\n\nUSER MESSAGE:\n" + userMessage
        |
        v
LLM response --> reply to user
```

### 1.3 Insertion Point Analysis

The Bootstrap Memory Layer must inject **after** the existing memory retrieval and **before** prompt building. It cannot replace any existing layer; it supplements when those layers return empty results.

**Safe insertion point:** Between MemoryService.retrieveContext() and PromptTemplateBuilder.build(), inside `EngineOrchestrator.processMessage()`, approximately at the existing line:

```typescript
// 6. Build prompt (PURE)
const prompt = PromptTemplateBuilder.build(emotionalState, this.etvState, { ... });
```

The bootstrap layer adds its own block to the prompt options, alongside (not replacing) `memoryContext`, `relevantAnchors`, and `degraded`.

### 1.4 What Must NOT Be Touched

| Component | Reason |
|-----------|--------|
| EIV/ETV computation | Trust scoring must remain independent of memory availability |
| Band thresholds | Cannot weaken safety gating to fix cold start |
| Anchor reinforcement rules | Reinforcement integrity must be preserved |
| Schema consolidation logic | Consolidation must remain session-end only |
| RIF / anti-oscillation | Memory retrieval stability must not degrade |
| FORBIDDEN_PHRASES / global constraints | Privacy and safety constraints are immutable |
| FalkorDB / ChromaDB adapters | No schema changes, no new collections/graphs |
| Quarantine / promotion lifecycle | Anchor trust model must be preserved |

---

## PHASE 1: BOOTSTRAP MEMORY LAYER PROPOSAL

### 2.1 Architecture

```
                     EngineOrchestrator.processMessage()
                                    |
                         [existing pipeline]
                                    |
               +--------------------+--------------------+
               |                    |                    |
         Memory V1             MemoryService      BootstrapMemory
       (schemas, RIF)      (Falkor + Chroma)     (JSON, ephemeral)
               |                    |                    |
               v                    v                    v
          memoryContext      memServiceAnchors     bootstrapContext
               |                    |                    |
               +--------------------+--------------------+
                                    |
                                    v
                        PromptTemplateBuilder.build()
                                    |
                [MEMORY CONTEXT] [FACT CONTEXT] [BOOTSTRAP CONTEXT]
```

### 2.2 Interface Design

```typescript
interface BootstrapMemoryEntry {
  role: 'user' | 'assistant';
  summary: string;        // max 120 chars, LLM-summarized or truncated
  emotionVec: number[];   // from encoder at message time
  eiv: number;
  timestamp: number;
  sessionIndex: number;   // 1-based session number for this user
}

interface BootstrapMemoryState {
  userId: string;
  entries: BootstrapMemoryEntry[];
  sessionCount: number;
  createdAt: number;
  lastUpdatedAt: number;
}

interface BootstrapMemory {
  /** Record a message into the bootstrap buffer. No-op if phase complete. */
  addMessage(
    userId: string,
    message: string,
    role: 'user' | 'assistant',
    emotionVec: number[],
    eiv: number,
    sessionIndex: number,
    timestamp: number,
  ): void;

  /** Build a context string for prompt injection. Returns null if inactive. */
  getSummary(userId: string, currentEmotionVec: number[]): string | null;

  /** Whether bootstrap phase is active for this user. */
  isActive(userId: string): boolean;

  /** Delete all bootstrap data for this user. Idempotent. */
  purge(userId: string): void;

  /** Trigger graduation: summarize transcripts into structured data, then purge. */
  graduate(userId: string): GraduationResult;
}

interface GraduationResult {
  anchorCandidates: FactAnchor[];   // extracted from accumulated context
  emotionPatternSummary: string;    // for logging only
  messagesProcessed: number;
  purged: boolean;
}
```

### 2.3 Storage Design

**Storage:** JSON file, per-user, ephemeral. Path: `.lora/bootstrap/{userId}.json`.

**Why JSON, not DB:**
- Must not touch Falkor or Chroma schemas.
- Must be independently deletable.
- Data is ephemeral by design (max 5 sessions).
- JSON file is the simplest storage with zero dependencies.

**Size constraints:**
- Max entries: `MAX_BOOTSTRAP_ENTRIES = 150` (5 sessions x 30 messages avg).
- Max summary per entry: 120 characters.
- Total file size: ~50-80 KB per user at peak. Negligible.

**Auto-deletion:** After `sessionCount >= BOOTSTRAP_SESSION_THRESHOLD` (5), `graduate()` is called in `endSession()`, which extracts structured data and then `purge()` deletes the file.

### 2.4 What Bootstrap Context Injects

The bootstrap context is **not** raw transcripts. It is a condensed thematic summary built from stored entries:

```
BOOTSTRAP CONTEXT (early sessions)
-----------------------------------
Themes noticed so far:
- [theme 1 from clustering entries]
- [theme 2]
Recent emotional pattern: [trending direction from emotionVec history]
```

This is injected **after** FACT CONTEXT and **before** USER MESSAGE. It is gated:

- Only injected when `bootstrapMemory.isActive(userId)` is true.
- Only injected when existing `memServiceAnchors.length === 0 && memoryContext is empty or omitted`.
- When structured memory returns results, bootstrap context is suppressed even if still active.
- Max token budget for bootstrap block: 200 tokens (hard cap in builder).

### 2.5 Feature Flag Design

```typescript
// In featureFlags.ts:
bootstrapMemoryEnabled: process.env.LORA_BOOTSTRAP_MEMORY === '1',
bootstrapMemorySessionThreshold: parseInt(process.env.LORA_BOOTSTRAP_SESSIONS ?? '5', 10),
```

### 2.6 Orchestrator Wiring (pseudocode, not implementation)

```
// In processMessage(), after MemoryService retrieval and before prompt build:

let bootstrapContext: string | null = null;
if (
  featureFlags.bootstrapMemoryEnabled &&
  this.bootstrapMemory?.isActive(this.userId)
) {
  // Record this message
  this.bootstrapMemory.addMessage(
    this.userId, userMessage, 'user',
    emotionVec, eivResult.value,
    this.sessionCounter, messageTimestampMs,
  );

  // Only inject if structured memory is empty
  const structuredMemoryEmpty =
    memServiceAnchors.length === 0 &&
    (!memoryContext || memoryContext.topSchemas.length === 0);

  if (structuredMemoryEmpty) {
    bootstrapContext = this.bootstrapMemory.getSummary(
      this.userId, emotionVec
    );
  }
}

// Pass to prompt builder:
const prompt = PromptTemplateBuilder.build(emotionalState, this.etvState, {
  ...existingOptions,
  ...(bootstrapContext ? { bootstrapContext } : {}),
});
```

```
// In endSession():

if (
  featureFlags.bootstrapMemoryEnabled &&
  this.bootstrapMemory?.isActive(this.userId) &&
  this.sessionCounter >= bootstrapSessionThreshold
) {
  const graduation = this.bootstrapMemory.graduate(this.userId);
  // graduation.anchorCandidates can be fed into factStore.upsertFromExtraction
  // as if they were extracted from messages (goes through normal quarantine)
}
```

---

## RISK MATRIX

| Risk | Severity | Probability | Mitigation |
|------|----------|-------------|------------|
| **Token explosion** from raw transcript injection | HIGH | MEDIUM | 120-char summary per entry, 200-token hard cap on bootstrap block, suppressed when structured memory returns data |
| **Privacy leakage** from stored transcripts | HIGH | LOW | Summaries are truncated/abstracted, not raw text. Auto-purge after 5 sessions. Single `purge()` entrypoint. JSON file deletion is atomic. |
| **Memory bloat** from accumulated entries | MEDIUM | LOW | 150-entry cap, ~80KB per user max, auto-purge at graduation |
| **Race condition** if two requests write bootstrap simultaneously | LOW | LOW | Node.js single-threaded; engine is per-(userId, sessionId); bootstrap writes are synchronous in processMessage |
| **Bootstrap bypasses reinforcement rules** | HIGH | NONE | Bootstrap does NOT create anchors or schemas. It only injects a prompt context block. Graduation produces anchor candidates that go through normal quarantine/reinforce pipeline. |
| **Bootstrap replaces structured memory** | HIGH | NONE | Suppressed when structured memory has results. Never injected alongside anchors/schemas. |
| **Orphaned bootstrap files** (user abandons before graduation) | LOW | MEDIUM | Background cleanup: delete bootstrap files older than 30 days. Or: check file age on next load and purge if stale. |
| **Graduation produces garbage anchors** | MEDIUM | MEDIUM | Graduation uses the same extractFactAnchor on accumulated text; quarantine rules still apply. No special path. |

---

## COMPLEXITY ESTIMATE

| Component | New files | Lines (est.) | Difficulty |
|-----------|-----------|--------------|------------|
| `bootstrapMemory.ts` (interface + in-memory store) | 1 | 150-200 | Low |
| `bootstrapStorage.ts` (JSON persistence) | 1 | 60-80 | Low |
| `bootstrapContext.ts` (summary builder for prompt) | 1 | 80-120 | Medium |
| EngineOrchestrator wiring | 0 (edit) | +40-60 lines | Low |
| PromptTemplateBuilder: render bootstrap block | 0 (edit) | +30-40 lines | Low |
| Feature flags | 0 (edit) | +2 lines | Trivial |
| Tests | 3-4 | 300-400 | Medium |
| **Total** | 3 new + 3 edits | ~700-900 lines | **Medium** |

**Estimated implementation time:** 1-2 focused sessions.

---

## PERFORMANCE IMPLICATIONS

| Operation | Cost | Frequency | Impact |
|-----------|------|-----------|--------|
| addMessage | JSON write (~80KB max) | Per message | Negligible; async or fire-and-forget |
| getSummary | Array scan + string build | Per message (when active) | <1ms for 150 entries |
| graduate | Extract anchors from accumulated text | Once per user at session 5 | <10ms; regex on ~150 short strings |
| purge | File delete | Once per user | <1ms |
| Prompt size increase | +200 tokens max | Per message (when active, when structured memory empty) | ~$0.0001 per message; acceptable |

**No performance degradation.** Bootstrap operations are synchronous in-memory with lazy file persistence.

---

## PRIVACY IMPLICATIONS

| Concern | Assessment |
|---------|-----------|
| Raw transcript storage | **Mitigated.** Entries are summaries (120 chars), not raw transcripts. Truncation at capture time. |
| Retention period | **Bounded.** Max 5 sessions, then purged. Hard cap. |
| GDPR compliance | **Maintained.** `purge(userId)` deletes the file. Can be called from existing `deleteUserMemory()`. |
| Data at rest | **Acceptable risk for V1.** JSON on local filesystem. Same risk profile as existing `.lora/memory-v1/` files. |
| Cross-user isolation | **Enforced.** One file per userId. No shared storage. |
| Data minimization | **Respected.** Only summary + emotionVec + eiv stored. No full messages. |

---

## PHASE 2: EXTRACTION PIPELINE AUDIT

### 2.1 Factual Extraction -- Current Weaknesses

**Weakness 1: Closed ontology misses valid content.**

The extractor has 5 goal slots, 10 date event slots, 2 preference patterns, and 8 person roles. Anything outside these enums is silently dropped. Examples that fail:
- "I have a court hearing next week" -- no `court_hearing` slot.
- "I'm training for a marathon" -- `exercise` catches it, but "marathon" context is lost.
- "My landlord is pressuring me" -- no `landlord` role.

**Severity:** Medium. By design (precision-over-recall for V1). But it means anchor coverage is sparse.

**Weakness 2: No compound extraction.**

"My friend Jake has a birthday next week" contains BOTH a person_role AND a date_event. The extractor returns the first match (tryDateEvent runs before tryPersonRole). Only one anchor per message. The person context is lost.

**Severity:** Low. Intentional cap of 1 anchor per message. But it means relational + temporal context is never co-captured.

**Weakness 3: Preference extraction is too generic.**

"I like learning" and "I like dogs" both produce `preference_positive: general_positive`. No differentiation. The slot granularity for preferences is binary (positive/negative) with no domain.

**Severity:** Medium. Preferences feel impersonal because they collapse to one of two labels.

**Weakness 4: No negation handling.**

"I don't want to exercise anymore" matches GOAL_RE ("i want to") and GOAL_SLOT_MAP ("exercise"), producing `goal_active: exercise`. The negation is invisible.

**Severity:** High for user experience. The system will reinforce a goal the user explicitly rejected.

**Weakness 5: Confidence scores are static.**

BASE_CONFIDENCE is per-type, not per-pattern. A clear "remember that my therapist said..." (high signal) gets the same confidence as a vague "my friend" mention. No adjustment for linguistic strength.

**Severity:** Low. Quarantine/reinforce pipeline compensates over time, but first-impression accuracy suffers.

### 2.2 Emotional Pattern Extraction -- Current Weaknesses

**Weakness 6: Schema store is empty for first session.**

The emotion encoder produces a 21-dim vector per message. The episodic buffer accumulates events. But schemas (generalized patterns) are only created at `endSession()` by the consolidation engine. During session 1, `retrieveSchemas()` always returns `noMatch: true`.

**Severity:** Critical for cold start. This is Root Cause C.

**Weakness 7: THETA_RETRIEVE = 0.50 is aggressive for sparse schema stores.**

With only 1-2 schemas after sessions 1-2, the cosine similarity between the query vector and any schema centroid must exceed 0.50. Early schemas are averages of a single session's worth of diverse messages. The centroid is a "blur" that may not match specific inputs.

**Severity:** Medium. Retrieval will return `noMatch: true` more often than necessary in early sessions.

**Weakness 8: Softmax temperature T=0.15 is winner-take-all.**

When schemas DO match, the sharp softmax concentrates probability on a single winner. Early schemas are few and broad; the system picks one and suppresses the rest. Blended retrieval would be more appropriate when schema count is low.

**Severity:** Low. Acceptable design choice, but contributes to early retrieval feeling arbitrary.

### 2.3 Reinforcement Gating -- Over-Restriction Analysis

**Finding 1: reinforceCount >= 2 is correct but cold-start hostile.**

An anchor must be mentioned in at least 2 separate interactions to become eligible. For a user who mentions their therapist in session 1 and doesn't mention them again until session 4, the anchor sits ineligible for 3 sessions despite being potentially relevant.

**Assessment:** The rule is sound for preventing garbage surfacing. But it means factual anchors are effectively invisible for the first 2-3 sessions for most users.

**Finding 2: Band gating (B0/B1 = 0 anchors) is the primary suppressor.**

Even with reinforceCount >= 2 met, B0 and B1 users see zero anchors. ETV for a new user starts at ~0.375 mean with high variance; risk-adjusted puts them in B0 or low B1. ETV recovery rate is conservative:

```
decayHalfLifeDays: 14
evidenceMass: 1.0
initR: 1.5, initS: 2.5
```

It takes approximately 3-5 positive sessions to reach BAND_2 (riskAdjusted >= 0.40). During that time, ALL anchor context is suppressed regardless of anchor quality.

**Assessment:** Band gating is the biggest contributor to early flatness. It is architecturally correct (don't personalize before trust is established) but creates the cold start problem.

**Finding 3: Memory V1 policy also blocks schemas at B0/B1.**

`allowPromptInjection: false` and `maxSchemasInPrompt: 0` for B0/B1. Combined with empty schema store and empty anchor set, the first 3-5 sessions have zero memory-informed context of any kind.

### 2.4 Similarity Scoring -- Suppression Analysis

**Finding 4: SCORE_FLOOR = 0.25 is reasonable but compounds with sparse data.**

The anchor arbiter suppresses any scored anchor below 0.25. With few anchors and early emotion vectors that may drift significantly between sessions, scores can fall below floor even for relevant anchors.

**Finding 5: W_EMOTION = 0.40 dominates scoring for early anchors.**

With reinforceCount=1 (just created), reinforcementScore = 0.20. Recency decays. Temporal urgency is 0 unless it's a date event. So emotionalProximity carries 40% of the score. If the user's current emotional state differs from when the anchor was created, the score drops significantly.

**Assessment:** The scoring weights are appropriate for mature memory (many anchors, high reinforcement). For early memory, the emotional proximity weight causes anchors to appear and disappear unpredictably based on mood, not relevance.

---

## COMBINED ASSESSMENT

The cold start problem is not a single bug. It is the compounding of four independently correct design decisions:

1. Band gating suppresses all anchors at B0/B1 (safety).
2. Reinforcement requires 2+ signals across sessions (precision).
3. Schema store is empty until consolidation runs (architecture).
4. Memory V1 policy blocks prompt injection at B0/B1 (trust).

Each rule is individually sound. Together, they create 3-5 sessions of zero personalization.

**The Bootstrap Memory Phase is the correct architectural response** because it:
- Does not weaken any of the four rules.
- Provides a temporary, bounded, privacy-safe context bridge.
- Degrades gracefully (suppressed when structured memory activates).
- Auto-deletes after the threshold.
- Feeds back into the existing pipeline via graduation (normal quarantine/reinforce path).

---

## FINAL VERDICT

The proposed Bootstrap Memory Layer is **architecturally safe** to implement under the following conditions:

1. Bootstrap context is a **supplement**, never a replacement for structured memory.
2. Bootstrap entries are **summaries, not raw transcripts** (120-char cap at capture).
3. Bootstrap context is **suppressed** when structured memory returns any results.
4. Bootstrap data is **auto-purged** after 5 sessions via graduation.
5. Graduation feeds anchor candidates through the **normal quarantine pipeline**.
6. Feature flag `bootstrapMemoryEnabled` gates the entire layer.
7. JSON storage is **per-user, independently deletable**, added to `deleteUserMemory()`.
8. **200-token hard cap** on bootstrap prompt block prevents token explosion.
9. No changes to ETV, band thresholds, reinforcement rules, or DB schemas.

All conditions are achievable with the proposed design.

---

**Ready for implementation phase.**
