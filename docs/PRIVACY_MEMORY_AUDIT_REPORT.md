# LoRa Memory Pipeline — Privacy & Memory Audit Report

**Scope:** `src/emotion-core/`, `src/appraisal-lab/`, `src/server/`, `scripts/`  
**Goal:** Determine whether the system stores raw conversation transcripts anywhere.

---

## 1. Storage points (production & test)

### 1.1 MemoryService — saveMessage

| Field | Value |
|-------|--------|
| **File** | `src/emotion-core/memory-v1/service/MemoryService.ts` |
| **Function** | `saveMessage(input: MemorySaveInput)` |
| **What is stored** | **Not raw transcripts.** (1) Falkor: structured `FactAnchor` only (type, template, slot, normalized value, dates, salience, emotionVec; no message text). (2) Chroma: `SchemaRecord` with `centroid` = deterministic vector from **hash** of content, plus numeric metadata (salienceWeight, episodeCount, retrievalBias, timestamps). |
| **Example structure** | Falkor payload: `{ anchorId, userId, type, summary: { template, slot }, value?, date?, salience, status, emotionVecAtCreation, sessionId, createdAt, ... }`. Chroma: `{ ids: ["userId::messageId"], embeddings: [[...]], metadatas: [{ userId, schemaId, salienceWeight, episodeCount, retrievalBias, createdAt, lastUpdatedAt }] }`. |

**Code path:** `EngineOrchestrator` calls `memoryService.saveMessage(saveInput)` with `content: userMessage`. Content is used only to: (a) `extractFactAnchor(content, ...)` → structured anchor (no raw text in anchor); (b) `deterministicVector(hashString(content), STUB_VECTOR_DIM)` → centroid for Chroma. Raw `content` is never written to Falkor or Chroma.

---

### 1.2 MemoryService — retrieveContext

| Field | Value |
|-------|--------|
| **File** | `src/emotion-core/memory-v1/service/MemoryService.ts` |
| **Function** | `retrieveContext(userId, _query, opts?)` |
| **What is stored** | Nothing. Read-only. Returns anchors (with `contentSummary` = label from template/slot or slotValue, e.g. "Deployment plan: launch date") and semantic records (schemaId, weights, counts, timestamps). |
| **Example structure** | `{ anchors: [{ anchorId, contentSummary, slotValue?, timestamp, emotion, metrics, conflict?, supersedes? }], semantic: [{ schemaId, salienceWeight, episodeCount, createdAt, lastUpdatedAt }], degraded }`. |

**Note:** `contentSummary` is **not** raw user text; it is from `anchorSummaryLabel(template, slot)` or structured `slotValue` (e.g. `launch_date = 2026-03-23`).

---

### 1.3 FalkorAnchorAdapter / FalkorFactAnchorStore (Redis/Falkor)

| Field | Value |
|-------|--------|
| **File** | `src/emotion-core/memory-v1/db/FalkorAnchorAdapter.ts`, `FalkorFactAnchorStore.ts` |
| **Function** | `upsertAnchor`, `loadState`, `saveState` (FactAnchorStore) |
| **What is stored** | `FactAnchor` objects only: anchorId, userId, type, summary (template + slot), value (normalized), date?, entityRole?, salience, status, emotionVecAtCreation, sessionId, createdAt, etc. **No raw message or transcript.** Type comment: "Normalized value for structured anchors. No raw transcript." |
| **Example structure** | Node: `(:Anchor { userId, anchorId, payloadJson })` where `payloadJson` is stringified `FactAnchor`. |

---

### 1.4 ChromaSchemaAdapter / chromaClient (Chroma vector DB)

