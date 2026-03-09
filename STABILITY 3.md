# Stability Lock — v0.1

## 1. Confirmed Working Behavior

- Backend responds to `POST /chat` with `{ reply: string }`.
- UI renders backend replies correctly.
- System works with and without LLM availability (fallback path tested).
- No streaming, no sessions, single-turn stateless behavior from the frontend's perspective.

## 2. Explicit Non-Goals

- No memory persistence across process restarts.
- No multi-turn backend state over HTTP (session adapter is ephemeral and in-memory only).
- No authentication.
- No emotional guarantees — the engine performs signal processing, not clinical assessment.

## 3. Change Policy

- Any modification to the chat contract (`POST /chat` request/response shape) **requires** corresponding test updates.
- Any refactor below the adapter layer must not alter externally observable behavior.
- If tests fail, stability is considered broken.

## 4. Tag Reference

This document corresponds to tag: **v0.1-stable**
