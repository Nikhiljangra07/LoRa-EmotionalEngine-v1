# CLAUDE.md — LoRa Backend Handover & Project Memory

> This file is the institutional memory for LoRa's backend repository.
> Claude Code reads this automatically at session start.
> **Update the DECISION LOG before every change.**

---


## PROJECT IDENTITY

**LoRa** is an analytical reasoning partner — not a chatbot, not a therapist, not a life coach.

She helps anyone facing hard decisions: career moves, business problems, relationship dilemmas, life direction. She diagnoses root causes, cuts circular thinking, and pushes for decisions. She does NOT validate, mirror emotions, or "hold space."

- **Owner:** Nikhil Jangra (@Nikhiljangra07)
- **Repo:** `LoRa-EmotionalEngine-v1` (this repo is the backend)
- **Frontend repo:** `presence-whispers` (separate repo, React + Vite + Tailwind)
- **Live URL:** `https://presence-whispers-production.up.railway.app`
- **Stage:** Beta testing (launched March 12, 2026)

### Non-Negotiables

1. LoRa is NOT a therapist. Never use therapy language in any response, fallback, or error message.
2. The 6 Laws of LoRa (in `src/emotion-core/policy/LoRaIdentity.ts`) are LAW. No override.
3. No conversation content is stored. Only extracted fact anchors (structured data) persist.
4. The IdentityGuard (`src/emotion-core/policy/IdentityGuard.ts`) runs on every LLM output. It strips forbidden openers and rewrites emotional questions. Never bypass it.
5. Stability over features. LoRa is live with real users. Every change must be safe.
6. Nikhil is solo — no team. Changes must be clean, tested, and minimal.
**Git branch:** Always commit and push to `bugbot-init-review`. Never push to `main` without explicit instruction.
---

## ARCHITECTURE

### Stack

| Component | Technology | Location |
|-----------|-----------|----------|
| Backend server | Express.js + TypeScript | This repo |
| LLM | Anthropic Claude Sonnet 4-6 (runtime), Claude Haiku 4-5 (fact extraction) | `src/emotion-core/llm/ClaudeResponder.ts` |
| Memory — anchors | FalkorDB (Redis-compatible) | Railway service "Redis" |
| Memory — schemas | ChromaDB | Railway service "chroma" |
| Tier persistence | Redis hashes at `lora:tier:{userId}` | Same FalkorDB instance |
| Auth | Supabase Auth (Google OAuth) + JWT verification on backend | Supabase Cloud (`fxjzdlwedcxiavcemnvq.supabase.co`) |
| Frontend | React + Vite + Tailwind + shadcn/ui | `presence-whispers` repo |
| Multi-Perspective Engine | LoRaMaths — Python FastAPI microservice (5 mathematical frameworks) | Railway service "LoRaMaths" (`loramaths.railway.internal`) |
| Hosting | Railway (5 services: Redis, Chroma, LoRa-EmotionalEngine-v1, LoRaMaths, presence-whispers) |
| Analytics | PostHog (backend: `posthog-node`, frontend: `posthog-js`) |
| Domain | `asklora.io` (Cloudflare DNS → Railway) |

### Key Files

| File | Purpose |
|------|---------|
| `src/server/adapter.ts` | Server entry point. Registers routes, middleware, CORS, PostHog shutdown hooks. |
| `src/server/routes/chat.route.ts` | Main `POST /api/chat` handler. Session management, tier check, LLM call, identity guard, PostHog tracking. |
| `src/emotion-core/engines/EngineOrchestrator.ts` | Core engine. Processes messages, manages LLM calls, cooldown, fallbacks, EIV/ETV. ~2280 lines. |
| `src/emotion-core/policy/LoRaIdentity.ts` | The 6 Laws of LoRa. Identity text injected into every prompt. |
| `src/emotion-core/policy/IdentityGuard.ts` | Post-generation guard. Strips therapist openers, narrative openers, emotional questions. Regex only, no LLM. |
| `src/emotion-core/policy/ResponsePolicy.ts` | Word limits, question limits, reasoning depth per tier/band. |
| `src/emotion-core/memory-v1/llmFactExtractor.ts` | Haiku-based fact extraction. Extracts structured facts (business, context, goal, person, identity) from user messages. |
| `src/emotion-core/memory-v1/service/MemoryService.ts` | Orchestrates Falkor anchors + Chroma schemas for memory retrieval. |
| `src/server/tier/TierService.ts` | Tier promotion: TIER_1 (0-2 sessions), TIER_2 (3-9), TIER_3 (10+). Redis-backed with in-memory fallback. |
| `src/server/analytics/posthogClient.ts` | PostHog event capture: session_started, message_sent, session_ended, tier_changed. |
| `src/emotion-core/config/master.constants.ts` | All tuning constants: EIV weights, ETV recovery, LLM timeouts, cooldown settings. |
| `src/emotion-core/config/featureFlags.ts` | ~35 feature flags controlled by env vars. |
| `src/server/auth/supabaseAuth.ts` | Supabase JWT verification middleware. HS256 with jose@4. getEffectiveUserId() for auth/guest dual path. |
| `src/server/auth/inputSanitizer.ts` | Prompt injection filter. 20 patterns, whitespace normalization, strip + log approach. |
| `src/emotion-core/analysis/perspectiveClient.ts` | HTTP client for LoRaMaths microservice. 12s timeout, null fallback. |
| `src/emotion-core/analysis/types.ts` | TypeScript types mirroring LoRaMaths Python response models. |
| `src/server/routes/health.dashboard.route.ts` | `GET /api/health` — mobile-friendly HTML dashboard. Pings 4 services, shows operational counters, response times, active sessions, feature flags, system info. |
| `src/server/analytics/operationalCounters.ts` | 17 in-memory counters (daily reset). Wired into chat, LLM, rate limiter, identity guard, perspective client, session lifecycle, memory V2. |
| `src/server/usage/DailyTokenUsage.ts` | Per-user daily token tracking. In-memory map, 50k limit per user. Resets UTC midnight. |
| `public/index.html` | Dev/debug chat UI (not the production frontend). |

### Request Flow

```
User message → POST /api/chat
  → supabaseAuthMiddleware (verify JWT, attach verifiedUserId)
  → validateBody (sessionId, text, attachments w/ 5MB limit)
  → getEffectiveUserId (JWT sub for auth, body userId for guests)
  → sanitizeInput (strip prompt injection payloads, log matches)
  → rateLimitTryAllow(userId, clientIp) — dual-key for guests
  → getSession (creates EngineOrchestrator if new session)
  → tierService.getTierAsync(userId)
  → getResponsePolicy(tier, etvBand)
  → InputProcessor.process(text) → analyzerOutputs + signalPacket
  → engine.processMessage(analyzerOutputs, ..., history)
    → PromptTemplateBuilder builds system prompt (identity + policy + memory + hints)
    → ClaudeResponder.generateResponse(systemPrompt, userMessage)
    → If LLM fails → cooldown → fallbackResponse() or generateFallbackReply()
  → enforceIdentity(reply)      ← strips therapy language
  → enforceWordLimit(reply)      ← caps word count
  → enforceQuestionLimit(reply)  ← caps question count
  → PostHog trackMessageSent()
  → Response: { reply, tier, sessionCount, debug }
```

### Tier System

| Tier | Sessions | Reasoning Depth | Behavior |
|------|----------|-----------------|----------|
| TIER_1 | 0-2 | `clarify` — gather info before advising | Conservative, asks questions first |
| TIER_2 | 3-9 | `contextual` — grounded suggestions | More engaged, connects information |
| TIER_3 | 10+ | `interpretive` — pattern recognition, strategic | Deep insight, challenges assumptions |

### LLM Fallback & Cooldown

- LLM timeout: 12s (configurable via `LORA_LLM_TIMEOUT_MS`)
- Max retries: 1 (retry only on timeout, network, 429, 5xx)
- Cooldown after failure: 30s (15s in debug mode)
- Recovery at 50% of cooldown: allows retry for short messages/questions
- `fallbackResponse()` returns: "Connection interrupted. State your question again and I will address it directly."
- `generateFallbackReply()` returns context-aware responses based on arousal/valence (no therapy language)

### Environment Variables (Production — Railway)

**LoRa-EmotionalEngine-v1 service:**
```
ANTHROPIC_API_KEY=...
HEALTH_DASHBOARD_TOKEN=...   # Required to view the full /api/health dashboard.
                             # Without it, /api/health is locked to a minimal
                             # public status page (services up/down only).
                             # Pass via ?token=… query or X-Health-Token header.
LLM_PROVIDER=...
LORA_BOOTSTRAP_MEMORY=1
LORA_CHROMA_URL=...
LORA_DAILY_TOKEN_LIMIT=...
LORA_FACT_ANCHOR=1
LORA_FALKOR_URL=...
LORA_MEMORY_SERVICE=1
LORA_PERSONA_ENFORCER=1
LORA_RELATIONAL_ROUTER=1
NODE_OPTIONS=...
POSTHOG_API_KEY=...
SUPABASE_JWT_SECRET=...
```

