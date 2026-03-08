# Local FalkorDB Setup

This guide describes how to run FalkorDB locally for development and DB tests (e.g. `FalkorAnchorAdapter`).

## Prerequisites

1. **Install Docker Desktop**  
   Install from [docker.com](https://www.docker.com/products/docker-desktop/) and ensure Docker is running.

2. **Start Docker**  
   Launch Docker Desktop (or your Docker daemon) so `docker` and `docker compose` are available.

## Start FalkorDB

```bash
npm run falkor:start
```

This starts a FalkorDB container (`lora-falkor`) on port 6379 with a persistent volume.

## Verify

```bash
docker exec -it lora-falkor redis-cli PING
```

Expected response: `PONG`.

## Environment

- **LORA_FALKOR_URL** — Redis URL for FalkorDB. Default if unset: `redis://localhost:6379`.

## Run DB tests

```bash
LORA_TEST_DB=1 LORA_FALKOR_URL=redis://localhost:6379 npx jest --testPathPatterns 'FalkorAnchorAdapter' --no-coverage
```

## Stop FalkorDB

```bash
npm run falkor:stop
```

## Other commands

- **View logs:** `npm run falkor:logs`
