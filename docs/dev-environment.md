# LoRa Development Environment

This document describes the local development setup for LoRa v1 and how to run the server and stress tests reliably.

## Requirements

- **Node.js** (v18+)
- **Docker Desktop** (for Falkor and Chroma)
- **Environment file** (`.env.local` with `LORA_FALKOR_URL`, `LORA_CHROMA_URL`, and `OPENAI_API_KEY`)

## Docker

LoRa uses two services in development:

1. **Falkor** (port 6379) — graph store for fact anchors (memory).
2. **Chroma** (port 8000) — vector store for schema embeddings.

Both are started via Docker Compose. If Docker CLI is not available in your terminal (e.g. after a fresh install of Docker Desktop), run:

```bash
npm run docker:path-fix
```

Then restart your terminal. This adds Docker’s bin path to `~/.zshrc`.

## Falkor (memory database)

- Image: `falkordb/falkordb:latest`
- Port: **6379**
- Compose file: `docker-compose.falkor.yml`

```bash
npm run falkor:start   # start
npm run falkor:stop    # stop
npm run falkor:logs    # logs
```

## Chroma (semantic database)

- Image: `chromadb/chroma:1.5.1`
- Port: **8000**
- Compose file: `docker-compose.chroma.yml`

```bash
npm run chroma:start   # start
npm run chroma:stop    # stop
npm run chroma:health  # quick health check
npm run chroma:logs    # logs
```

## Environment variables

Create `.env.local` in the project root (git-ignored) with at least:

- `LORA_FALKOR_URL` — e.g. `redis://127.0.0.1:6379`
- `LORA_CHROMA_URL` — e.g. `http://127.0.0.1:8000`
- `OPENAI_API_KEY` — required for the LLM

If these are missing, the server will **fail at startup** with a clear error instead of disabling `/api/chat` silently.

## Running the server

```bash
npm run dev
```

This will:

1. Run **dev bootstrap** (`dev:bootstrap`): check Docker CLI, Docker daemon, Falkor (6379), Chroma (8000), and env vars.
2. If Falkor or Chroma are not reachable, **start their containers** automatically.
3. **Validate** `LORA_FALKOR_URL` and `LORA_CHROMA_URL`; if missing, exit with instructions.
4. Start the LoRa server on port 3000.

To only check the environment without starting the server:

```bash
npm run dev:check
```

## Stress tests

The memory stress test runs against a **running** LoRa server. It simulates many conversations, session terminations, and recall queries.

```bash
npm run stress:memory
```

- **Prerequisite:** Server must be running (`npm run dev` in another terminal).
- If the server is not reachable, the script prints:  
  `LoRa server not running. Start with npm run dev.`  
  and exits with code 1.
- Optional: `LORA_STRESS_CONVERSATIONS=50` to run fewer conversations; `DEBUG_MEMORY=1` to log anchor state.

## Summary

| Command              | Purpose                                      |
|----------------------|----------------------------------------------|
| `npm run dev`        | Bootstrap env + start server                 |
| `npm run dev:check`  | Verify Docker, ports, and env only           |
| `npm run dev:bootstrap` | Verify env and start containers if needed |
| `npm run docker:path-fix` | Add Docker to PATH in `~/.zshrc`        |
| `npm run stress:memory`   | Run memory stress test (server must be up) |

The development environment is designed to be **self-healing**: `npm run dev` ensures containers and env are valid before the server starts, and missing config fails loudly instead of silently.
