# LoRa — an analytical reasoning partner

LoRa is an AI conversation product built around one design conviction: **people facing hard decisions
need analysis, not validation.** LoRa diagnoses root causes, projects consequences, and pushes toward a
decision — it is deliberately *not* a therapist, a life coach, or a mirror.

Work began June 2025; prototype February 2026; this repository (the production backend) dates from
January 2026. Designed, built, secured, deployed and operated end to end. Ran as a **live public beta at
asklora.io from March 2026** with about forty testers recruited from Reddit and a personal network. This repository is the backend; the React frontend (`presence-whispers`) and the
mathematical-reasoning microservice (`LoRaMaths`) live in sibling repositories.

## What's actually in here

**A five-service production architecture** (deployed on Railway):

```
React/Vite frontend ──► Express + TypeScript backend ──► Claude (Anthropic API)
                            │            │
                            │            ├─► LoRaMaths — Python/FastAPI microservice:
                            │            │   5 mathematical reasoning frameworks (regression,
                            │            │   Bayesian, game theory, constraint, causal-loop)
                            │            │   injected as invisible analytical context
                            │            ├─► FalkorDB/Redis — fact anchors, tiers, sessions
                            │            └─► ChromaDB — emotional-fingerprint vector memory
                            └─► Supabase Auth (Google OAuth + JWT verification)
```

**Subsystems I'm proud of:**

- **Identity enforcement** (`src/emotion-core/policy/`) — a personality contract ("6 Laws") enforced
  *post-generation* on every LLM output: 30+ forbidden-pattern classes (therapist openers, narrative
  framing, emotional mirroring) stripped or rewritten by a regex + semantic guard. The model is not
  trusted to stay in character; the system makes it.
- **Memory V2** (`src/emotion-core/memory-v2/`) — privacy-first memory: **zero conversation storage**.
  At session end, a pipeline summarizes → extracts structured facts + an emotional fingerprint →
  verifies → stores to graph (facts) + vector (fingerprints) stores. Retrieval is emotion-anchored
  (mood-congruent recall, Bower 1981) via a graph-vector hybrid. 228 tests, crash-proofed with
  per-stage timeouts and fallbacks.
- **Deep Reasoning Mode** — on demand, a problem is run through all five LoRaMaths frameworks, 31
  framework-combinations are scored, and a long-form synthesis is generated (120s pipeline with
  graceful degradation to the fast path).
- **Security hardening** — JWT verification, prompt-injection filtering (20+ patterns with
  normalization against spacing/unicode evasion), dual-key rate limiting (user + IP), CSP/HSTS
  headers, session-ownership checks, timing-safe token comparison on the ops dashboard.
- **Operations** — a mobile-friendly live health dashboard (service latencies, 17 operational
  counters, response-time percentiles, LLM fallback/cooldown tracking), PostHog product analytics,
  and graceful shutdown that drains live sessions before redeploys.
- **Payments infrastructure** — full Stripe subscription integration (checkout, signature-verified
  webhooks, Redis-mirrored entitlements, customer portal), built and verified end-to-end in live mode.

**Engineering discipline:**

- ~36k lines of production TypeScript, **~50k lines of tests** (265 test files)
- A maintained decision log (kept privately, available on request) recording every production change,
  bug post-mortem, and root cause for the project's lifetime, including the unflattering ones
- An LLM-evaluation harness (blind multi-model scoring, triple-run medians) used internally to guide
  prompt and pipeline changes

## Honest scope

This was a beta: real deployment, real testers, real operational lessons (cooldown cascades, model
version drift, context bleed, prompt-injection attempts) — not a revenue business. The interesting
part is the systems engineering around an LLM: making a model hold a personality under adversarial
pressure, remember without storing conversations, and stay observable and safe in production.

## Development

```bash
npm ci               # install (Node 20)
cp .env.example .env # set ANTHROPIC_API_KEY; Falkor/Chroma hosts default to localhost
npm run dev          # dev server (debug flags enabled)
npm test             # full suite
npx tsc --noEmit     # typecheck
npm run falkor:start # local FalkorDB (Docker)
npm run chroma:start # local ChromaDB (Docker)
```

Production configuration is environment-driven; the variable reference lives in the private decision log.