| Field | Value |
|-------|--------|
| **File** | `src/emotion-core/memory-v1/db/ChromaSchemaAdapter.ts`, `chromaClient.ts` |
| **Function** | `saveSchemas`, `loadSchemas`; client `getOrCreateCollection`, `upsert` |
| **What is stored** | `ids`, `embeddings` (vectors from hashed content), `metadatas`: userId, schemaId, salienceWeight, episodeCount, retrievalBias, createdAt, lastUpdatedAt. **No raw text.** Manual-embedding mode: centroid is computed in MemoryService as `deterministicVector(hashString(content), dim)`. |
| **Example structure** | `collection.upsert({ ids: ["userId::schemaId"], embeddings: [[...]], metadatas: [{ userId, schemaId, salienceWeight, episodeCount, retrievalBias, createdAt, lastUpdatedAt }] })`. |

---

### 1.5 Embedding pipeline

| Field | Value |
|-------|--------|
| **File** | `src/emotion-core/memory-v1/service/MemoryService.ts` (and ChromaSchemaAdapter) |
| **Function** | No external embedding API. Centroid is `deterministicVector(hashString(content), STUB_VECTOR_DIM)` (djb2-style hash → fixed-dim vector). |
| **What is stored** | Only the resulting vector and schema metadata in Chroma. **Input text is not stored;** only its hash drives the vector. |

---

### 1.6 Bootstrap memory (file storage)

| Field | Value |
|-------|--------|
| **File** | `src/emotion-core/memory-v1/bootstrap/bootstrapMemory.ts`, `bootstrapStorage.ts` |
| **Function** | `BootstrapStorage.save(state)` → `fs.writeFileSync` to `{baseDir}/{userId}.json` |
| **What is stored** | `BootstrapMemoryState`: entries with `themes` (stop-word–filtered keyword list from `extractMessageThemes(text)`), role, emotionVec, eiv, sessionIndex, timestamp. **No raw message text.** Comment: "Stores per-user extracted themes (never raw text)." |
| **Example structure** | `{ version: 1, userId, entries: [{ themes: ["exercise", "goal"], role: "user", emotionVec?, eiv?, sessionIndex, timestamp }], sessionCount, createdAt, lastUpdatedAt }`. |

---

### 1.7 Memory V1 JSON storage (EngineOrchestrator endSession)

| Field | Value |
|-------|--------|
| **File** | `src/emotion-core/engines/EngineOrchestrator.ts`, `src/emotion-core/memory-v1/storage.ts` |
| **Function** | `memoryV1Storage.save(storedState)` → `createJSONStorage(baseDir).save()` → `fs.writeFileSync` to `.lora/memory-v1/{userId}/state.json` |
| **What is stored** | `StoredMemoryV1State`: version, userId, savedAtMs, schemas (array of `SchemaRecord`: schemaId, centroid, salienceWeight, episodeCount, retrievalBias, createdAt, lastUpdatedAt), episodic, rifGuard. **No conversation text.** |
| **Example structure** | `{ version: 1, userId, savedAtMs, schemas: [{ schemaId, centroid: [...], salienceWeight, episodeCount, retrievalBias, createdAt, lastUpdatedAt }], episodic: [], rifGuard: {...} }`. |

---

### 1.8 Chat route — session history (in-memory only)

| Field | Value |
|-------|--------|
| **File** | `src/server/routes/chat.route.ts` |
| **Function** | `session.history.push(userTurn)` / `session.history.push(assistant turn)`; `getSession()` holds `SessionEntry` in a `Map`. |
| **What is stored** | In-process only. `SessionEntry.history`: `ChatTurn[]` with role, text, ts. **Not written to disk, Redis, or Chroma by the server.** Lost when the process exits. |
| **Example structure** | `{ engine, history: [{ role: "user", text: "...", ts }, { role: "assistant", text: "...", ts }], sessionStartedAt, tokensUsed }`. |

---

### 1.9 Analytics logging (engagement + runtime metrics)

| Field | Value |
|-------|--------|
| **File** | `src/server/analytics/engagementLogger.ts`, `src/server/analytics/runtimeMetrics.ts` |
| **Function** | `logSessionEnd(event)`, periodic `writeMetrics()` |
| **What is stored** | Engagement: userId, sessionId, sessionStart, sessionEnd, messagesCount, tokensUsed, durationSeconds, endedAt. Runtime metrics file: tokensToday, sessionsToday, avgSessionLength. **No message content.** |
| **Example structure** | `{ userId, sessionId, sessionStart, sessionEnd, messagesCount, tokensUsed, durationSeconds, endedAt }`; `{ tokensToday, sessionsToday, avgSessionLength }`. |

