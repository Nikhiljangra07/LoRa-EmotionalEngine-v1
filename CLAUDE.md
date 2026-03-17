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
| Frontend | React + Vite + Tailwind + shadcn/ui | `presence-whispers` repo |
| Hosting | Railway (4 services: Redis, Chroma, LoRa-EmotionalEngine-v1, presence-whispers) |
| Analytics | PostHog (backend: `posthog-node`, frontend: `posthog-js`) |
| Domain | `presence-whispers-production.up.railway.app` |

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
| `public/index.html` | Dev/debug chat UI (not the production frontend). |

### Request Flow

```
User message → POST /api/chat
  → validateBody (userId, sessionId, text)
  → rateLimitTryAllow(userId)
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

```
ANTHROPIC_API_KEY=...
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
```

---

## CURRENT STATE (as of March 16, 2026)

- **Status:** Live in beta, observation mode
- **Users:** ~10-15 testers (friends, family, family's circles)
- **Monitoring:** PostHog active (backend events: session_started, message_sent, session_ended, tier_changed; frontend: $pageview via posthog-js)
- **Known active issue (mitigated):** Fallback "Connection interrupted" on Anthropic API hiccups. Cooldown cascade fix deployed (`f5951d9`): recovery enabled for all users, timer no longer extends on failed recovery, cooldown halved to 15s. Monitoring for residual occurrences.
- **Knowledge cutoff banner:** Live in both dev UI (`public/index.html`) and production frontend (`presence-whispers`). Text: "LoRa's knowledge is limited to events before early 2025 due to AI model training data."

### What's Working

- Session lifecycle: create, chat, terminate, tier promotion
- Memory: Falkor anchors persist across sessions, Chroma schemas for context
- LLM fact extraction via Haiku (with user_name validation guard)
- Identity enforcement: 22 therapist patterns + 11 narrative patterns + semantic detection + emotional question rewrite
- ETV engine: trust value evolves per session
- PostHog analytics: 4 backend events + frontend pageview tracking
- Rate limiting, daily token limits, session cap (25 messages)
- Persona enforcer, relational router, narrative state engine

### What's Inactive/Minimal

- Appraisal bridge: code exists but minimally active in pipeline
- Appraisal lab engines (collapse, escalation, family, mood, pressure, vector-pressure, post-clarity, time): research code, not in production path
- Memory v1 shadow mode: disabled
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

---

## ROADMAP

### Immediate (next 2-3 weeks)
- **Observation mode:** Monitor PostHog data, fix bugs as reported, no proactive feature work
- **Read "Venture Deals"** by Brad Feld — study fundraising mechanics
- **Study Reddit/Discord communities** — learn engagement patterns before posting (r/SideProject, r/startups)
- **Do NOT distribute on Reddit/Discord yet** — wait for 3 weeks of stability data

### Short-term (1-3 months)
- **Waveform Engine MVP** — voice-based emotional signal extraction
  - Extract: pitch mean, pitch variance, speech rate, pause ratio (start with 4 features)
  - Map to Ekman-6 emotional families (same dimensions LoRa uses)
  - Test against labeled dataset (RAVDESS, CREMA-D, or EMO-DB)
  - Time-boxed: 3 months maximum
  - Deliverable: script (audio in → emotion prediction out) + accuracy documentation
  - NOT a production system. Proof of concept only.
- **Reddit/Discord launch** — when PostHog shows 3 weeks of stable data
  - Story-based post, not product description
  - Target: r/SideProject, r/startups, r/artificial

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

*Last updated: March 16, 2026*
*Total commits in repo: 584*
*Branch: bugbot-init-review*
