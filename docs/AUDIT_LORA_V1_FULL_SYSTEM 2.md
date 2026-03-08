# LoRa V1 — Full End-to-End System Audit Report

**Audit type:** Verification (no refactor, no feature addition, no optimization)  
**Scope:** UI input → reply output; emotional + factual + storage + retrieval + prompt + response pipeline  
**Date:** 2025-02-25

---

## PHASE 1 — ENTRY POINT TRACE

### 1.1 UI entry

| Check | Status | Detail |
|-------|--------|--------|
| Entry file | PASS | `public/index.html` |
| POST target | PASS | `fetch(API_BASE + '/api/chat', { method: 'POST', ... })` (lines 155–158) |
| Payload fields | PASS | `userId`, `sessionId`, `messageId`, `text`, `timestamp` (lines 176–182). For end session: also `endSession: true` (line 206) |

**Call chain (normal message):**  
`sendMessage()` → `postChat({ userId, sessionId, messageId, text: text.trim(), timestamp })` → `POST /api/chat`.

**Call chain (end session):**  
`endSession()` → `postChat({ userId, sessionId, messageId, text: '(end session)', timestamp, endSession: true })` → `POST /api/chat` → client then calls `startNewSession()` and clears UI.

### 1.2 Server route

| Check | Status | Detail |
|-------|--------|--------|
| Route registration | PASS | `src/server/routes/chat.route.ts`: `app.post('/api/chat', ...)` (line 131) |
| Body validation | PASS | `validateBody(req.body)` enforces non-empty `userId`, `sessionId`, `messageId`, `text`; `timestamp` defaulted to `Date.now()` if missing |
| EngineOrchestrator usage | PASS | Single `EngineOrchestrator` per `(userId, sessionId)` via `getEngine(userId, sessionId)` and `sessions` Map (lines 114–127). No per-request instantiation. |
| MemoryService injection | PASS | One `MemoryService` created at `registerChatRoute()` (lines 94–111). Injected into each engine via constructor options. No duplicate per request. |

### 1.3 Session lifecycle

| Check | Status | Detail |
|-------|--------|--------|
| endSession handling | PASS | When `endSession === true`, route calls `memoryService.maintainAnchors(userId, sessionId, nowMs)` then `engine.endSession()` (lines 138–146). |
| maintainAnchors | **FAIL** | **SessionId mismatch:** Route calls `maintainAnchors(userId, sessionId, nowMs)` with the **client’s** `sessionId`. Engine uses **engine-generated** `this.currentSessionId` (e.g. `sess-${userId}-${messageTimestampMs}-${sessionCounter}`) for `saveMessage` and for its own `maintainAnchors` call inside `endSession()`. Anchors are stored with the engine’s sessionId; maintain with the client’s sessionId can run against the wrong session context. **Recommendation:** Route should not call `maintainAnchors`; only the engine should call it in `endSession()` with `this.currentSessionId`. |
| Session reset (client) | PASS | After end session, client sets `sessionId = startNewSession()`, clears messages and debug panel. |
| Session reset (engine) | PASS | `engine.endSession()` resets session buffers, ETV state, interpreter, appraisal bridge, degraded flags, etc. (lines 1270–1296). |

### 1.4 Redundant instantiations / cleanup

| Finding | Severity |
|---------|----------|
| **Double maintainAnchors on end session** | HIGH. Route and engine both call `maintainAnchors`; they use different sessionIds (see above). |
| **EngineOrchestrator never removed from `sessions` Map** | MEDIUM. On “End Session”, the client gets a new sessionId; the next message creates a **new** engine for the new key. The old engine for the previous sessionId remains in the Map forever. Long-lived usage with many sessions will grow the Map (memory leak). |
| No duplicate DB or orchestrator per message | PASS. |

---

## PHASE 2 — EMOTIONAL PIPELINE AUDIT

### 2.1 Trace

