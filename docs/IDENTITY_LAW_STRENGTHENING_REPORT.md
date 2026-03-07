# Identity-Law Strengthening — Implementation Report

## A. Files changed

| File | Change |
|------|--------|
| **`src/emotion-core/policy/LoRaIdentity.ts`** | Added PRECEDENCE block and IDENTITY LAW block to the canonical `LORA_IDENTITY` string. |
| **`src/emotion-core/policy/ResponsePolicy.ts`** | Replaced TIER_1 “Assistant principles” with strengthened TIER_1 principles (approachable, not agreeable). |

No other files were modified. Fallback text, IdentityGuard, deployment config, memory/storage, and unrelated tests were not changed.

---

## B. Exact rules added

### 1. LoRaIdentity.ts — PRECEDENCE (law over overlays)

```
PRECEDENCE (law over overlays):
- This identity law overrides any supportive, stabilizing, or tone overlay elsewhere in the prompt.
- Support may soften tone; it must NOT remove truthfulness, analytical pressure, or strategic correction.
- When in doubt, preserve clarity and correct reasoning over comfort.
```

### 2. LoRaIdentity.ts — IDENTITY LAW (hard rules)

```
IDENTITY LAW (hard rules):
- LoRa does not flatter, blindly validate, or agree for rapport.
- LoRa does not reinforce false assumptions just to be comforting.
- If the user is wrong, vague, evasive, contradictory, or strategically weak, LoRa must challenge, clarify, or correct with measured directness.
- LoRa remains calm and controlled — not emotional or submissive.
```

### 3. ResponsePolicy.ts — TIER_1 principles (replacing previous “Assistant principles”)

**Previous (removed):**
- Prioritize clarity over validation
- Remain respectful and empathetic
- Do not endorse harmful intent
- Encourage reasoning and explanation

**New (TIER_1 — approachable, not agreeable):**
- Do not default to agreement or validation. Remain analytical.
- Prioritize clarity over validation. Remain respectful but not submissive.
- If the user is wrong, vague, evasive, or strategically weak, clarify or correct with measured directness.
- Do not reinforce false assumptions for comfort. Do not flatter or agree for rapport.
- Do not endorse harmful intent. Encourage reasoning and explanation.

---

## C. Why this reduces yes-man drift

1. **Explicit precedence** — The prompt now states that identity law overrides supportive/stabilizing/tone overlays. So when DE_ESCALATE, STABILIZE, or SUPPORTIVE_REFLECTION say “do not challenge directly” or “avoid probing,” the model is instructed that truthfulness and analytical pressure still apply; support can only soften tone, not remove correction.

2. **Hard identity law** — “Does not flatter, blindly validate, or agree for rapport” and “does not reinforce false assumptions for comfort” are stated as non-negotiable. “If the user is wrong, vague, evasive, contradictory, or strategically weak, LoRa must challenge, clarify, or correct” makes corrective behavior mandatory, not optional.

3. **TIER_1 no longer soft-default** — TIER_1 previously had only four short principles and no “challenge” or “do not agree” language. It now explicitly says “Do not default to agreement or validation,” “clarify or correct with measured directness,” and “Do not flatter or agree for rapport,” so new users get the same anti–yes-man stance as higher tiers, in a shorter block.

4. **Single canonical source** — The identity law and precedence live in `LORA_IDENTITY`, which is prepended first in `formatPolicyBlock()` in every request. PromptTemplateBuilder’s guidance overlays come later in the same system message, so the model sees “law over overlays” before those overlays.

---

## D. Possible side effects

1. **Stronger pushback for TIER_1** — TIER_1 users may notice more clarification and correction and less default validation. Desired for reducing yes-man behavior; if product wants TIER_1 to stay “softer,” product can revisit the wording (e.g. keep “approachable” but tune how often to correct).

2. **Overlay tension** — In high-escalation or stabilizing modes, the model now has two instructions: “do not challenge directly” (overlay) vs “identity law overrides overlays; preserve analytical pressure.” We explicitly chose identity over overlay. In edge cases the model might still soften more than intended; if so, a future step could add a response-side check (e.g. IdentityGuard) for agreement-only replies.

3. **Prompt length** — LORA_IDENTITY is longer. Token use per request increases slightly. Impact is small relative to the rest of the system prompt.

4. **Tests** — `identity.guard.test.ts` (LORA_IDENTITY contract and formatPolicyBlock order) passed. The TIER_1 block still contains “Prioritize clarity over validation,” so existing assertions that check for that phrase (e.g. in `etv.band.injection.test.ts`) remain valid. No test was changed.

---

## E. Diff-style summary

```diff
--- src/emotion-core/policy/LoRaIdentity.ts
+++ src/emotion-core/policy/LoRaIdentity.ts
@@ -12,6 +12,18 @@ LoRa is NOT:
 - an emotional validation engine

+PRECEDENCE (law over overlays):
+- This identity law overrides any supportive, stabilizing, or tone overlay elsewhere in the prompt.
+- Support may soften tone; it must NOT remove truthfulness, analytical pressure, or strategic correction.
+- When in doubt, preserve clarity and correct reasoning over comfort.
+
+IDENTITY LAW (hard rules):
+- LoRa does not flatter, blindly validate, or agree for rapport.
+- LoRa does not reinforce false assumptions just to be comforting.
+- If the user is wrong, vague, evasive, contradictory, or strategically weak, LoRa must challenge, clarify, or correct with measured directness.
+- LoRa remains calm and controlled — not emotional or submissive.
+
 Primary function:
 Provide clear, logical analysis that helps the user reach accurate conclusions.
```

```diff
--- src/emotion-core/policy/ResponsePolicy.ts
+++ src/emotion-core/policy/ResponsePolicy.ts
@@ -124,11 +124,14 @@ export function formatPolicyBlock(policy: ResponsePolicy): string {
     );
   } else {
     lines.push(
       '',
-      'Assistant principles:',
-      '- Prioritize clarity over validation',
-      '- Remain respectful and empathetic',
-      '- Do not endorse harmful intent',
-      '- Encourage reasoning and explanation',
+      'Assistant principles (TIER_1 — approachable, not agreeable):',
+      '- Do not default to agreement or validation. Remain analytical.',
+      '- Prioritize clarity over validation. Remain respectful but not submissive.',
+      '- If the user is wrong, vague, evasive, or strategically weak, clarify or correct with measured directness.',
+      '- Do not reinforce false assumptions for comfort. Do not flatter or agree for rapport.',
+      '- Do not endorse harmful intent. Encourage reasoning and explanation',
     );
   }
```

---

## Canonical identity and TierBehaviorProfile

- **Canonical identity** is **`src/emotion-core/policy/LoRaIdentity.ts`**. It is the single source for the “[SYSTEM IDENTITY — NON-NEGOTIABLE]” block, including the new PRECEDENCE and IDENTITY LAW. It is prepended to every system prompt via `formatPolicyBlock()` in ResponsePolicy.ts; PromptTemplateBuilder’s “You are LoRa…” block and guidance overlays appear after it in the same system message. No other file defines a competing “identity”; persona enforcer and relational policy are for deterministic overrides on specific intents, not the main LLM identity.

- **TierBehaviorProfile** (`src/server/behavior/TierBehaviorProfile.ts`) was not wired in this step. It remains unused in the prompt path. Its TIER_1 instruction (“Always begin with emotional validation”, “Do NOT challenge”) would conflict with the new identity law; if it is ever used, it should be aligned with this identity or removed.
