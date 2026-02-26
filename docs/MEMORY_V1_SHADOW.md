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

## Promoting to live

Set `LORA_MEMORY_V1=1` (and optionally `LORA_MEMORY_V1_SHADOW=0`) to enable
the memory context section in prompts. With `LORA_MEMORY_V1=1`, the prompt
includes a categorical `MEMORY CONTEXT` block with schema trajectories,
behavioral tendencies, and confidence levels — no raw floats.