**InputProcessor.process(text)** → `analyzerOutputs` + `signalPacket` (includes `messageText: text`).  
**EIVComponentAssembler.assemble(analyzerOutputs)** → components.  
**EIVScorer.calculate(components)** → `composeEIV` + `getEIVTier` → single EIV per message.  
**ETV:** Legacy `ETVEngine.updateETV` used in `endSession()`; ETV V1 `ETVEngineV1.updateFromSession` and `getPolicy` used when `featureFlags.etvV1Enabled`.  
**Band:** From `this.lastEtvPolicy?.band` (ETV V1 policy). Default `B0` when no policy.  
**classifyIntensity(eiv):** Used in `PromptTemplateBuilder.getBandBehaviorBlock` and in debug `behaviorMode.intensityLevel`. Thresholds: &lt; 0.25 low, 0.25–0.75 medium, &gt; 0.75 high.

### 2.2 Verification

| Check | Status | Detail |
|-------|--------|--------|
| EIV range [0,1] | PASS | `EIVComposer` clamps with `CONSTANTS.CLAMP.MIN/MAX`; `master.constants.ts` has `eivCompositionConstants.CLAMP: { MIN: 0, MAX: 1 }`. |
| ETV range [0,1] | PASS | `ETVEngine.updateETV` clamps to `MASTER_CONSTANTS.etv.bounds.min/max` (legacy). ETV V1 policy derivation is separate and used for band. |
| Band mapping | PASS | Band comes from ETV V1 policy when enabled; otherwise prompt uses default `B0`. |
| No hidden mutation of EIV/ETV | PASS | EIV is computed once per message from components; ETV is updated only in `endSession()`. |
| classifyIntensity | PASS | Implemented and used; thresholds as above. |
| Debug payload uses real values | PASS | Route returns `eiv: result.eiv?.value`, `etv: debug.etv`, `band: debug.band` from orchestrator result; not placeholders. |

### 2.3 Test scenarios (design verification)

- **Neutral sentence:** Low EIV expected; intensityLevel low; band depends on ETV state.  
- **Highly emotional sentence:** Higher EIV; intensityLevel medium/high; band unchanged within session (ETV updated at session end).  
- **Flat low-intensity:** Low EIV; intensityLevel low.

No automated simulation was run; code path and constants support the above. **No inconsistencies reported** in the emotional pipeline logic.

---

## PHASE 3 — FACTUAL PIPELINE AUDIT

### 3.1 Trace

**MemoryService.saveMessage(input)** → `extractFactAnchor(userId, content, sessionId, emotionVec, timestamp, 0)` → candidate → **FalkorFactAnchorStore.upsertFromExtraction** (via `factStore`).  
**FalkorFactAnchorStore:** Delegates to in-memory store (`createInMemoryFactAnchorStore()`); `loadState`/`saveState` via `graphQuery` (FalkorDB).  
**Reinforcement / lifecycle:** In `factAnchorStore.ts`: `lastSeenSessionId` / `appearsInSessions` updated on reinforce; promotion and expiry in `maintain()`.  
**Retrieval:** **MemoryService.retrieveContext** → `factStore.getCandidates` + `vectorAdapter.loadSchemas` → **scoreAnchors** (anchorRelevanceArbiter) → `factAnchorToRecord` → anchors capped by `MAX_ANCHORS_IN_PROMPT`.  
**Prompt:** **PromptTemplateBuilder** receives `relevantAnchors` and `degraded`; `getAnchorContextBlock(anchors)` renders “FACT CONTEXT (possible anchors)” with “Possible context:” and “Does this relate to what you mean today?”.

### 3.2 Verification

| Check | Status | Detail |
|-------|--------|--------|
| Extraction confidence thresholds | PASS | `QUARANTINE_THRESHOLD` in factAnchorTypes; factExtractor returns confidence; lifecycle uses it. |
| Quarantine vs confirmed | PASS | `anchorLifecycle` and factAnchorStore implement promotion rules (e.g. reinforceCount >= 2 or confidence + appearsInSessions). |
| reinforceCount / appearsInSessions | PASS | factAnchorStore upsert/reinforce logic updates both; `lastSeenSessionId` used so appearsInSessions only increments on session boundary. |
| Promotion / expiry rules | PASS | Implemented in anchorLifecycle and factAnchorStore; tests cover them. |
| Deterministic sorting | PASS | FalkorFactAnchorStore loadState sorts confirmed/quarantined by `anchorId`; scoreAnchors sorts by totalScore desc then anchorId. |
| No raw user text in payloadJson | PASS | Fact anchors store template+slot; `anchorSummaryLabel(template, slot)` uses only enum-based TEMPLATE_LABELS/SLOT_LABELS. |
| Anchor summary from enum only | PASS | `getAnchorContextBlock` uses `a.contentSummary` which comes from `anchorSummaryLabel(fa.summary.template, fa.summary.slot)`. |

