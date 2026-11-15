#!/usr/bin/env bash
# .github/scripts/check-site.sh <live|test> <site> <upload-folder>
# After an upload: does the site hold the new version? Used by deploy.yml and deploy-test.yml.
#
# It asks the site itself (the way a phone does). But the host (mijn.host) sometimes answers a robot with its own wait page
# ("One moment, please...", a bot check) instead of the file, for minutes at a time (seen 2026-11-14: the upload had succeeded,
# the check failed and the cron jobs were not uploaded). So for each file: ask the site a few times; if the answer is still the
# wait page, read that file on the host itself over SSH instead, and say so in the log. Anything else that is wrong (an old
# version, an error page, a missing file) still fails.
#
#   SITE_SSH     the ssh command up to and including user@host (e.g. "ssh -p 26 -i key ... user@host"); without it there is no fallback
#   REMOTE_DIR   the web folder on the host (e.g. domains/azcarpool.nl/public_html/)
#   CHECK_TRIES  how often to ask the site per file for the NEW version (default 6), CHECK_WAIT seconds in between (default 10)
#   CHECK_WAIT_TRIES  how often to ask the site per file while it answers with the wait page (default 2) before reading on the host instead.
#                The wait page lasts minutes, so asking 6 times only cost 50 s per file (about 160 s per deploy); once one file had to be read on
#                the host, the other files go there after a single ask.
set -euo pipefail

target="${1:?usage: check-site.sh <live|test> <site> <upload-folder>}"
site="${2:?usage: check-site.sh <live|test> <site> <upload-folder>}"; site="${site%/}"
dist="${3:?usage: check-site.sh <live|test> <site> <upload-folder>}"; dist="${dist%/}"
case "$target" in live|test) ;; *) echo "::error::first argument must be live or test (got $target)"; exit 2 ;; esac
tries="${CHECK_TRIES:-6}"; pause="${CHECK_WAIT:-10}"; wait_tries="${CHECK_WAIT_TRIES:-2}"
remote="${REMOTE_DIR:-}"; remote="${remote%/}"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
used_host=0

is_wait_page() { grep -q 'One moment, please' "$1" 2>/dev/null; }

# fetch <path> <file>: the file as the site serves it, in <file>; the answer line (status, size, type) in <file>.info.
# When the site keeps answering with the wait page: the file as it is on the host (then <file>.info says "host").
fetch() {
  local path="$1" out="$2" attempt n="$wait_tries"
  # The host's wait page is not per file: once one file had to be read on the host, ask the site only once more for the others.
  if [ "$used_host" = 1 ]; then n=1; fi
  for attempt in $(seq 1 "$n"); do
    curl -s -o "$out" --max-time 20 -H 'Cache-Control: no-cache' -w 'HTTP %{http_code}, %{size_download} bytes, type %{content_type}' "$site/$path" > "$out.info" || true
    if ! is_wait_page "$out"; then return 0; fi
    echo "   $site/$path: the wait page of the host (try $attempt of $n)"
    [ "$attempt" = "$n" ] || sleep "$pause"
  done
  if [ -z "${SITE_SSH:-}" ] || [ -z "$remote" ]; then
    echo "::error::$site keeps answering with the wait page of the host (its bot check), and there is no SSH fallback configured"; return 1
  fi
  echo "::warning::$site/$path: the host keeps answering with its wait page (bot check). Reading the file on the host itself instead."
  # shellcheck disable=SC2086
  $SITE_SSH "cat '$remote/$path'" > "$out" || { echo "::error::could not read $remote/$path on the host"; return 1; }
  echo "host" > "$out.info"; used_host=1
}
from_web() { [ "$(cat "$1.info")" != host ]; }
version_in() { grep -oE "CACHE_NAME *= *'[^']+'" "$1" | head -1 || true; }

expected=$(version_in "$dist/service-worker.js")
[ -n "$expected" ] || { echo "::error::no CACHE_NAME in $dist/service-worker.js"; exit 1; }
echo "Expected: $expected"

# 1. The service worker: the new version. An OLD version may be the host still catching up, so that is asked again a few times.
for attempt in $(seq 1 "$tries"); do
  fetch service-worker.js "$tmp/sw"
  now=$(version_in "$tmp/sw")
  echo "Attempt $attempt, $target: ${now:-nothing}$(from_web "$tmp/sw" || echo ' (read on the host)')"
  if [ "$now" = "$expected" ]; then break; fi
  if [ "$attempt" = "$tries" ] || ! from_web "$tmp/sw"; then
    echo "The site answered: $(cat "$tmp/sw.info")"; head -c 300 "$tmp/sw" | tr -d '\r' || true; echo
    echo "::error::$site does not serve the new service worker"; exit 1
  fi
  sleep "$pause"
done

# 2. The start page (and for the test site: its own database).
fetch index.html "$tmp/index"
grep -q "$site/app.js" "$tmp/index" || { echo "::error::start page does not point to $site/app.js"; exit 1; }
if [ "$target" = test ]; then
  grep -q 'class="envBar"' "$tmp/index" || { echo "::error::the test banner is missing: this is not the test build"; exit 1; }
  fetch firebase-config.js "$tmp/config"
  if grep -q 'projectId: *"az-carpool"' "$tmp/config"; then echo "::error::the test site points to the LIVE database"; exit 1; fi
else
  fetch app.js "$tmp/app"
  if from_web "$tmp/app"; then
    echo "app.js: $(cat "$tmp/app.info")"
    grep -qi 'javascript' "$tmp/app.info" || { echo "::error::app.js is not served as JavaScript"; exit 1; }
  else
    grep -q "^import " "$tmp/app" || { echo "::error::app.js on the host does not look like the app"; exit 1; }
  fi
fi

if [ "$used_host" = 1 ]; then echo "OK: the host holds $expected (checked on the host itself: the site answered the robot with its wait page)"
else echo "OK: $site serves $expected"; fi
