#!/usr/bin/env bash
# Fails when app files changed but CACHE_NAME in service-worker.js did not.
# Without a new CACHE_NAME, phones keep showing the old version of the app.
# Usage: check-cache-bump.sh <base-ref>   (e.g. origin/main)
set -euo pipefail
base="${1:?base ref required}"
mb=$(git merge-base "$base" HEAD)

# Files that do not need a bump: tests, docs, CI, repo housekeeping.
changed=$(git diff --name-only "$mb" HEAD \
  | grep -vE '^(tests/|\.github/|README\.md$|\.gitignore$|package\.json$|tests\.lock\.json$|run-tests\.js$|test-count\.js$)' || true)

if [ -z "$changed" ]; then
  echo "No app files changed: no CACHE_NAME bump needed."
  exit 0
fi

name_of() { grep -oE "CACHE_NAME *= *'[^']+'" | head -1; }
old=$(git show "$mb:service-worker.js" | name_of || true)
new=$(name_of < service-worker.js || true)

echo "CACHE_NAME before: ${old:-?}"
echo "CACHE_NAME now:    ${new:-?}"
if [ -z "$new" ] || [ "$old" = "$new" ]; then
  echo "::error file=service-worker.js::App files changed but CACHE_NAME was not bumped. Raise it by one (e.g. v20 -> v21)."
  echo "Changed app files:"; echo "$changed"
  exit 1
fi
echo "OK: CACHE_NAME was bumped."