### 3.3 Session simulation (design)

- **Session 1:** “My goal is exercise” → one anchor candidate; after maintain, reinforceCount/appearsInSessions as per store logic.  
- **Session 2:** Repeat → reinforcement; eligibility for retrieval depends on band and `reinforceCount >= 2` or upcoming.  
- **Session 3:** Related question → retrieveContext returns scored anchors; B2+ and eligibility gates applied; FACT CONTEXT only if anchors pass and band allows.

**Gaps:** No automated 3-session test found in repo; design and code are consistent with reinforceCount >= 2 and maintain for eligibility.

---

## PHASE 4 — CHROMA (SEMANTIC) PIPELINE AUDIT

### 4.1 Trace

**ChromaSchemaAdapter:**  
- `getCollection()`: `getChromaClient().getOrCreateCollection({ name: 'lora_schemas', metadata: { 'hnsw:space': 'cosine' }, embeddingFunction: LoraSchemaStubEmbeddingFunction })`.  
- **saveSchemas(userId, schemas):** upsert with ids `userId::schemaId`, metadata includes userId, schemaId, salienceWeight, episodeCount, retrievalBias, createdAt, lastUpdatedAt. Centroids rounded via `roundForSerialization(centroid, 6)`.  
- **loadSchemas(userId):** `collection.get({ where: { userId }, include: ['metadatas', 'embeddings'] })`, then build SchemaRecord[], `deterministicSort(schemas, 'schemaId')`.  
- **purgeUser(userId):** `collection.delete({ where: { userId } })`.  
- No explicit “health probe” in adapter; MemoryService.healthCheck uses `loadSchemas('__healthcheck__')` (null = failure).

### 4.2 Verification

| Check | Status | Detail |
|-------|--------|--------|
| Collection creation | PASS | Single collection `lora_schemas`; partition by userId in metadata. |
| Embedding | PASS | Stub embedding (deterministic from content hash); no external API. |
| saveSchemas / loadSchemas | PASS | As above; rounding at serialization only. |
| Schema isolation per user | PASS | Filter by `where: { userId }`. |
| salienceWeight / retrievalBias | PASS | Stored and loaded in metadata. |
| v1 vs v2 endpoints | NOTE | Chroma client is `chromadb` npm default; no explicit /api/v2 reference in code. Client version determines API. |
| Degraded when Chroma down | PASS | loadSchemas catches, returns null; MemoryService.retrieveContext sets chromaDown when rawSchemas === null; orchestrator sets chromaDegraded and logs once. |

### 4.3 Simulate Chroma down

- **Kill Chroma:** loadSchemas fails → null → chromaDown = true → degraded.chroma = true in result.  
- **Response:** Semantic list empty; anchors still from Falkor if healthy. Prompt gets `degraded: { chroma: true }` → degraded block in prompt.  
- **Crash:** Orchestrator catch around retrieveContext prevents throw; no crash.

---

## PHASE 5 — FALKOR (GRAPH) PIPELINE AUDIT

### 5.1 Trace

**FalkorFactAnchorStore:**  
- **loadState(userId):** graphQuery MATCH Anchor by userId, parse payloadJson, sort by anchorId; meta node for sessionSeen, quarantineMeta, etc.  
- **saveState(userId, state):** diff with existing, DELETE removed nodes, MERGE for anchors and meta; payload capped at MAX_PAYLOAD_BYTES (8192).  
- **upsertFromExtraction:** loadState → pureStore.upsertFromExtraction → saveState.  
- **maintain:** loadState → pureStore.maintain → saveState.  
- **getCandidates:** loadState → pureStore.getCandidates.  
- **exportAll:** loadState → pureStore.exportAll.  
- **purgeAll(userId):** `MATCH (n { userId: $userId }) DETACH DELETE n`.

