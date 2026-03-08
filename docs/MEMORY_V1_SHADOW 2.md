# Memory V1 — Shadow Mode

## What is shadow mode?

When `LORA_MEMORY_V1_SHADOW=1` and `LORA_MEMORY_V1=0`, the memory-v1 pipeline runs
**silently alongside** the main LoRa engine. It encodes emotion vectors, computes
salience, maintains an episodic buffer, retrieves schemas, and consolidates at
session end — but **none of this reaches the prompt or user-visible output**.

The PromptTemplateBuilder output remains byte-identical to a run with both flags off.

## What shadow mode does

- Loads/creates memory state on first message of each session.
- Calls `processMessage` on every message (encode → salience → episodic → retrieval).
- Calls `endSession` to consolidate episodic events into schemas.
- Persists state to `.lora/memory-v1/{userId}/state.json`.
- Emits throttled `[LoRa::MemoryV1Shadow]` log when context *would have* been injected.
- Emits `[LoRa::Memory]` consolidation log at session end (when `LORA_DECISION_LOG` enabled).

## What shadow mode does NOT do

- Inject any `MEMORY CONTEXT` section into the prompt.
- Alter EIV, ETV, guidance mode, hints, or any other pipeline output.
- Crash the response pipeline (all memory operations are wrapped in try/catch).

## Running the shadow smoke test

```bash
npm run memory:v1:shadow-smoke
```

This runs two identical 12-message sequences (2 sessions × 6 messages each):
1. **Baseline** — both memory flags OFF.
2. **Shadow** — `LORA_MEMORY_V1_SHADOW=1`, `LORA_MEMORY_V1=0`.

It then verifies:
- Every prompt from the shadow run is byte-identical to the baseline.
- At least one memory log was emitted.
- The state file exists on disk after session end.
- No `MEMORY CONTEXT` text appears in any prompt.

## What "success" looks like

```
=== SHADOW SMOKE TEST RESULTS ===
totalMessages:              12
promptEqualityPass:         true
memoryLogsCount:            >= 2
statePath:                  .lora/memory-v1/shadow_test_user/state.json
schemasCountAfterSessionA:  >= 0
schemasCountAfterSessionB:  >= 0

✅ All shadow smoke checks passed.
```

## Feature flags

| Flag | Value | Effect |
|------|-------|--------|
| `LORA_MEMORY_V1` | `0` | Memory context NOT injected into prompt |
| `LORA_MEMORY_V1_SHADOW` | `1` | Memory pipeline runs, logs, persists — no prompt change |
| `LORA_DECISION_LOG` | `1` | Enables consolidation log output |

## Phase 13: Single-User Live Enable Checklist

### Run command

```bash
npm run memory:v1:live-smoke
```

### What it does

Runs `LORA_MEMORY_V1=1` for userId `live_test_user` across two sessions
(8 messages each, 16 total). Validates:

1. **MEMORY CONTEXT block appears** when schemas exist and retrieval matches.
2. **No raw floats** inside the MEMORY CONTEXT section.
3. **No forbidden phrases** (companionship, intimacy, dependency, "casual").
4. **Only categorical fields** (trajectory, tendency, relevance, confidence, sessionPattern).
5. **State persists** to `.lora/memory-v1/live_test_user/state.json`.
6. **Schema count** is tracked across sessions.

### Expected output

```
=== LIVE ENABLE SMOKE RESULTS ===
totalMessages:              16
memoryContextBlocksSeen:    >= 0
schemasCountAfterSessionA:  >= 0
schemasCountAfterSessionB:  >= 0
stateFileExists:            true
memoryLogsEmitted:          >= 2
floatLeakCount:             0
forbiddenPhraseCount:       0
categoricalViolations:      0
schemaCountDecreased:       false

✅ All live enable smoke checks passed.
```

### Failure actions

| Failure | Cause | Fix |
|---------|-------|-----|
| `FLOAT_LEAK` | Raw number in MEMORY CONTEXT section | Fix `getMemoryContextBlock` renderer in PromptTemplateBuilder |
| `FORBIDDEN_PHRASE` | Companionship/intimacy language in section | Fix renderer — memory must be categorical only |
| `STATE_MISSING` | State file not written after endSession | Check try/catch boundary in EngineOrchestrator.endSession |
| `INVALID_TRAJECTORY` / `INVALID_TENDENCY` | Non-categorical label in section | Fix memory-v1 memoryContext builder or schema labels |
| Memory causes crash | Unhandled throw in memory pipeline | Regression in try/catch wrapping — fix EngineOrchestrator |
| Prompt missing entirely | No prompt returned | Flag wiring issue — check featureFlags.ts |

### Jest coverage

```bash
npx jest --testPathPatterns='liveEnable' --no-coverage
```

Validates the same assertions directly on PromptTemplateBuilder (no orchestrator).

## Phase 14C: Shadow Analytics Report

### Running the shadow report

```bash
# From a log file:
npm run memory:v1:shadow-report -- --in logs/shadow.jsonl

# Or piped from stdin:
cat logs/shadow.jsonl | npm run memory:v1:shadow-report
```

Output is written to `docs/MEMORY_V1_SHADOW_REPORT.md`.

### What the report contains

| Section | Description |
|---------|-------------|
| **Totals** | Event count, user count, injection count/rate |
| **Counts by Band** | How many events at each ETV band (B0–B4) |
| **Counts by Policy Signature** | Deterministic categorical signature frequency |
| **Confidence Distribution** | LOW / MED / HIGH breakdown |
| **Top Trajectories** | Most frequent trajectory labels (excluding "omitted") |
| **Top Tendencies** | Most frequent tendency labels (excluding "omitted") |
| **Flags** | HIGH and MED severity drift violations |

### What the flags mean

| Severity | Code | Trigger |
|----------|------|---------|
| HIGH | `INJECTION_AT_LOW_BAND` | Memory injected at B0 or B1 (should be blocked) |
| HIGH | `OMITTED_FIELDS_VIOLATION` | Tendency/trajectory/sessionPattern shown when policy forbids |
| HIGH | `SCHEMA_COUNT_OVER_CAP` | More schemas than `maxSchemasInPrompt` |
| HIGH | `FORBIDDEN_TOKEN` | Companionship/intimacy/"CASUAL" token found in context |
| MED | `EXCESSIVE_INJECTION_RATE` | Per-user injection rate > 85% |
| MED | `OSCILLATION_SPIKE` | Schema winner flips too often (> 5 in a run) |
| MED | `CONFIDENCE_IMPLAUSIBLE` | > 30% HIGH confidence at B0/B1 |

### Rollout gate

The shadow report **must be green** (zero HIGH flags) before widening rollout
from shadow to live. MED flags are advisory but should be investigated.

## Promoting to live

Set `LORA_MEMORY_V1=1` (and optionally `LORA_MEMORY_V1_SHADOW=0`) to enable
the memory context section in prompts. With `LORA_MEMORY_V1=1`, the prompt
includes a categorical `MEMORY CONTEXT` block with schema trajectories,
behavioral tendencies, and confidence levels — no raw floats.
