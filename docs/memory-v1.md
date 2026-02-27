# Memory V1 — Fact Anchors

## Prerequisites

FalkorDB and ChromaDB must be running locally.

```bash
# Start both databases
npm run falkor:start   # FalkorDB on redis://localhost:6379
npm run chroma:start   # ChromaDB on http://localhost:8000 (image: chromadb/chroma:1.5.1)

# Verify they're up
npm run chroma:health  # or: curl -sf http://localhost:8000/api/v2/heartbeat
npm run falkor:logs
```

## Environment Variables

| Variable | Default | Required |
|---|---|---|
| `LORA_FALKOR_URL` | `redis://localhost:6379` | No |
| `LORA_CHROMA_URL` | — | **Yes** |
| `LORA_DEMO_KEEP` | `0` | No (set `1` to skip cleanup) |

## Running the Demo

```bash
LORA_CHROMA_URL=http://localhost:8000 npm run demo:fact-anchors
```

### Expected Output

```
--- degraded flags ---
{"falkor":false,"chroma":false}
--- returned anchors ---
  <anchorId>  Active goal: exercise
--- FACT CONTEXT block ---
FACT CONTEXT (possible anchors)
-------------------------------
Possible context:
- [2025-07-15 12:00] Active goal: exercise
Does this relate to what you mean today?
--- cleanup: demo-user purged ---
```

- `degraded` flags are both `false` when DBs are healthy.
- Anchor IDs and timestamps will vary per run.
- If no anchors reach B2+ eligibility, the FACT CONTEXT block prints `(none — anchors may be below B2 eligibility)`.

### Keep Data for Inspection

```bash
LORA_CHROMA_URL=http://localhost:8000 LORA_DEMO_KEEP=1 npm run demo:fact-anchors
```

### Error Modes

If a database is unreachable the script exits with code 1 and prints:

```
[demo-fact-anchors] FAIL: FalkorDB unreachable at redis://localhost:6379
```

## Stopping Databases

```bash
npm run falkor:stop
npm run chroma:stop
```