### 5.2 Verification

| Check | Status | Detail |
|-------|--------|--------|
| payloadJson cap | PASS | MAX_PAYLOAD_BYTES = 8192; oversized payloads skipped in saveState. |
| Deterministic sort | PASS | loadState sorts confirmed and quarantined by anchorId. getCandidates returns store order; scoreAnchors sorts by score then anchorId. |
| Orphaned anchors | PASS | purgeAll DETACH DELETE by userId; single graph, no User node required. |
| Memory leak (Falkor) | PASS | No unbounded in-memory accumulation in adapter; Redis/Falkor connection reused. |
| Degraded returns null | PASS | loadState catch → null; upsertFromExtraction/getCandidates/maintain return null when loadState fails. |
| ioredis cleanup | PASS | getFalkorClient() reuses client; on status 'end'/'close'/'reconnecting' it disconnects and creates new client. Tests use resetFalkorClient. |

### 5.3 Simulate Falkor down

- **Kill Falkor:** loadState throws → null → falkorDown = true → degraded.falkor = true.  
- **Response:** Anchors empty; semantic from Chroma if healthy. Prompt gets degraded block.  
- **Crash:** Same as Chroma; catch in orchestrator and in MemoryService prevents crash.

---

## PHASE 6 — BEHAVIOR MODULATION AUDIT

### 6.1 PromptTemplateBuilder

| Block | Status | Detail |
|-------|--------|--------|
| BandBehaviorBlock | PASS | getBandBehaviorBlock(band, etv, eiv); B0–B4 copy and intensity (classifyIntensity) applied. |
| AnchorInfluenceBlock | PASS | getAnchorInfluenceBlock(anchorsUsed, band); “Anchor Integration” rules; no recall language. |
| DegradedModeBlock | PASS | getDegradedModeBlock(degraded); only when falkor or chroma degraded. |
| Global constraints | PASS | Fixed list; includes “Never claim to recall…”, “Never use possessive framing…”. |
| FORBIDDEN_PHRASES | PASS | Defined; not injected in anchor block; anchor block uses “Possible context:” and question tag only. |
| Overlay / emoji / possessive | PASS | No emoji or possessive framing in anchor block. |

### 6.2 Prompt structure order

**Actual order in build():**  
1. LoRa intro + microContext  
2. CURRENT CONTEXT (Relationship Style)  
3. RESPONSE GUIDELINES (emotional + overlays)  
4. BEHAVIOR MODULATION (band + anchor influence + degraded)  
5. GLOBAL CONSTRAINTS (bullets + constraintOverlay)  
6. **memoryContextBlock** (MEMORY CONTEXT)  
7. **anchorContextBlock** (FACT CONTEXT)  
8. (User message appended later in orchestrator: `USER MESSAGE:\n${userMessage}`)

So: GLOBAL CONSTRAINTS → MEMORY CONTEXT → FACT CONTEXT → USER MESSAGE. **Deterministic and matches blueprint.**

### 6.3 Band / scenario behavior

- **B0 + low EIV:** Band B0 block + low intensity; no anchors (B0/B1 get 0).  
- **B3 + medium EIV + anchor:** B3 block + anchor influence block if anchorsUsed > 0; FACT CONTEXT if eligible.  
- **B4 + high EIV + degraded false:** Full warmth + anchors if any.  
- **B4 + high EIV + degraded true:** Degraded block present; semantic/anchors may be empty depending on which DB failed.

Tone and intensity are driven by band and EIV; no recall language in anchor block.

---

## PHASE 7 — DEBUG & OBSERVABILITY AUDIT

### 7.1 Debug payload

**Route response debug shape:**  
`{ eiv, etv, band, anchorsUsed, schemasUsed, degraded: { falkor, chroma } }`.

**Orchestrator result:**  
Also has `behaviorMode: { band, intensityLevel, anchorIntegration, degradedMode }` in `lastDecision.debug`, but the route does **not** include `behaviorMode` in the JSON response (ApiChatResponse type has no behaviorMode). So UI debug panel does not show behaviorMode.

