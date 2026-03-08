# Phase 2 — Contract Lock

Locked at the end of Phase 2 (hardening pass).
This document records the exact backend integration contract and known invariants.
Any change to the items below is a **breaking change** and must be flagged explicitly.

---

## Endpoints

### `POST /chat`

| Field | Value |
|-------|-------|
| Method | `POST` |
| Path | `/chat` |
| Content-Type | `application/json` |

**Request body**

```json
{ "message": "<string>" }
```

**Response body (200)**

```json
{ "reply": "<string>" }
```

**Error responses**

| Status | Condition | Body |
|--------|-----------|------|
| 400 | `message` missing or empty | `{ "reply": "" }` |
| 500 | Unhandled server error | `{ "reply": "" }` |

> On LLM failure the server still returns 200 with a static fallback reply.
> The response schema is always `{ "reply": string }`.

---

### `GET /health/llm`

| Field | Value |
|-------|-------|
| Method | `GET` |
| Path | `/health/llm` |

**Response body (200)**

```json
{
  "openai": "ok" | "down",
  "lastSuccess": <number | null>
}
```

- `openai` is `"ok"` if at least one real LLM call has succeeded since process start; `"down"` otherwise.
- `lastSuccess` is the Unix timestamp (ms) of the last successful LLM response, or `null` if none.
- This endpoint is read-only. It never triggers an LLM call or any side-effects.

---

## CORS

| Setting | Value |
|---------|-------|
| Allowed origin | `http://localhost:8080` |
| Allowed methods | `POST`, `OPTIONS` |
| Allowed headers | `Content-Type` |

The health endpoint (`GET /health/llm`) is intended for server-side or CLI monitoring.
CORS does not restrict non-browser callers.

---

## Environment Invariants

### Required

| Variable | Constraint |
|----------|-----------|
| `OPENAI_API_KEY` | Must be non-empty at process start. Server exits with code 1 if missing. |

### Optional

| Variable | Default | Purpose |
|----------|---------|---------|
| `OPENAI_MODEL` | `gpt-4o` | Model identifier passed to OpenAI |
| `OPENAI_BASE_URL` | *(OpenAI default)* | Custom base URL for OpenAI-compatible endpoints |
| `LORA_DEBUG` | *(unset)* | Set to `1` to enable verbose debug logging |
| `LORA_LLM_TIMEOUT_MS` | `12000` | Per-request abort timeout for LLM calls (ms, minimum 1000) |

---

## Session Model

- HTTP mode uses a single in-process session (`default-http-session`).
- The session is **ephemeral** — lost on process restart, no persistence layer.
- Emotional continuity (ETV, momentum, cooldown, message count) is maintained across requests within a single process lifetime.
- There is no multi-session or per-user routing. This is intentional for V1.

---

## What This Lock Covers

- Endpoint paths, methods, and JSON schemas
- Error response shapes
- Environment variable requirements and defaults
- CORS configuration
- Session semantics

Any changes to the above require an explicit contract migration note.