---

### 1.10 Decision logs (console only, no file by default)

| Field | Value |
|-------|--------|
| **File** | `src/emotion-core/memory-v1/decisionLogs.ts` |
| **Function** | `makeMemoryServiceSaveLog`, `makeMemoryRetrieveLog`, etc. → `console.log('[LoRa::Memory...]', JSON.stringify(log))` |
| **What is stored** | Not persisted to file in the codebase. Payloads: userId, sessionId, messageId, tsMs, ok, wroteFalkor, wroteChroma, degraded; or anchorCount, semanticCount, etc. **No user message or reply text.** |

---

### 1.11 Session trace (debug only — can contain full prompt and reply)

| Field | Value |
|-------|--------|
| **File** | `src/debug/sessionTrace.ts` |
| **Function** | `writeSessionTrace(sessionId, entry)` → `fs.appendFileSync(debug/traces/{sessionId}.jsonl, JSON.stringify(entry))` |
| **What is stored** | When `debugEnabled` (e.g. LORA_DEBUG): `{ timestamp, etv, eiv, emotionalState, prompt, llmOutput }`. **`prompt` and `llmOutput` can contain full user message and assistant reply.** |
| **Example structure** | One JSON line per call: `{"timestamp":...,"etv":...,"eiv":...,"emotionalState":{...},"prompt":"...full system + user prompt...","llmOutput":"...model reply..."}`. |
| **Trigger** | Only when `debugEnabled` is true (e.g. LORA_DEBUG). Production should have this disabled; production env check clears LORA_DEBUG_* in adapter. |

---

### 1.12 Stress test harness — conversation log files

| Field | Value |
|-------|--------|
| **File** | `scripts/memoryStressTest.ts` |
| **Function** | `writeConversationLog(entry)` → `conversationLogStream.write(JSON.stringify(entry))`; CSV: `csvRows.push([..., input, response, ...])`; finally `fs.writeFileSync(path.join(runDir, 'conversation-log.csv'), ...)`. |
| **What is stored** | **Full user input and model response.** JSONL: `{ timestamp, userId, sessionId, scenario, messageIndex, input, response, expectedRecall, recallCorrect, recallDebug? }`. CSV: columns include `input` and `response` (reply truncated to 200 chars in CSV). |
| **Example structure** | `logs/stress-tests/run_<timestamp>/conversation-log.jsonl`, `conversation-log.csv`. |
| **Note** | Test harness only; not part of production server. Run only when executing the stress test script. |

---

### 1.13 ClaudeResponder debug (stdout only)

| Field | Value |
|-------|--------|
| **File** | `src/emotion-core/llm/ClaudeResponder.ts` |
| **Function** | When `process.env.LORA_DEBUG_LLM_PAYLOAD === '1'`: `console.log(JSON.stringify({ system: systemPrompt.slice(0,200)+'...', messages }, null, 2))`. |
| **What is stored** | Not written to file. Stdout can contain truncated system prompt and **full `messages` array** (user/assistant content). Disabled in production (adapter clears LORA_DEBUG_LLM_PAYLOAD when NODE_ENV=production). |

---

## 2. Summary table

