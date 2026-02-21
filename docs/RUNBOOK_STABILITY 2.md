# Runbook — Stability Checks

Deterministic steps for running, testing, and troubleshooting the LoRa backend.

---

## Start the Backend

```sh
npm run dev
```

Server listens on `http://localhost:3000`.
Requires `OPENAI_API_KEY` in `.env.local` or `.env` (see below).

---

## Run Contract Tests

```sh
npm test
```

Runs all Jest tests (contract tests for `/chat` and `/health/llm`).
Tests mock OpenAI — no real API key is needed to run them.

---

## Run Smoke Script

The smoke script validates a **running** server. Start the backend first in a separate terminal.

```sh
# Terminal 1
npm run dev

# Terminal 2
npm run check:smoke
```

---

## Run All Checks

```sh
npm run check:all
```

This runs contract tests first, then the smoke script (server must be running for the smoke step).

---

## Troubleshooting

### `/health/llm` shows `"openai": "down"`

**Meaning:** No real LLM call has succeeded since the process started.

**Steps:**

1. Confirm `OPENAI_API_KEY` is set and non-empty in `.env.local` or `.env`.
2. Send a test message: `curl -X POST http://localhost:3000/chat -H "Content-Type: application/json" -d '{"message":"hello"}'`
3. Check server logs for `[LoRa::Audit][LLM]` entries.
4. If logs show `retry_exhausted` or `cooldown_active`, the LLM endpoint is failing or timing out.
5. Verify network connectivity to the OpenAI API (or custom `OPENAI_BASE_URL` if set).
6. Check if `LORA_LLM_TIMEOUT_MS` is set too low (default: 12000 ms, minimum: 1000 ms).

### `/chat` returns a fallback reply

**Meaning:** The LLM call failed and the engine returned its static fallback.

**Steps:**

1. Run `curl http://localhost:3000/health/llm` — if `"openai": "down"`, follow the section above.
2. If `"openai": "ok"`, the LLM was previously reachable but the specific request failed.
3. Check server logs for `[LoRa::Audit][LLM]` with `path: fallback_static` or `reason: cooldown`.
4. If in cooldown, wait for the cooldown period to expire (default: 30 seconds) and retry.

### OpenAI connection error on startup

**Meaning:** `OPENAI_API_KEY` is missing or empty.

**Symptoms:**

- Server prints `[LoRa::Fatal] OPENAI_API_KEY is missing or empty. Server cannot start.`
- Process exits with code 1.

**Steps:**

1. Create or update `.env.local` in the project root:
   ```
   OPENAI_API_KEY=sk-...
   ```
2. Restart: `npm run dev`

### Server port conflict

**Symptoms:** `EADDRINUSE` error on startup.

**Steps:**

1. Check if another process is using port 3000: `lsof -i :3000`
2. Stop the conflicting process or restart the server.
