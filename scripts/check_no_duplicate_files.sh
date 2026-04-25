#!/usr/bin/env bash
# Fail the build if numbered Finder/VS Code save-as duplicates
# (e.g. "adapter 2.ts", "STABILITY 3.md") get tracked again.
#
# Usage: bash scripts/check_no_duplicate_files.sh
# Exit 0 if clean, 1 with a listing if duplicates are found.
#
# This complements .gitignore (which prevents NEW additions); this
# script catches ones that slip through if .gitignore is bypassed
# with `git add -f` or similar.

set -euo pipefail

dups="$(git ls-files | grep -E ' [2-9]\.[a-z]+$' || true)"

if [ -z "$dups" ]; then
  echo "OK: no numbered duplicate files tracked."
  exit 0
fi

count="$(echo "$dups" | wc -l | tr -d ' ')"
echo "FAIL: $count numbered duplicate file(s) tracked. These look like" >&2
echo "macOS Finder / VS Code save-as duplicates — remove them with:" >&2
echo "  git rm <file>" >&2
echo "" >&2
echo "$dups" >&2
exit 1