| Location | Raw transcript stored? | Notes |
|----------|------------------------|--------|
| MemoryService.saveMessage → Falkor | No | FactAnchor only (type, template, slot, value, etc.) |
| MemoryService.saveMessage → Chroma | No | Vector from hash(content) + numeric metadata |
| FalkorAnchorAdapter / FalkorFactAnchorStore | No | FactAnchor payload only |
| ChromaSchemaAdapter / chromaClient | No | ids, embeddings, metadatas (no text) |
| Embedding pipeline | No | Hash-based deterministic vector; no text stored |
| Bootstrap memory (file) | No | Themes (keywords) only |
| Memory V1 state.json | No | Schemas (vectors + numbers) only |
| Chat route session.history | In-memory only | Not persisted to disk/DB |
| Engagement + runtime metrics | No | Counts and aggregates only |
| Decision logs | No | IDs and counts only; console only |
| Session trace (debug) | Yes (when LORA_DEBUG) | prompt + llmOutput to debug/traces/*.jsonl |
| Stress test script | Yes | input + response to logs/stress-tests/run_*/ |
| ClaudeResponder LORA_DEBUG_LLM_PAYLOAD | Can log to stdout | Only when env set; cleared in production |

---

## 3. Final verdict

### RAW TRANSCRIPTS STORED: **CONDITIONAL**

**Production (NODE_ENV=production, debug/stress-test disabled):**  
**NO** — Raw conversation transcripts are **not** stored in the production memory pipeline.

- **Falkor/Redis:** Only structured `FactAnchor` (type, template, slot, normalized value, dates, salience, emotionVec). No user or assistant text.
- **Chroma:** Only vectors (from **hash** of content) and numeric metadata. No raw text.
- **Bootstrap file:** Only theme keywords and numeric/role/session fields. No raw text.
- **Memory V1 state.json:** Only schema records (vectors + numbers). No raw text.
- **Analytics:** Only counts and aggregates. No message content.
- **Session history:** In-memory only; not written to disk or any DB.

**When raw or full conversation can be stored:**

1. **Debug mode (LORA_DEBUG / session trace):**  
   - **File:** `src/debug/sessionTrace.ts`  
   - **Code path:** `EngineOrchestrator.processMessage` → when `debugEnabled` → `writeSessionTrace("session-"+..., { prompt, llmOutput, ... })` → `fs.appendFileSync(debug/traces/<id>.jsonl)`.  
   - **Stored:** Full `prompt` (includes user message) and full `llmOutput`.  
   - **Mitigation:** Production startup clears LORA_DEBUG_* and disables debug route; session trace is only written when debug is enabled.

2. **Stress test harness (scripts only):**  
   - **File:** `scripts/memoryStressTest.ts`  
   - **Code path:** `writeConversationLog({ input, response: chatRes.reply, ... })` and CSV push with `input` and response; at end `fs.writeFileSync(..., 'conversation-log.csv')`.  
   - **Stored:** Every `input` (user message) and `response` (model reply) under `logs/stress-tests/run_<timestamp>/` (conversation-log.jsonl and conversation-log.csv).  
   - **Note:** Not part of the server; only when running the stress test script.

---

## 4. What is stored instead of raw transcripts

- **Structured facts:** Template + slot (e.g. "deployment_plan", "launch_date"), normalized value (e.g. date string), salience, emotion vector, session/user ids.
- **Vectors:** Deterministic centroid from **hash** of message content (no invertibility to original text).
- **Labels for prompts:** `contentSummary` / `anchorSummaryLabel` (e.g. "Deployment plan: launch date", "launch_date = 2026-03-23") — not user verbatim.
- **Bootstrap themes:** Short, stop-word–filtered keyword lists (e.g. ["exercise", "goal"]).
- **Analytics:** Counts (messages, tokens, sessions) and durations; no content.

---

## 5. Test harness and analytics — full conversation logging

- **Stress test:** `scripts/memoryStressTest.ts` writes **full** `input` and `response` to:
  - `logs/stress-tests/run_<timestamp>/conversation-log.jsonl`
  - `logs/stress-tests/run_<timestamp>/conversation-log.csv`  
  So the **test harness** does log full conversations to disk; this is intentional for test debugging but should not be used with real user data in production.
- **Analytics (engagement + runtime metrics):** No conversation content; only session/token/count aggregates.

---

*Audit completed. No raw transcripts are stored in the production memory path (Falkor, Chroma, bootstrap, memory-v1 state, or analytics). Raw or full conversation appears only in debug session traces (when LORA_DEBUG) and in stress-test log files (when running the stress script).*
