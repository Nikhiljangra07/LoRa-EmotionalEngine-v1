#!/bin/sh
# smoke.sh — Minimal stability smoke test for LoRa backend.
# Requires: curl, grep (standard POSIX tools).
# Usage:    npm run check:smoke   (server must be running on localhost:3000)
# Important: this script does NOT print environment variables or secrets.

set -e

BASE="http://localhost:3000"
PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); printf "  PASS  %s\n" "$1"; }
fail() { FAIL=$((FAIL + 1)); printf "  FAIL  %s\n" "$1"; }

echo ""
echo "=== LoRa Smoke Test ==="
echo ""

# ── 0. Server reachable ────────────────────────────────────────
printf "Checking server at %s ...\n" "$BASE"
if ! curl -sf -o /dev/null --max-time 5 "$BASE/health/llm"; then
  echo ""
  echo "  FAIL  Server not reachable at $BASE"
  echo ""
  echo "Start the server first:  npm run dev"
  exit 1
fi
echo ""

# ── 1. GET /health/llm ────────────────────────────────────────
echo "[1] GET /health/llm"

HEALTH=$(curl -sf --max-time 5 "$BASE/health/llm" 2>/dev/null || true)

if [ -z "$HEALTH" ]; then
  fail "/health/llm returned empty response"
else
  # Check for required keys in the JSON response
  if printf '%s' "$HEALTH" | grep -q '"openai"'; then
    pass "response contains \"openai\""
  else
    fail "response missing \"openai\""
  fi

  if printf '%s' "$HEALTH" | grep -q '"lastSuccess"'; then
    pass "response contains \"lastSuccess\""
  else
    fail "response missing \"lastSuccess\""
  fi
fi

echo ""

# ── 2. POST /chat ─────────────────────────────────────────────
echo "[2] POST /chat"

CHAT=$(curl -sf --max-time 15 \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"message":"hello"}' \
  "$BASE/chat" 2>/dev/null || true)

if [ -z "$CHAT" ]; then
  fail "/chat returned empty response"
else
  if printf '%s' "$CHAT" | grep -q '"reply"'; then
    pass "response contains \"reply\""
  else
    fail "response missing \"reply\""
  fi
fi

echo ""

# ── Summary ───────────────────────────────────────────────────
TOTAL=$((PASS + FAIL))
echo "=== Results: $PASS/$TOTAL passed ==="

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "$FAIL check(s) failed."
  exit 1
fi

echo ""
echo "All checks passed."
exit 0
