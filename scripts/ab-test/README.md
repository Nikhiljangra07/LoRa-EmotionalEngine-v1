# A/B Test Lab (Non-Intrusive)

Diagnostic harness to compare **GPT-4o** and **Claude 3.5 Sonnet** using the same system prompt, user message, and temperature. No production code paths, EngineOrchestrator, PromptTemplateBuilder, NSE, or RSC are modified.

## Setup

Ensure `.env.local` (or `.env`) contains:

- `OPENAI_API_KEY=...` — for `npm run ab:gpt`
- `ANTHROPIC_API_KEY=...` — for `npm run ab:claude`

## Commands

- `npm run ab:gpt` — run GPT-4o with system + user messages, temperature 0.6
- `npm run ab:claude` — run Claude 3.5 Sonnet with same prompt and temperature 0.6

## Optional: temperature 0.75

To compare variance at higher temperature, edit `scripts/ab-test/test-gpt4o.ts` and `scripts/ab-test/test-claude.ts` and set `temperature: 0.75`, then run both again and compare outputs.

## Files

- `generateSystemPrompt.ts` — builds a real system prompt via `PromptTemplateBuilder.build()` with minimal fixed inputs (B0, CALM_NEUTRAL, validation strategy). No LLM calls.
- `test-gpt4o.ts` — calls OpenAI Responses API with `input: [system, user]`, max_output_tokens 400, temperature 0.6.
- `test-claude.ts` — calls Anthropic Messages API with `system` + `messages: [user]`, max_tokens 500, temperature 0.6.
