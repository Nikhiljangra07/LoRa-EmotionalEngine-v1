# Local Chroma Setup

This guide describes how to run ChromaDB locally for development and DB tests (e.g. `ChromaSchemaAdapter`).

## Prerequisites

1. **Install Docker Desktop**  
   Install from [docker.com](https://www.docker.com/products/docker-desktop/) and ensure Docker is running.

2. **Start Docker**  
   Launch Docker Desktop (or your Docker daemon) so `docker` and `docker compose` are available.

## Start Chroma

```bash
npm run chroma:start
```

This starts a Chroma container (`lora-chroma`) on port 8000 with a persistent volume.

## Verify

```bash
npm run chroma:health
# or: curl -sf http://localhost:8000/api/v2/heartbeat
```

A successful response (e.g. `{"nanosecond heartbeat": ...}`) indicates Chroma is reachable.

> **Note:** The server only exposes `/api/v2` endpoints. Requests to `/api/v1/*` return a deprecation error.

## Run DB tests

```bash
LORA_TEST_DB=1 LORA_CHROMA_URL=http://localhost:8000 npx jest --testPathPatterns 'ChromaSchemaAdapter' --no-coverage
```

## Stop Chroma

```bash
npm run chroma:stop
```

## Other commands

- **View logs:** `npm run chroma:logs`