| Check | Status | Detail |
|-------|--------|--------|
| Values accurate | PASS | eiv from EIVScorer result; etv/band from engine state; anchorsUsed/schemasUsed from MemoryService result; degraded from msResult.degraded. |
| Not mocked | PASS | All from real pipeline. |
| No raw content in debug | PASS | No user message or anchor content in response. |
| No sensitive leak | PASS | Only numeric and band/degraded flags. |

---

## PHASE 8 — SYSTEM INTEGRITY CHECK

| Check | Status | Detail |
|-------|--------|--------|
| Duplicate DB calls per message | PASS | retrieveContext once per message; saveMessage once (fire-and-forget). |
| Double maintain per session | FAIL | See Phase 1: route and engine both call maintainAnchors; engine’s call uses correct sessionId; route’s uses client sessionId (wrong for store). |
| Race conditions | PASS | Single-threaded Node; async serialize per engine via activeExecution guard. |
| Silent catch swallowing failures | WEAK | Orchestrator: catch around retrieveContext does nothing (no log, no degraded set on throw). saveMessage .catch() empty. FalkorFactAnchorStore/MemoryService/ChromaSchemaAdapter catch and return null/false without logging. Failures are silent. |
| Architecture drift | PASS | No drift identified from dual-DB blueprint (Chroma schemas, Falkor anchors, MemoryService, single collection/graph, purgeAll DETACH DELETE). |

---

## FINAL OUTPUT

### 1. PASS / FAIL per phase

| Phase | Result |
|-------|--------|
| Phase 1 — Entry point trace | **FAIL** (sessionId mismatch, double maintain, engine leak) |
| Phase 2 — Emotional pipeline | **PASS** |
| Phase 3 — Factual pipeline | **PASS** |
| Phase 4 — Chroma pipeline | **PASS** |
| Phase 5 — Falkor pipeline | **PASS** |
| Phase 6 — Behavior modulation | **PASS** |
| Phase 7 — Debug & observability | **PASS** |
| Phase 8 — System integrity | **FAIL** (double maintain, silent catches) |

### 2. Weaknesses

- **SessionId mismatch:** Route calls `maintainAnchors(userId, clientSessionId)` while anchors are stored with engine’s `currentSessionId`. Maintain should be done only in engine with `this.currentSessionId`.
- **EngineOrchestrator never evicted from `sessions` Map:** Old sessions accumulate; long-lived process with many sessions will leak memory.
- **Silent catch blocks:** retrieveContext, saveMessage, and store/adapter failures are caught and not logged; harder to diagnose production issues.
- **behaviorMode not exposed in API:** Debug payload omits behaviorMode; UI cannot show it.

### 3. Architectural violations

- **None** identified beyond the sessionId/maintain double-call (which is a wiring bug, not an architectural change).

### 4. Performance risks

- **sessions Map growth** over time (no eviction of ended sessions).
- **Double maintainAnchors** on every end session (one with wrong sessionId, one correct) — extra work and potential confusion in store state.

### 5. Memory risks

- **EngineOrchestrator instances** retained forever per (userId, sessionId) after session end.
- No other unbounded in-memory structures identified in the traced path.

### 6. Behavioral inconsistencies

- **Maintain with wrong sessionId:** Lifecycle (promotion/expiry) may run for a session id that does not match the one used when saving anchors this session.
- **Degraded not set on retrieveContext throw:** If MemoryService.retrieveContext throws (e.g. before returning), orchestrator catch does not set falkorDegraded/chromaDegraded, so UI could show degraded: false with empty anchors/schemas.

### 7. Overall system maturity score: **6 / 10**

- Pipeline is wired end-to-end, EIV/ETV/band and dual-DB design are implemented, prompt order and privacy rules (template-only anchors, no recall language) are respected.
- Score reduced for: sessionId/maintain bug, engine leak, silent failures, and missing behaviorMode in debug.

### 8. Final verdict

**Functional system, not production ready.**

The system is end-to-end functional and aligns with the intended architecture (emotional pipeline, factual pipeline, Chroma + Falkor, prompt order, privacy constraints). The sessionId/maintain mismatch and engine leak should be fixed before production. Silent failure handling and optional observability (behaviorMode, logging on catch) would improve operability.

---

*Audit completed without modification to code or architecture. All findings are from static trace and code review.*