**LoRaMaths service (separate Railway service, `loramaths.railway.internal`):**
```
LORA_VORTEX_ENABLED=full   # Required for benchmarked quality (41.6/50 Primary Domain A+B).
                           # Without this, quick-mode falls back to plain relay (pre-benchmark pipeline).
```

---

## CURRENT STATE (as of April 1, 2026)

- **Status:** Launch-ready. Public launch planned April 2, 2026 (r/SideProject post prepared).
- **Users:** ~10-15 beta testers (friends, family, family's circles). First public users expected April 2.
- **Domain:** `asklora.io` (Cloudflare DNS, HTTPS enforced)
- **Auth:** Supabase Auth with Google OAuth. JWT verification on backend (`SUPABASE_JWT_SECRET`). Guest mode preserved (rate-limited).
- **Monitoring:** PostHog active (backend events: session_started, message_sent, session_ended, tier_changed; frontend: consent-gated via cookie banner). Health dashboard live at `GET /api/health` (backend Railway URL). Operational counters track 17+ metrics in real-time.
- **Health Dashboard:** `lora-emotionalengine-v1-production.up.railway.app/api/health` — mobile-friendly HTML page showing: services (Redis, Chroma, LoRaMaths, LLM), users (auth/guest split, peak concurrent, avg msgs/user), today's activity (messages, sessions, tokens), response times (avg, p95, min, max), LLM health (success, fallbacks, cooldowns), perspective engine (success, failures, timeouts), safety (prompt injection attempts, identity guard rewrites, rate limits, 500 errors), Memory V2 (consolidation success/failure), system (RSS memory, heap, Node version, env, LLM model/timeout), connections, and 10 feature flags. Auto-refresh toggle (30s). Vancouver timezone.
- **Operational Counters:** `src/server/analytics/operationalCounters.ts` — 17 in-memory counters wired across 7 files. Resets daily UTC. Tracks: messages (processed, relational), LLM (success, fallback cooldown, fallback retry exhausted, cooldown activated), rate limiting (user, IP), identity guard (opener stripped, semantic rewrite, question rewrite), perspective engine (success, failure, timeout), session (cap hit, completed), memory V2 (consolidation success/failure), deep reasoning (completed), input sanitizer (triggered), errors (500). Also tracks unique users (auth/guest split), peak concurrent sessions, response times (rolling 100 samples), last activity timestamp.
- **Security:** Full audit complete. JWT auth, input sanitization (20 prompt injection patterns), IP-aware rate limiting, CSP headers, DOMPurify, session ownership validation, attachment size limits, error leakage fixed.
- **Cookie Consent:** GDPR-compliant banner. PostHog only initializes after explicit user acceptance.
- **Memory V2:** Active mode (`LORA_MEMORY_V2=1`, `LORA_MEMORY_V2_SHADOW=0`). Per-message retrieval: builds EmotionalFingerprint → queries Chroma for similar sessions → injects matching facts into prompt via `RECALLED CONTEXT` block. End-of-session consolidation: summarize → extract facts+fingerprint (Haiku) → verify → store to Falkor (facts) + Chroma (fingerprints) → update profile. Crash-proofed (228 tests, 45s pipeline timeout). Memory V1 (`LORA_MEMORY_SERVICE=0`) is fully offline — V2 is the sole active memory system. Chroma collection uses `embeddingFunction: null` (raw embeddings provided directly).
- **Memory V1:** Disabled (`LORA_MEMORY_SERVICE=0`). `LORA_FACT_ANCHOR=1` is set but gated behind the disabled memory service — anchors are not retrieved. V1 has no consolidation pipeline; only V2 writes back at session end.
- **Multi-Perspective Engine:** Live (`LORA_MULTI_PERSPECTIVE=1`). LoRaMaths Python microservice on Railway (`loramaths.railway.internal`). Quick mode: single Haiku call (classify + framework + condense in one pass, 3-4s). 5 mathematical frameworks (regression, Bayesian, game theory, constraint, causal loop). Condensed insights injected into prompt as invisible analytical context. Feature-flagged with 12s timeout + null fallback.
- **Deep Reasoning Mode:** Live (`LORA_PERSPECTIVE_DEEP_MODE=1`). Three activation paths: (1) UI orbit toggle (one-shot), (2) user accepts LoRa's offer ("Want the full picture?"), (3) clarification response after ambiguous query. Full pipeline: 5 frameworks → 31 combinations scored → Sonnet synthesis (120s timeout). Synthesis bypasses LLM — returned directly as response. Clarification loop: stores original message, auto-enables deep mode, enriches next request. If LoRaMaths fails/times out, falls back to quick-mode LLM call.
- **Image Attachments:** Users can upload images (JPEG, PNG, GIF, WebP) and PDFs. Images render as inline thumbnails in user message bubbles. Base64 data sent to Claude once per message, never stored in session history, never re-sent on subsequent messages. Previous session view strips base64 to avoid localStorage overflow.
- **Knowledge cutoff banner:** Live in both dev UI (`public/index.html`) and production frontend (`presence-whispers`). Text: "LoRa's knowledge is limited to events before early 2025 due to AI model training data."
- **Daily Token Limit:** 50,000 tokens per user per day (`LORA_DAILY_TOKEN_LIMIT=50000`). In-memory tracking, resets UTC midnight. Checked before every LLM call. Resets on Railway redeploy.
- **Anthropic Credits:** $246 balance with auto-reload enabled. Estimated $0.008/message, ~$0.08/session. ~3,000 sessions of runway.

### What's Working

- Session lifecycle: create, chat, terminate, tier promotion
- Authentication: Supabase Google OAuth + guest mode (dual identity system)
- JWT verification: Supabase tokens verified on every API request
- Input sanitization: 20 prompt injection patterns with whitespace normalization
- Rate limiting: per-userId + per-IP for guest users (sliding window)
- Security headers: HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Permissions-Policy, X-Permitted-Cross-Domain-Policies
- Session ownership: terminate endpoint validates requester owns the session
- Memory V2 active: per-message retrieval (EmotionalFingerprint → Chroma similarity → fact injection) + end-of-session consolidation (summarize → extract → verify → store)
- Deep Reasoning Mode: full 5-framework pipeline via LoRaMaths, 120s timeout, synthesis bypasses LLM, clarification loop, one-shot UI toggle
- Multi-Perspective Engine (quick mode): single Haiku call, 3-4s, condensed insights in prompt
- LLM fact extraction via Haiku (with user_name validation guard + morphological filter)
- Identity enforcement: 22 therapist patterns + 11 narrative patterns + semantic detection + emotional question rewrite
- ETV engine: trust value evolves per session
- PostHog analytics: 4 backend events + frontend consent-gated tracking
- Daily token limits (50k/user/day), session cap (25 messages)
- Persona enforcer, relational router, narrative state engine
- Health dashboard: real-time service monitoring, operational counters, response times, user metrics, feature flags
- Image attachments: inline thumbnail rendering, base64 sent once per message, localStorage-safe
- Operational counters: 17 metrics across messages, LLM, rate limits, identity guard, perspective engine, sessions, memory V2

### What's Inactive/Minimal

- Memory V1: fully disabled (`LORA_MEMORY_SERVICE=0`). `LORA_FACT_ANCHOR=1` is set but gated behind disabled service.
- Memory V2 shadow mode: off (`LORA_MEMORY_V2_SHADOW=0`). Was used for validation before V2 went active.
- Appraisal bridge: code exists but minimally active in pipeline
- Appraisal lab engines (collapse, escalation, family, mood, pressure, vector-pressure, post-clarity, time): research code, not in production path
- ETV policy prompt shadow: disabled

---

## TESTER FEEDBACK & BUGS ENCOUNTERED

### Bug: Fallback "I'm here with you" (therapy language in fallback)
- **Reported:** March 15, 2026
- **Cause:** `EngineOrchestrator.fallbackResponse()` was hardcoded to return "I'm here with you. Let's take this one step at a time." — a FORBIDDEN PATTERN per LoRa's own 6 Laws. Also used curly apostrophes that bypassed IdentityGuard regex.
- **Fix:** Replaced with "Connection interrupted. State your question again and I will address it directly." Also rewrote `generateFallbackReply()` to use direct, structural language. Added 8 new forbidden patterns to IdentityGuard.
- **Commit:** `c34b1b8`

### Bug: Wrong user_name extraction (e.g. "Comedy", "Functional" stored as names)
- **Reported:** March 15, 2026
- **Cause:** LLM extraction prompt had no constraint on what constitutes a valid user_name. Haiku extracted random nouns/adjectives as names.
- **Fix:** Added explicit prompt rules ("only extract when user self-introduces"), added `isPlausibleName()` code validator with 50+ blocklisted common words.
- **Commit:** `c34b1b8`

### Bug: LoRa refusing off-topic questions
- **Reported:** Pre-launch
- **Cause:** Identity was too restrictive, blocking any question outside "hard decisions."
- **Fix:** Updated prompt to allow LoRa to engage with any question while maintaining analytical tone.
- **Commits:** `515f9ed`, `f6ef0d9`

### Bug: LoRa being a yes-man / too validating
- **Reported:** During SSB tester stress testing
- **Cause:** Identity rules were soft, 10 rules that were verbose and had loopholes.
- **Fix:** Replaced 10 identity rules with 6 Laws of LoRa — tighter, authoritative, no redundancy.
- **Commit:** `c8592d8`

### Bug: LoRa falling into fallback under sustained pressure
- **Reported:** March 15, 2026 (SSB tester pushing for more points repeatedly)
- **Cause:** Cooldown mechanism too aggressive — one API hiccup cascades into multiple consecutive fallbacks.
- **Status:** OPEN. Monitoring severity. May need shorter cooldown or faster recovery.

### Bug: Connection interrupted for user's mom (Hinglish meditation questions)
- **Reported:** March 16, 2026
- **Cause:** Transient Anthropic API failure + cooldown cascade (same root cause as above)
- **Status:** Resolved on retry. Monitoring frequency.

### Feedback: Users think LoRa doesn't know 2026 events
- **Reported:** March 15, 2026 (multiple testers asking about World Cup, current news)
- **Cause:** Claude's training data cutoff (early 2025)
- **Fix:** Added knowledge cutoff banner in both dev UI and production frontend.
- **Commit:** `876c73c` (dev UI), frontend updated separately

### Bug: Deprecated Haiku model
- **Fixed:** Updated from deprecated Haiku to `claude-haiku-4-5`
- **Commit:** `3d31194`

### Bug: Memory anchors not reaching LLM when ETV disabled
- **Fixed:** Removed band-gating so anchors always reach LLM
- **Commit:** `a6895e3`

### Bug: Double session count on cap + terminate
- **Fixed:** Prevented counting same session twice
- **Commit:** `f1b57f6`

### Bug: Tier/session data lost on redeploy
- **Fixed:** Persisted tier data in Redis hashes
- **Commit:** `df10525`

### Bug: Silent Sonnet 4 fallback — production was NEVER on Sonnet 4.6 until Apr 15, 2026
- **Reported:** April 15, 2026 (triggered by Anthropic deprecation email for `claude-sonnet-4`)
- **Cause:** `LLM_PROVIDER=anthropic` in Railway routes through `AnthropicResponder`, not `ClaudeResponder`. `ANTHROPIC_MODEL` env var was never set, so `AnthropicResponder` silently fell back to its hardcoded default: `claude-sonnet-4-20250514` (Sonnet 4 from May 2025). `ClaudeResponder.ts` was correctly hardcoded to `claude-sonnet-4-6` but was unused. The `ANTHROPIC_API_KEY` env var was set, but the model var was missed. CLAUDE.md docs and `ClaudeResponder.ts` both said Sonnet 4.6 — actual production traffic was on Sonnet 4 the entire time since launch (Mar 12).
- **Impact:** Every session since launch — Dutch father, Polish father, Hinglish regular, Reddit benchmark, the 6-model G-Eval (LoRa 82.4) — was on the older model. The architecture's quality scores were achieved on a weaker LLM. Memory V2 summarizer (`chat.route.ts:349`) was also pinned to the deprecated model.
- **Fix:** Set `ANTHROPIC_MODEL=claude-sonnet-4-6` in Railway. Updated three hardcoded fallbacks (`AnthropicResponder.ts:23`, `chat.route.ts:349`, `reasoningEngine/src/llm/client.py:74`) to match. Verified via deploy log: `[LoRa] Runtime Model: Claude Sonnet 4-6`.
- **Commit:** `53a0910`

---

## DECISION LOG

| Date | What | Why | Commit |
|------|------|-----|--------|
| Pre-launch | Built text-based emotion extraction pipeline (appraisal lab, Ekman-6, NB inference) | Research phase — exploring text-based emotional signal extraction | Various |
| Pre-launch | Text-based extraction pipeline assessed as hitting ceiling | Text signals are limited — users mask emotions in text. Pipeline remains in repo as proof of experimentation | — |
| Mar 12, 2026 | Deployed to Railway, beta testing started | First public beta with friends/family testers | — |
| Mar 12-14 | Fixed anchor storage, identity, persona enforcer, debug leaks, token limits | Rapid bug-fixing from initial tester feedback | Multiple commits |
| Mar 15, 2026 | Replaced 10 identity rules with 6 Laws of LoRa | Old rules were verbose, had loopholes. SSB tester exploited them. | `c8592d8` |
| Mar 15, 2026 | Eliminated fallback therapy patterns | "I'm here with you" was a forbidden pattern appearing in production | `c34b1b8` |
| Mar 15, 2026 | Hardened user_name extraction | LLM extracting random words as names | `c34b1b8` |
| Mar 15, 2026 | Added 8 new forbidden patterns to IdentityGuard | Broader coverage: "take your time", "let's take a step back", "I'm sorry to hear", etc. | `c34b1b8` |
| Mar 15, 2026 | Integrated PostHog analytics (backend) | Need long-term monitoring: session_started, message_sent, session_ended, tier_changed | `1657de1` |
| Mar 15, 2026 | Added knowledge cutoff banner to dev UI | Users confused about LoRa not knowing 2026 events | `876c73c` |
| Mar 15, 2026 | PostHog JS added to frontend (presence-whispers) | Web analytics: pageviews, visitors, session duration | Frontend repo |
| Mar 15, 2026 | Created session_analytics.ts script | Parse Railway logs → JSON analytics (backup to PostHog) | `c34b1b8` |
| Mar 16, 2026 | Purged therapy patterns from relationalResponsePolicy, guarded persona overrides | All relational response templates contained forbidden phrases ("I'm here with you", "I hear you", "your feelings", etc.). Rewrote to analytical voice. Also added enforceIdentity() to early-return relational router path in chat.route.ts — persona overrides were bypassing the identity guard. | `842f3e8` |
| Mar 16, 2026 | Created this CLAUDE.md handover document | Transitioning from Cursor to Claude Code — preserving institutional memory | — |
| Mar 16, 2026 | Added enforceIdentity() inside EngineOrchestrator (defense-in-depth) | Persona enforcer override and main LLM output paths returned raw text without identity guard. chat.route.ts caught it on the outer layer, but EngineOrchestrator itself was unguarded — any direct caller would bypass identity enforcement. Now both paths run enforceIdentity() before returning. | `98a4b4c` |
| Mar 16, 2026 | Fixed session counting for tier promotion on browser close / new session | Sessions were only counted toward tier promotion on session cap (25 msgs). Browser close and new-session replacement never called recordSessionCompletionAsync. Added finalizeSession() with MIN_MESSAGES_FOR_COMPLETION=2 guard, and idle session reaper (30min timeout). | `dda8aaf` |
| Mar 16, 2026 | Added PostHog session_ended to /api/session/terminate | Terminate endpoint recorded tier completion but never fired session_ended PostHog event — analytics blind spot. Added trackSessionEnded with engine metrics and new 'user_terminate' reason. | `21ba24d` |
| Mar 16, 2026 | Added PostHog message_sent for relational router replies | Relational router early-return skipped trackMessageSent — relational messages invisible in analytics. | `f70f171` |
| Mar 16, 2026 | Fixed cooldown cascade — recovery for all users, no timer extension, 30s→15s | Production users had zero recovery path during cooldown (debug-only gate). Failed recovery attempts reset the timer, creating infinite cascade. Removed debug gate, prevented timer extension on recovery failure, halved default cooldown. | `f5951d9` |
| Mar 16, 2026 | Added 90-day Redis TTL on anchor hash keys | Anchors had no expiry — inactive users' data persisted forever. Now `saveState` sets EXPIRE on every save; active users refresh naturally, inactive users auto-expire after 90 days. | `349f331` |
| Mar 17, 2026 | Fixed stale LLM invariants test fixture | Test expected old forbidden fallback text ("I'm here with you"), missing required userId, and empty signalPacket bypassed cooldown. Updated all three. 3/3 pass. | `60f66cc` |
| Mar 17, 2026 | Skip Falkor anchor fetch when LORA_FACT_ANCHOR is off | retrieveContext always hit Falkor even when anchors were disabled — wasted DB call. Added skipAnchors option, orchestrator passes it based on flag. | `2222aa3` |
| Mar 17, 2026 | Drain active sessions on server shutdown (SIGTERM/SIGINT) | Active sessions were silently dropped on redeploy. Now drainSessions() emits engagement logs, PostHog session_ended, and counts tier — before PostHog flush. | `a920660` |
| Mar 17, 2026 | Perspective evaluation: anti-creep principles in RESPONSE PRINCIPLES | Added 2 lines banning consensus blending and requiring distinct path evaluation. Component 1 of 4 in perspective evaluation system. Anti-creep layer 3 (negative constraints). | `f47d01c` |
| Mar 17, 2026 | Perspective evaluation: strategy contracts strengthened | Updated MOMENTUM lines in EXPLORATION, REFRAMING, CLARIFICATION strategies with "do not merge/hedge" directives. Component 2 of 4. Anti-creep layer 4 (format-level). | `4b44903` |
| Mar 17, 2026 | Perspective evaluation: tier-scaled reasoning labels | TIER_1 blocks premature perspectives, TIER_2 names both directions, TIER_3 identifies/evaluates/surfaces tension. Component 3 of 4. Anti-creep layer 2 (policy-level). | `706f400` |
| Mar 17, 2026 | Perspective evaluation: LAW 4 identity reinforcement | Added "evaluate each path on its own terms, never present as equal" to LAW 4. Component 4 of 4. Anti-creep layer 1 (identity-level, highest compliance weight). | `2b32e1f` |
| Mar 17, 2026 | Consequence projection: LAW 5 + RESPONSE STRUCTURE | LAW 5 renamed to "CONSTRAINTS AND CONSEQUENCES" — project concrete consequence of each path. RESPONSE STRUCTURE gains step 3 "Project" between Analyze and Advise. Completes Perspectives → Consequences → Decision chain. | `45d47fe` |
| Mar 17, 2026 | Fixed context bleed on session start | Tester reported LoRa forcing old topics ("You're preparing for SSB", "You're at a grocery shop") when user just said hello. Strengthened FACT CONTEXT + BOOTSTRAP CONTEXT gating to "background ONLY, do NOT lead with it." Added session-start principle. | `9b2161b` |
| Mar 17, 2026 | Added CHALLENGE RULE to identity — anti-capitulation | Claude defaults to "You're right, I apologize" when challenged. CHALLENGE RULE: hold firm without evidence, evaluate honestly with evidence. "Never apologize for a correct analysis." Closes the last adversarial gap. | `b51ab8b` |
| Mar 17, 2026 | Chroma schema 90-day staleness filter | Falkor had 90-day TTL but Chroma had none — split-brain risk for inactive users. Now loadSchemas() filters out schemas older than 90 days, syncing both DBs. | `ee46686` |
| Mar 19, 2026 | Fixed partial responses + topic repetition | Tester reported LoRa answering partially (cut mid-section) and repeating/regressing topics (asked for "Scope Rules", got "Default Arguments"). Root causes: (1) word limits too tight (250-350 words) vs MAX_TOKENS=800 causing 50% post-truncation, (2) naive word-boundary truncation cutting mid-sentence, (3) STM history only 8 turns / 500 chars — lost topic tracking after 4 exchanges. Fixes: raised word limits to 400-500, added sentence-aware truncation, doubled STM to 16 turns / 800 chars, aligned MAX_TOKENS to 1024. | `a23de43` |
| Mar 19, 2026 | Added SCOPE RULE to identity — chunk large requests | LoRa attempted 10 MCQs in one response, got truncated to 1 incomplete question. SCOPE RULE: deliver complete chunks (3-4 items), tell user to ask for next batch. "Never start something you cannot finish in this response." Applies to any user asking for lists/bulk content, not just one tester. | `ad25e9d` |
| Mar 19, 2026 | Expanded name extraction blocklists — "yo" bug | User said "yo" as greeting, LoRa extracted it as user_name and called them "Yo" all session. Added 40+ words to both blocklists (factExtractor.ts + llmFactExtractor.ts): greetings (yo, sup, bruh, howdy), slang (dude, bro, fam), filler (yup, nah, hmm, lol), profanity (damn, shit, fuck), question words (what, how, why), time greetings (morning, evening). | `abd91f7` |
| Mar 21, 2026 | Fixed enforceQuestionLimit killing responses at section headings | LoRa wrote "**Do I believe in God?**" as a section heading before answering — enforceQuestionLimit treated the `?` as a question TO the user and cut everything after it. Response appeared 4× as just the heading with no answer. Fix: skip `?` inside bold markers (`**`) and only count `?` at end of lines/paragraphs. Also raised question limits (B0: 1→2, B2: 2→3, B4: 3→4) and increased LLM timeout from 12s→18s to reduce "Connection interrupted" fallbacks with longer responses. | `37648ae` |
| Mar 21, 2026 | Expanded name blocklists — "Not" and "Preparing" extracted as user_name | Railway logs showed user_name="Not" (from "not fair") and user_name="Preparing" (from "preparing for SSB"). Added 50+ common English words to both blocklists: negations (not, never, nothing), gerunds (going, preparing, working, trying, thinking, feeling), adverbs (actually, really, basically), pronouns (something, everyone, nobody), common verbs (like, want, need, know, think, feel). | — |
| Mar 21, 2026 | Blocked "fucked"/"fucking" from name extraction | Tester said "I'm fucked" → Haiku extracted "Fucked" as user_name. Added profanity to blocklists. | `d6a4f5f` |
| Mar 22, 2026 | Memory V2 architecture designed + implemented | End-of-session summary-based extraction (McGaugh consolidation), emotion-anchored retrieval (Bower mood-congruent), Graph-Vector Hybrid (GraphRAG). 11 components, 218 tests, live-validated with real API (10.9s, $0.02). Built in isolated `~/Desktop/MemoryArchitecture` repo. | MemoryArchitecture repo |
| Mar 23, 2026 | Integrated Memory V2 into backend — shadow mode | Copied V2 code to `src/emotion-core/memory-v2/`. Added `memoryV2Enabled` + `memoryV2ShadowEnabled` flags. Wired `finalizeSession()` to call `processSessionEnd()` (fire-and-forget, MIN_MESSAGES=3). Added `getSessionEIVs()` getter to EngineOrchestrator. Shared existing Falkor client to avoid duplicate connection timeout. | `f7cbe3c`, `dff2970` |
| Mar 23, 2026 | Added V2 shadow debug logging | Temporary scaffolding: logs each pipeline step (summary, facts, fingerprint, verify, complete) with timing and extracted data. Active when `LORA_MEMORY_V2_SHADOW=1`. Remove after shadow validation. | `1d7bd85` |
| Mar 23, 2026 | Multi-Perspective Engine built + validated (LoRaMaths repo) | 4 mathematical reasoning frameworks (regression, Bayesian, game theory, constraint) built in isolated `~/Desktop/LoRaMaths` repo. 10 components, 129 tests, Python. Tested against 3 real tester conversations — frameworks produced genuinely different perspectives with 0 consequence overlap. Frameworks diagnosed LoRa's own rigidity on SSB context bleed test. | LoRaMaths repo |
| Mar 23, 2026 | Added re-contact risk principle | Game theory framework on real breakup conversation caught that LoRa never warned user about breadcrumbing vulnerability. Added response principle: when relationship ends with unresolved attachment, proactively surface re-contact risk. First framework-driven improvement to production LoRa. | `68d0246` |
| Mar 23, 2026 | Built 5th framework: Causal Loop Analysis | Feedback loops, leverage points, accumulations. Catches circular causation the other 4 miss (isolation→distrust→more isolation). 20 tests passing. Validated on breakup fixture — found self-harm normalization loop, medication tolerance drift, rumination cycle. | LoRaMaths repo |
| Mar 23, 2026 | Built condenser — framework output → 2-3 sentences | Haiku call shrinks 200-800 word framework output to max 75 words. Strips jargon, speaks in LoRa's voice. 5/5 frameworks condensed successfully on breakup fixture. | LoRaMaths repo |
| Mar 23, 2026 | Deployed LoRaMaths as Railway microservice | FastAPI server (POST /api/analyze). Python service on Railway with private networking (`loramaths.railway.internal`). LoRa backend calls it via HTTP before prompt build. | LoRaMaths repo |
| Mar 23, 2026 | Multi-perspective bridge integrated into backend | HTTP client with 8s timeout + null fallback. Feature-flagged (`LORA_MULTI_PERSPECTIVE=1`). Perspectives injected into PromptTemplateBuilder as ANALYTICAL FRAMEWORK block after BAND CALIBRATION. If Python service is down, LoRa works exactly as before. | `5fe86c8` |
| Mar 23, 2026 | Fixed conversational flow — removed template structure | First live test showed LoRa presenting "Path 1 / Path 2" report format. Rewrote RESPONSE PRINCIPLES: "surface tension naturally, don't present a menu." Rewrote framework block: "these insights are your thinking, not your output. Absorb them, then CONVERSE." | `9683145` |
| Mar 24, 2026 | Built 6-model benchmark system (LoRaMaths repo) | G-Eval methodology (EMNLP 2023), 10 dimensions, blind evaluation with shuffled labels, triple-run median. 13 conversations (8 synthetic + 3 real tester + 2 Hinglish). Models: GPT-5.4, o3, Claude Opus 4.6, Claude Sonnet 4.6, Grok 4, LoRa. Results: LoRa 42.8/50, GPT-5.4 38.7, Opus 38.5, o3 35.6, Sonnet 35.0, Grok 27.6. Note: rubric is biased toward LoRa's design philosophy (anti-validation, directional clarity, challenge quality) — not a neutral general-purpose benchmark. | LoRaMaths repo |
| Mar 24, 2026 | Fixed consequence projection + actionability (benchmark-identified) | Benchmark showed LoRa scoring 2.92/5 on consequence projection (worst dimension) and 3.92/5 on actionability (GPT-5.4 beat LoRa 4.6 vs 3.9). Root causes: (1) RESPONSE STRUCTURE step 3 had "when paths exist" loophole — Sonnet skipped it, (2) step 4 offered "action OR question" — LoRa always chose question, (3) lightweight requests (gift ideas) got gated behind clarifying questions instead of answered directly. Fixes: made consequence projection mandatory with timeframes, made step 4 action-first, added LIGHTWEIGHT REQUESTS rule to LoRaIdentity.ts. | — |
| Mar 24, 2026 | Fixed name extraction bugs ("Lora", "Hlo", "Hnji") | User said "kesi ho lora" → Haiku extracted LoRa's own name as user_name. "Hlo" extracted as name from greeting. Added "lora", "hlo", "hii", "hnji" to both blocklists (factExtractor.ts + llmFactExtractor.ts). | `7f4fb0b` |
| Mar 24, 2026 | Fixed Memory V2 consolidation JSON parse error | Haiku wrapped JSON in explanatory prose → `parseLLMJson` crashed. Added bracket-depth extraction as fallback — finds first `{`/`[` and walks to matching close, skipping strings. | `7f4fb0b` |
| Mar 24, 2026 | Fixed LoRaMaths perspective URL + classifier crash | `LORA_PERSPECTIVE_URL` was unset/wrong → `fetch failed` on every request. Set to `http://loramaths.railway.internal:8080`. Also fixed `KeyError: None` when classifier returned None for greetings — now returns empty result with 200. | `e70b5c1` (backend), `0f80223` (LoRaMaths) |
| Mar 24, 2026 | Raised perspective timeout 8s → 12s | LoRaMaths pipeline (3 sequential LLM calls) exceeded 8s regularly. 12s accommodates full pipeline while still failing fast on actual outages. | `e70b5c1` |
| Mar 24, 2026 | Single-call pipeline — 3 LLM calls → 1 (LoRaMaths) | Replaced classify→framework→condense (9-12s) with single Haiku call that does all three (3-4s). Heuristic classifier still runs first (free). Same output types — no backend changes needed. Old pipeline.py preserved for deep mode. | `613cf53` (LoRaMaths) |
| Mar 24, 2026 | Tiered perspective design — quick + deep modes | Design decision: default single-call (3-4s) for every message. When problem is complex (high EIV, escalation, multi-turn), LoRa offers "Want the full picture?" If user says yes → full 5-framework pipeline fires on next message. Increases engagement + preserves multi-perspective engine value. Implementation in progress. | — |
| Mar 24, 2026 | Structural name extraction fix — morphological filter replaces blocklist | Blocklist approach was whack-a-mole (100+ words, still leaking "Seeing", "Going", etc.). Root causes: (1) USER_NAME_RE included "i am"/"i'm" — "I'm seeing a therapist" extracted "Seeing" as name, (2) BARE_NAME_RE matched any capitalized word with only a blocklist defense. Fix: removed "i am"/"i'm" from regex (keep only "my name is"/"call me"), replaced blocklist with ENGLISH_SUFFIX_RE (~25 suffix patterns: -ing, -tion, -ment, -ness, -ful, -sed, -ied, etc.). Real names never match these suffixes. Tiny residual blocklist (~45 short irregular words). Verified: 113 English words rejected, 47 real names accepted, 0 errors. Applied to factExtractor.ts, llmFactExtractor.ts, and PromptTemplateBuilder.ts runtime filter. | `522ef92` |
| Mar 24, 2026 | Previous session viewer (frontend) | Testers lost conversations on accidental "New Session" click. Added client-side localStorage persistence: saves current conversation before clearing, "Previous" button shows last session read-only. No backend changes — zero transcript storage. | `6d984de` (presence-whispers) |
| Mar 24, 2026 | Hardened tier system — MIN_MESSAGES guard on all paths | Audit found 4 issues: (1) terminate endpoint counted 0-message sessions toward tier, (2) terminate was duplicate code path missing Memory V2 consolidation, (3) session cap bypassed MIN_MESSAGES guard, (4) constants fragmented across 3 files. Fix: made finalizeSession() async + exportable, single code path for all 5 session-end reasons. Terminate and session cap now call finalizeSession() instead of reimplementing logic. Constants consolidated in src/server/session/constants.ts. Tests updated: 48/48 passing. | `56891cc` |
| Mar 25, 2026 | Expanded benchmark — 20 dimensions, 32 conversations (LoRaMaths) | Upgraded G-Eval benchmark from 10→20 dimensions across 4 categories (Analytical Depth, Conversational Intelligence, Identity & Safety, Practical Impact). Expanded from 13→32 conversations. Results: LoRa 82.4/100, GPT-5.4 74.5, Opus 73.6. Updated Manifesto page on frontend with new data + honest disclosure ("controlled, single-domain benchmark"). | LoRaMaths repo, `d1f39b0` (presence-whispers) |
| Mar 25, 2026 | Deep Reasoning Mode designed + built (LoRaMaths) — Pro tier feature | "Every AI gives deep reasoning on code and productivity. Nobody gives deep reasoning on the person driving those tools." Full 7-step formation architecture: dimension analysis → parallel 5-framework execution → score ALL 31 combinations → conflict graph → dominance check → formation selection → Sonnet synthesis (max_tokens=4096, no word cap). Pay-as-you-go Pro tier. 8 new files in `src/deep/`. First live test: 3 problems, 840-1044 word syntheses, 60-79s latency. Not yet wired to backend — pending UI integration + feature flag. | LoRaMaths repo |
| Mar 25, 2026 | Hardened V2 verifier — compact prompt, prefill retry, pipeline resilience | Production logs showed verifier returning prose instead of JSON (input 1633 chars, extracted 0). Root cause: verbose prompt (~1100 tokens) confused Haiku. Fix: compact prompt (~400 tokens), 3-attempt strategy (standard → prefill with `{` → final prefill), auto-verify only as absolute last resort. Re-extraction block wrapped in try/catch. | `abdbef7` |
| Mar 25, 2026 | Map non-Ekman emotions to nearest Ekman-6 equivalent | Production logs showed `Invalid primary emotion: hope` crashing entire V2 pipeline. LLMs frequently return non-Ekman emotions. Added `mapToEkman()` with 60+ mappings (hope→joy, anxiety→fear, frustration→anger, etc.) + substring partial matching fallback. | `31e3a17` |
| Mar 25, 2026 | Crash-proof V2 memory pipeline — 13 fixes across 10 files | Full forensic audit of all V2 components. Critical: (1) `drainSessions()` now calls `finalizeSession()` so V2 consolidation fires on Railway redeploy, (2) 45s pipeline timeout + 15s per-LLM-call timeout, (3) `stop_reason` truncation detection. High: (4) Chroma `deserializeFingerprint()` try/catch + shape validation, (5) Falkor `pipeline.exec()` error checking + `JSON.parse` guard, (6) NaN guards on similarity scoring and recency boost, (7) Profile EWMA guards NaN/null inputs + `Math.sqrt` negative variance guard, (8) Fixed unsafe type coercion in `validateLLMExtraction`. Pipeline: `Promise.allSettled` for independent extraction + storage, verifier crash tolerance, storage retry with 500ms backoff. 228 V2 tests passing (7 new resilience tests). | `e02b541` |
| Mar 31, 2026 | Custom domain asklora.io + Cloudflare DNS | CNAME record pointing to Railway. CORS allowlist updated to include `https://asklora.io`. HTTPS enforced via Cloudflare "Always Use HTTPS". | adapter.ts |
| Mar 31, 2026 | Switched auth from Clerk to Supabase | Clerk DNS verification stuck for 6+ hours (email DKIM records). Migrated to Supabase Auth with Google OAuth. Frontend: `@supabase/auth-ui-react` with dark theme, Google-only. Backend: Supabase JWT verification middleware. | `d99c385` |
| Mar 31, 2026 | Supabase JWT verification middleware | New `src/server/auth/supabaseAuth.ts`: verifies JWT from Authorization header using HS256 symmetric secret (`SUPABASE_JWT_SECRET`). `getEffectiveUserId()` prioritizes JWT `sub` claim over body userId for authenticated users. Guests pass through (rate-limited). Applied to chat, session lifecycle, and onboarding routes. Added `jose@4` (CJS-compatible). | `d99c385`, `d3deb74` |
| Mar 31, 2026 | Session ownership check on terminate | Terminate endpoint now validates that the requester's userId matches the session owner. Returns 403 if mismatch. Prevents terminating other users' sessions. | `e0c41cd` |
| Mar 31, 2026 | Input sanitization — prompt injection filter | New `src/server/auth/inputSanitizer.ts`: 20 regex patterns covering instruction overrides, role hijacking, system prompt extraction, delimiter injection, jailbreak phrases. Normalizes whitespace + strips invisible unicode before matching. Uses word boundaries + flexible gaps to resist typo/spacing bypass. Strips payloads (doesn't block), logs matched patterns. | `e0c41cd`, `7328be7` |
| Mar 31, 2026 | 4 critical security fixes | (1) Error info leakage: 500 responses no longer expose raw error messages. (2) Guest rate-limit bypass: dual-key rate limiting (per-userId + per-IP for guests). (3) Attachment size: 5MB per-file limit on base64 attachments. (4) Input sanitizer hardening: whitespace normalization, word boundaries, 8 new patterns. | `7328be7` |
| Mar 31, 2026 | Security headers: CSP, Permissions-Policy, X-Permitted-Cross-Domain-Policies | Content-Security-Policy restricts script/style/connect to self, blocks framing. Permissions-Policy disables geolocation, microphone, camera, payment. | `6f56065` |
| Mar 31, 2026 | API key empty-string validation + perspective timeout cleanup | ClaudeResponder: ANTHROPIC_API_KEY validates `.trim()`. perspectiveClient: `clearTimeout` moved before `response.json()` parsing. | `06b14df` |
| Apr 1, 2026 | Health dashboard — `GET /api/health` | Mobile-friendly HTML page showing 4 service statuses (Redis, Chroma, LoRaMaths, LLM) with latency. Accessible from phone for monitoring. No auth required. | `5d43b6a` |
| Apr 1, 2026 | Fixed Chroma health check — use SDK heartbeat | Raw HTTP fetch to guessed `/api/v1/heartbeat` URL failed. Replaced with `getChromaClient().heartbeat()` — same method as startup health checks. | `96d6a17` |
| Apr 1, 2026 | Expanded health dashboard — activity stats, sessions, feature flags | Added: today's sessions/tokens/avg length, active session details (user, messages, duration, tokens, deep mode), 7 key feature flags, refresh button. | `3aaa28b` |
| Apr 1, 2026 | Full health dashboard — Vancouver time, system info, auto-refresh | Time in Vancouver timezone (America/Vancouver). Added: heap/RSS memory bar, Node version, environment, LLM model/timeout, connection status, 10 feature flags, auto-refresh toggle (30s). | `1f17d5d` |
| Apr 1, 2026 | Operational counters — 17 metrics wired across 7 files | New `operationalCounters.ts`: lightweight in-memory counters (daily reset). Wired into chat.route.ts, EngineOrchestrator.ts, ClaudeResponder.ts, IdentityGuard.ts, perspectiveClient.ts, slidingWindowRateLimit.ts. Dashboard shows: LLM Health, Perspective Engine, Safety & Quality, Memory V2 sections with color-coded counters. | `aba5a2b` |
| Apr 1, 2026 | Users section — auth/guest split, peak concurrent, avg msgs | Dashboard shows: active now, total today, signed-in vs guest breakdown, peak concurrent sessions, avg messages per user, deep reasoning completions. | `8d024cf` |
| Apr 1, 2026 | Fixed memory bar — RSS instead of heap percentage | Heap 94% was a false alarm (Node auto-expands from tiny initial allocation). Now shows RSS / 512 MB (Railway container default). | `2b3f6e6` |
| Apr 1, 2026 | Response times, prompt injection tracking, error count, last activity | Response time section: avg, p95, fastest, slowest (rolling 100 samples, color-coded). Prompt injection attempts counter. Server error (500) counter. Last activity timestamp in header. | `2d0772e` |
| Apr 1, 2026 | Fixed Chroma DefaultEmbeddingFunction warning | `getOrCreateCollection()` called without `embeddingFunction` → Chroma tried to load `@chroma-core/default-embed` (not installed) → noisy warning. Fixed with `embeddingFunction: null` since Memory V2 provides raw embeddings via `encodeFingerprint()`. | `5b9b017` |
| Apr 1, 2026 | Image attachment previews in frontend | Previously showed raw filename text `[Screenshot_2026...]`. Now renders inline thumbnails (max 192px height) for images, name pills for documents. Base64 stripped from localStorage saves to prevent 5MB overflow. Attachments stored on `Message.attachments`, no longer prepended to content text. | `84ba25a`, `ed5a8b2` (presence-whispers) |
| Apr 4, 2026 | Stripe pay-as-you-go for deep mode — backend integration | 3 free deep analyses per user, then $3 USD per use. New `DeepModeUsage` service (Redis-backed: `lora:deep:{userId}` hash with `freeUsed`, `paidCredits`, `paidUsed` fields). 3 new routes: `POST /api/deep/check` (status), `POST /api/deep/checkout` (creates Stripe Checkout Session), `POST /api/stripe/webhook` (signature-verified, credits user on `checkout.session.completed`). Webhook registered BEFORE `express.json()` because Stripe signature verification requires raw body. Deep mode gate in chat route blocks before run, consumes credit only after successful analysis (not for clarifications). Fail-open on Redis errors. | `8b99cc3`, `e23a1c1` |
| Apr 4, 2026 | Frontend deep mode unlock UX (test mode) | Orbit button now checks deep mode availability before enabling. If gated, smooth modal slides up with value-first copy ("Deep mode runs your problem through 5 frameworks..."), $3 USD price card, "Continue with Deep Analysis" button. No "0 free uses" confusing text. Click backdrop or "Not now" to dismiss. Stripe Checkout redirect on confirm. `?deep=success` URL handler auto-enables deep mode on return. `chatStream` adapter propagates `deepModeGated` from JSON fallback (was being dropped). | `5094d1d`, `c240a84`, `74aad0f` (presence-whispers) |
| Apr 4, 2026 | Lock deep mode behind dev-only check during Stripe review | Stripe account in "Review in progress" state — to prevent user confusion, gated orbit behind `isDevUser` check until live. All pay-as-you-go code stayed in place. | `40c3606` (presence-whispers) |
| Apr 6, 2026 | Stripe live mode activated — deep mode unlocked for all signed-in users | Stripe account verified. Created live product `prod_UHmPexBgsoRNt6` and price `price_1TJCrM6di7OvLJsXLQOMp6aH` ($3 USD one-time). Live webhook configured. Railway env vars switched from test to live keys. Frontend `isDevUser` check replaced with `!isGuest` — deep mode now available to all authenticated users. | `f4e3d46` (presence-whispers) |
| Apr 6, 2026 | Surface Stripe checkout errors in unlock modal | Checkout was failing silently — button stuck loading. Now red error banner shows actual backend error (e.g. `payment_not_configured`, `auth_required`). `createDeepCheckout` extracts `body.error`/`body.message` from response instead of dropping it. | `8e656db` (presence-whispers) |
| Apr 6, 2026 | Fix `auth_required` on deep mode routes — body userId fallback | Frontend wasn't sending `userId` in body, and new Stripe routes only used JWT verification (which silently fails on Railway in some cases). Updated `/api/deep/check` and `/api/deep/checkout` to use `getEffectiveUserId(req, req.body?.userId)` matching the `/api/chat` pattern. Frontend now sends `USER_ID` in body. | `b01706d`, `6ee6dee` (presence-whispers) |
| Apr 6, 2026 | Preserve session + messages across Stripe checkout redirect | After payment, users were thrown into a fresh session — losing conversation history and original problem context. Now sessionId + messages saved to `localStorage` (`lora_pending_session`, `lora_pending_messages`) before Stripe redirect, restored on `?deep=success` return. Backend reuses same engine entry (in-memory, 30min idle timeout). Stripe checkout typically 1-2 min — well within window. | `f9740c7` (presence-whispers) |
| Apr 6, 2026 | Deep mode UX polish — toast on return + cancelled cleanup | Subtle emerald toast slides from top on `?deep=success`: "Welcome back. Send your message — Deep Mode is ready." Auto-dismisses in 5s. On `?deep=cancelled`, removes `lora_pending_*` localStorage keys to prevent stale state. | `presence-whispers` |
| Apr 7, 2026 | Client-side chat history sidebar (ChatGPT/Claude-style) | Tester reported losing conversation context after Stripe checkout redirect — wanted ChatGPT-style sidebar to browse and resume past sessions. Built `chatHistory.ts` lib (load/save/delete entries, auto-prune to 50 sessions, strip base64 attachments to keep storage small, relative time formatting). Hamburger menu in header opens slide-in drawer matching LoRa's dark monospace aesthetic. Auto-save on every message change. Click to load → restores messages visually. All client-side — backend stores ZERO conversation content (only Memory V2 fact anchors as before). | `9c88311` (presence-whispers) |
| Apr 7, 2026 | Backend session rehydration — `rehydrateHistory` param on `/api/chat` | Sidebar restore had a hidden flaw: clicking an old chat → setSessionId → backend `getSession` could return a fresh empty engine (if reaped via 30min idle or redeploy). User would see old messages visually but LoRa would respond with no memory. Added `rehydrateHistory: Array<{role, text}>` body param. Backend populates `session.history` from it ONLY when the in-memory entry has zero history (never overwrites live state). Frontend stages `pendingRehydrateRef` on sidebar load + Stripe restore, sends with next chatStream call, restores on failure. Capped at STM_MAX_TURNS=16, 800 chars per turn. | `8a92b83` (backend), `b08342f`, `3168563` (presence-whispers) |
| Apr 7, 2026 | Sidebar aligned with LoRa session model — "New session" lifecycle | Initial sidebar borrowed ChatGPT terminology ("chat", "New chat") but LoRa runs on sessions with proper lifecycle (each completed session increments `sessionCount`, may promote tier). Renamed: header "Sessions", button "New session", empty state "No sessions yet". The button now invokes `terminateSessionBridge()` (same backend lifecycle as the header New Session button) — backend finalizer fires PostHog `session_ended`, increments tier counter (if ≥2 msgs), runs Memory V2 consolidation (if ≥3 msgs), then starts a fresh session. Header New Session button now also writes to chat history sidebar so the just-completed session appears immediately. Cleanup: removed duplicate `saveChatHistoryEntry` call from sidebar handler — `terminateSessionBridge` already handles it. UX inspiration is ChatGPT/Claude, semantics are pure LoRa. | `e3466ff` (presence-whispers) |
| Apr 15, 2026 | Migrated production from Sonnet 4 → Sonnet 4.6 (forced by deprecation discovery) | Anthropic deprecation email for `claude-sonnet-4` (retires Jun 15, degraded availability May 14) triggered an audit that revealed production had been running on Sonnet 4, not 4.6, since launch. `LLM_PROVIDER=anthropic` routes through `AnthropicResponder` whose hardcoded fallback was `claude-sonnet-4-20250514`, and `ANTHROPIC_MODEL` env var was never set. Set env var + updated three hardcoded fallbacks to `claude-sonnet-4-6`. Confirmed via deploy log. **Implication:** all prior benchmarks (6-model G-Eval, reasoningEngine 15-question benchmark, every tester case) were on the weaker model — quality is expected to improve from this point. Cost will rise proportionally (4.6 is more expensive per token). | `53a0910` (backend), `62fb923` (reasoningEngine, local) |
| Apr 21, 2026 | Closed b3_actionability escape hatch in RESPONSE STRUCTURE step 4 | 7-model benchmark (LoRaMaths, 32 conversations, blind-eval, triple-run median) showed LoRa won Primary Domain A+B (41.6/50 vs GPT-5.4 41.5) AND won Categories A (21.3/25) and D (23.5/25) outright — but regressed on b3_actionability to 3.6/5 (from 3.92 in the Mar 24 fix). Per-dimension reasoning revealed the pattern is bimodal: 14 conversations at 5/5 (clean decision problems) + 4 complete failures at 1/5 (R-01 breakup/self-harm, R-02 AI debate, E-02 extreme-short, H-07 love marriage family conflict). Root cause: step 4 had an escape hatch ("if you genuinely need more information first, name exactly what and how to get it") that LoRa was taking under ambiguity, ending on diagnosis or a clarifying question alone. Fix: tightened step 4 to make action MANDATORY even under ambiguity, expanded forbidden soft-verbs ("examine," "consider," "sit with," "journal about"), added fallback verb templates with concrete placeholders ("talk to [person] about [topic]," "call [number/role]"), and now requires pairing any clarifying question with a concrete action. Voice block (rule 3 "ONE BEAT PER RESPONSE") and Vortex pipeline unchanged — the fix is surgical to the one line that was being over-interpreted. Type check clean. | (this change) |
| Apr 21, 2026 | Router V2 pipeline design + trivial coverage parity | Finalized the post-Router-V2 pipeline contract: trivial tier skips LoRaMaths entirely (Haiku direct, ~2s); lightweight and substantive both hit LoRaMaths quick-mode `/api/analyze`, which internally runs the **Vortex pipeline** (3 peripheral models — Nano/Haiku/Flash-Lite — + pattern-retriever SSM + sonnet synthesizer) when `LORA_VORTEX_ENABLED=full` is set on the LoRaMaths Railway service. This is the exact pipeline that scored 41.6/50 on Primary Domain A+B in the 7-model benchmark (the "LoRa pipeline: Vortex (full) + Voice block + Memory V2" combo). No backend code change needed for Vortex — it's a single env var on LoRaMaths. Also closed v1 parity gaps in `TRIVIAL_WHOLE_MESSAGE` / `SESSION_OPENER_RE`: added farewells (bye, goodbye, see ya, ttyl, later, cya, farewell), locale greetings (good morning/afternoon/evening/night), and Indic greetings (namaste, namaskar, salaam). Router smoke test 14/14 passing; typecheck clean. **Required env var for benchmarked quality: `LORA_VORTEX_ENABLED=full` on LoRaMaths Railway service.** Without it, LoRaMaths quick-mode falls back to the single-call relay (Nano→Haiku→Flash-Lite without the Vortex aggregator) which was the pre-benchmark pipeline. | (this change) |
| Apr 24, 2026 | Code-review fix #1: aligned B0/B1 anchor docstring + tests with intended behavior | The `getAnchorContextBlock` docstring still said "Band B0/B1 anchors are filtered out" but the actual `ELIGIBLE_BANDS` set has covered all five bands since commit a6895e3 (Mar 11, 2026). Two stale tests in `PromptTemplateBuilder.anchorRendering.test.ts` still asserted the old filter and would have masked any regression toward the original "anchors blocked when ETV disabled" bug. Restoring the filter would re-introduce that bug, so the fix updates the docstring + tests to match the post-Mar-11 intended behavior (B0–B4 all eligible; only undefined-band anchors and morphologically-invalid user_name anchors are dropped). Also fixed an unrelated stale assertion in the same file expecting "Does this relate to what you mean today?" — that trailer was replaced by the "background context ONLY" guard on Mar 17 (commit 9b2161b). 15/15 tests pass; typecheck clean. | (this change) |
| Apr 24, 2026 | Code-review fix #2: gated `/api/health` full dashboard behind `HEALTH_DASHBOARD_TOKEN` | The dashboard was unauthenticated and exposed `sessions` (with user-id fragments, message counts, duration, tokens), `flags`, `system`, and `counters` to anyone who could reach the URL. Pre-launch this was fine; post-launch on `asklora.io` it would have been one screenshot away from a Twitter incident. Now: public path returns only the four service statuses (Redis, Chroma, LoRaMaths, LLM) plus an overall `ok`/`degraded` string — safe for load balancers and uptime monitors; full dashboard requires the token via `?token=…` query OR `X-Health-Token` header. Token comparison uses `crypto.timingSafeEqual`. If `HEALTH_DASHBOARD_TOKEN` is unset, the route stays locked to public mode regardless of input — secure default — and a startup warning is logged. **Required action on Railway:** set `HEALTH_DASHBOARD_TOKEN` on LoRa-EmotionalEngine-v1 and update the phone bookmark URL to include `?token=…`. | (this change) |
| Apr 21, 2026 | Lightweight tier promoted Haiku → Sonnet + two router rules wired (clarification_continuation, sustained_emotional_context) | Three follow-up changes after Router V2 review: (1) **Lightweight tier model swap**: lightweight messages now route to Sonnet instead of Haiku. After the b3_actionability fix in `LoRaIdentity.ts`, Haiku was the bottleneck — short ambiguous inputs (E-02, R-02, H-07 patterns) would default to lightweight tier and hit Haiku, which doesn't reliably honour the new "MANDATORY action even under ambiguity" rule. Sonnet adds ~1-2s on top of LoRaMaths quick-mode latency but delivers full prompt obedience. Counter renamed `route_haiku_lightweight` → `route_sonnet_lightweight`. Trivial tier stays on Haiku (greetings/acks don't need Sonnet, ~2s latency win is worth it). (2) **`inClarificationLoop` wiring**: closed dead plumbing — the flag was passed to the router but never read. New rule at priority 0.5 (after crisis): when user is mid-clarification on a prior deep-mode question, never trivialize the reply — promote to substantive (`reason='clarification_continuation'`). Without this, "yes" or "the second one" after a deep question would route to trivial → Haiku direct → skip LoRaMaths, breaking the deep flow. (3) **`recentEIVs` wiring**: closed dead plumbing — last 3 EIVs were passed but never read. New rule at priority 7.5 (after eiv_solo_promotion): when mean recent EIV > 0.4, promote to substantive (`reason='sustained_emotional_context'`). Catches "yeah" after several emotionally heavy turns where vocabulary has cooled but session weight remains. Factual-shell guard preserved. All three changes type-check clean and align with the router's stated bias-deep philosophy ("overshooting is recoverable, undershooting destroys trust"). | (this change) |
| Apr 22, 2026 | Stripe subscription backend — CA$19.99/mo monthly model replacing legacy $3/use | New `src/server/subscription/SubscriptionService.ts` (Redis-backed `lora:sub:{userId}` hash, fail-open on read errors, `isActive` includes canceled-but-within-paid-period). New `src/server/routes/subscription.route.ts` with 3 endpoints: `/api/subscription/status`, `/checkout` (creates Stripe Checkout Session in subscription mode, returns 409 if already subscribed), `/portal` (creates Customer Portal session). New `src/server/routes/stripe.route.ts` with signature-verified webhook at `/api/stripe/webhook` handling `customer.subscription.{created,updated,deleted}` → mirrors to Redis via `upsertSubscription`. Webhook registered BEFORE `express.json()` at adapter.ts:84 because signature verification requires raw body. Deep mode gate in chat.route.ts:835 calls `isActiveSubscriber(userId)` before the LoRaMaths deep call — returns 402 `subscription_required` with structured error. Founder bypass via `UNLIMITED_USERS` Set. Feature-flagged via `LORA_SUBSCRIPTION_ENABLED`. New env vars: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SUB_PRICE_ID`. | `6dfae9a` |
| Apr 22, 2026 | Legacy $3/use deep mode flow removed | Deleted `src/server/usage/DeepModeUsage.ts` entirely. Removed `/api/deep/check` and `/api/deep/checkout` routes from `stripe.route.ts` (collapsed to just the webhook handler). Removed `createStripeRouter` export + its registration in `adapter.ts`. Zero users had paid for $3/use, so the rip-out was safe. Post-sweep grep for `DeepModeUsage`, `createDeepCheckout`, `/api/deep/check`, `deepModeGated` returns only a single comment/docstring line explaining the removal. | `e32c748` |
| Apr 22, 2026 | Tier rename Depth → Pro across user-visible surfaces | 402 gate message: "Deep Mode requires a Depth subscription" → "Pro subscription. CA$19.99/mo, cancel anytime." `SubscriptionService.ts:4` internal docstring still references "LoRa Depth" — comment-only, user-invisible, harmless. | `3ab5723` |
| Apr 22, 2026 | Founder bypass disabled then restored — end-to-end Stripe pipeline validated with a real payment | Temporarily commented out Nikhil's userId in `UNLIMITED_USERS` to test the full checkout → webhook → Redis mirror → gate unlock path as a real paying customer. Real CA$19.99 charge went through, Stripe webhook fired, Redis state mirrored, Deep Mode gate unlocked. Founder bypass restored immediately after verification. Pre-launch smoke test confirmed webhook signature enforcement LIVE: `POST /api/stripe/webhook` with no signature → HTTP 400 `{"error":"missing_signature"}`. | `c023ba6`, `05f0fdb` |
| Apr 22, 2026 | Bumped perspective client timeouts — quick 15s, Vortex full 60s | Quick-mode timeout raised 12s → 15s to absorb LoRaMaths latency variance (Vortex adds 3 classifier calls + SSM retrieval + Sonnet aggregator). Deep-mode Vortex pipeline timeout raised to 60s to align with the frontend's 60-second UI promise ("Deep reasoning takes up to 60 seconds"). Also silenced noisy Chroma `@chroma-core/default-embed` warning — Memory V2 provides raw embeddings, so `embeddingFunction: null` on `getOrCreateCollection`. | `51f94ff`, `e87c292` |
| Apr 22, 2026 | Pre-launch system audit — GO verdict | Full audit before r/SideProject launch: typecheck both repos clean, all 3 repos pushed, health dashboard shows All Systems Operational (Redis 2ms, Chroma 67ms, LoRaMaths 64ms), subscription gate fires before deep call, webhook order correct, webhook signature enforcement verified LIVE, dead-code sweep clean (only docstring/comment hits), rate limiter + input sanitizer both active in chat route, founder bypass confirmed. Known risks to watch at launch: LLM cooldown cascade under load (monitored via `fallback_cooldown` counter), Anthropic credit burn, LoRaMaths deep pipeline timeout under parallel load. | (this change) |

---

## ROADMAP

### Immediate (launch week — April 2-9, 2026)
- **Launch on r/SideProject** — April 2, 2026. Post prepared. Story-based, not product description.
- **Monitor health dashboard** — bookmark backend `/api/health` on phone. Watch for: LLM fallback spikes, response time degradation, rate limit hits, identity guard rewrites, 500 errors.
- **Monitor PostHog** — session counts, message engagement, tier promotions, session termination reasons.
- **Bug triage only** — fix production bugs as reported. No proactive feature work during launch week.
- **Anthropic credits** — $246 balance, auto-reload enabled. Monitor daily spend via dashboard tokens counter.

### Short-term (1-3 months)
- **Observation mode:** Collect 3 weeks of stability data from real users before next feature push.
- **Read "Venture Deals"** by Brad Feld — study fundraising mechanics.
- **Waveform Engine MVP** — voice-based emotional signal extraction
  - Extract: pitch mean, pitch variance, speech rate, pause ratio (start with 4 features)
  - Map to Ekman-6 emotional families (same dimensions LoRa uses)
  - Test against labeled dataset (RAVDESS, CREMA-D, or EMO-DB)
  - Time-boxed: 3 months maximum
  - Deliverable: script (audio in → emotion prediction out) + accuracy documentation
  - NOT a production system. Proof of concept only.
- **Reddit expansion** — r/startups, r/artificial (after r/SideProject data is in)

### Long-term vision
- Multimodal emotional intelligence: text + voice combined
- Pitch narrative: "Text failed (proof in repo) → Waveform MVP (proof of concept) → Combined multimodal = the moat"
- Voice interface makes LoRa the only AI that adapts to HOW you think, not just WHAT you say

---

## DEVELOPMENT COMMANDS

```bash
# Dev server
npm run dev

# Build
npm run build

# Start (production)
npm start

# Tests
npm test                                    # All tests
npx jest identity.guard --no-coverage       # Specific test file
LORA_TEST_VERBOSE=1 npm test                # Verbose

# Local services
npm run falkor:start                        # Start FalkorDB (Docker)
npm run chroma:start                        # Start ChromaDB (Docker)

# Type check
npx tsc --noEmit

# Analytics script (parse Railway logs)
npx ts-node scripts/session_analytics.ts railway_logs.txt
```

---

## WARNINGS & FRAGILE AREAS

1. **EngineOrchestrator.ts is ~2280 lines.** Be careful with changes. The cooldown logic, fallback paths, and LLM retry logic are interconnected.
2. **IdentityGuard uses smart quotes in some test fixtures.** The production fallback text uses straight quotes. Don't mix them.
3. **FalkorDB is used as both Redis (tier storage, key-value) and graph DB (anchors).** The anchor storage was migrated from GRAPH.QUERY to plain Redis hashes (`commit 40327e0`). Don't reintroduce graph queries.
4. **`public/index.html` is NOT the production frontend.** The production UI is in the `presence-whispers` repo. Changes to `public/index.html` only affect the dev/debug chat page.
5. **Curly apostrophes (Unicode `\u2019`) in EngineOrchestrator.ts.** Some strings use curly quotes from earlier code. The StrReplace tool in Cursor cannot match them directly. Use Python or sed with exact byte matching if you need to edit those lines.
6. **The appraisal-lab directory has massive amounts of duplicate files** (e.g., `file 2.ts`, `file 3.ts`, `file 4.ts` up to `file 7.ts`). These are accidental copies. They are excluded from tsconfig via patterns. Do not delete them without explicit instruction — they don't affect the build.
7. **Railway logs:** When using `railway logs`, make sure to select the **LoRa-EmotionalEngine-v1** service, NOT Redis. Redis logs are just background saves with zero LoRa data.
8. **Model identity is split across THREE places — all must agree.** `ANTHROPIC_MODEL` env var in Railway is the source of truth (read by `AnthropicResponder` because `LLM_PROVIDER=anthropic`). `ClaudeResponder.ts:7` is hardcoded for the alternate provider path (currently unused). `chat.route.ts:349` summarizer model is hardcoded with no env override. If any of these three drifts apart, production silently runs the wrong model — this is exactly what happened from Mar 12 → Apr 15, 2026. On any model change: update env var **and** both hardcoded references, then verify the startup log line `[LoRa] Runtime Model: …`.
9. **Benchmarked quality requires `LORA_VORTEX_ENABLED=full` on the LoRaMaths Railway service.** The 41.6/50 Primary Domain A+B result was measured with the Vortex pipeline (3 peripheral models + SSM pattern retriever + Sonnet synthesizer) serving LoRaMaths quick-mode. If this env var drifts to `off` or `shadow`, quick-mode silently degrades to the plain relay (no aggregator, no pattern retrieval) — same class of silent regression as the Sonnet 4.6 drift. This lives on the LoRaMaths service, NOT the backend. Verify via LoRaMaths deploy log: `[Vortex full] fw=… src=…` lines should appear on every non-trivial request.

---

## POSTHOG SETUP

- **Backend:** `posthog-node` in `src/server/analytics/posthogClient.ts`
  - Events: `session_started`, `message_sent`, `session_ended`, `tier_changed`
  - Env var: `POSTHOG_API_KEY` (set in Railway → LoRa-EmotionalEngine-v1 → Variables)
- **Frontend:** `posthog-js` in `presence-whispers/src/main.tsx`
  - Auto-captures: `$pageview`, clicks, sessions
  - Env var: `VITE_POSTHOG_KEY` (set in Railway → presence-whispers → Variables)
- **Dashboard:** `us.posthog.com` — PostHog Cloud, free tier (1M events/month)
- **Authorized domain:** Add `presence-whispers-production.up.railway.app` in PostHog settings

---

*Last updated: April 24, 2026 (Code-review fixes: B0/B1 anchor docstring + /api/health token gate)*
*Branch: bugbot-init-review*
