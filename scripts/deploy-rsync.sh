#!/usr/bin/env bash
# scripts/deploy-rsync.sh <source-folder> <destination>
# Uploads the folder made by `npm run build:deploy` (the website) or `npm run build:cron` (the cron jobs) to the host.
#   website:     user@host:domains/azcarpool.nl/public_html/
#   test site:   user@host:domains/test.azcarpool.nl/public_html/   (only for a folder made by `build:deploy:test`)
#   cron jobs:   user@host:azcarpool-cron/          (outside the web folder; recognised by run.sh in the source folder)
#   or a local folder as destination (used by the tests)
#   RSYNC_SSH:   the ssh command to use, e.g. "ssh -p 26 -i key -o StrictHostKeyChecking=yes"
# Safety:
#   - refuses a remote destination that is not exactly the matching folder (the same account holds other sites);
#     a build says in .deploy-target (never uploaded) whether it is live or test: a test build can never reach the live folder and the other way round;
#   - uploads everything except index.html and service-worker.js first, then those two last, so a phone never
#     gets a new start page or service worker that points to files that are not there yet; with DEPLOY_CHECK_SITE set it also
#     checks in between that the site really serves every NEW file, and stops before those two if not;
#   - removes files that are no longer part of the app, but never touches .well-known (certificate checks), cgi-bin or agenda (the calendar files that cron/agenda.mjs makes).
set -euo pipefail

src="${1:?usage: deploy-rsync.sh <source-folder> <destination>}"
dest="${2:?usage: deploy-rsync.sh <source-folder> <destination>}"
src="${src%/}/"
case "$dest" in */) ;; *) dest="$dest/" ;; esac

if [ -f "${src}run.sh" ]; then
  mode=cron; remote_re='^[^:/]+@[^:/]+:azcarpool-cron/$'; remote_name='azcarpool-cron/'
elif [ -f "${src}index.html" ] && [ -f "${src}service-worker.js" ]; then
  mode=web
  target=live
  if [ -f "${src}.deploy-target" ]; then target=$(tr -d '[:space:]' < "${src}.deploy-target"); fi
  case "$target" in
    live) remote_re='^[^:/]+@[^:/]+:domains/azcarpool\.nl/public_html/$'; remote_name='domains/azcarpool.nl/public_html/' ;;
    test) remote_re='^[^:/]+@[^:/]+:domains/test\.azcarpool\.nl/public_html/$'; remote_name='domains/test.azcarpool.nl/public_html/' ;;
    *) echo "ERROR: ${src}.deploy-target says '$target' (expected live or test)" >&2; exit 1 ;;
  esac
else
  echo "ERROR: ${src} does not look like an upload folder (no run.sh, and no index.html + service-worker.js). Run: npm run build:deploy (or build:cron)" >&2
  exit 1
fi
if [[ "$dest" == *:* ]] && [[ ! "$dest" =~ $remote_re ]]; then
  echo "ERROR: refusing to upload to '$dest'. For this folder the remote folder must be exactly $remote_name" >&2
  exit 1
fi

if [ "$mode" = cron ]; then
  # Code only: private to the account owner. No secrets or data live here, so --delete is safe.
  opts=(-rlt --human-readable --itemize-changes --chmod=D700,F600)
  if [ -n "${RSYNC_SSH:-}" ]; then opts+=(-e "$RSYNC_SSH"); fi
  echo "== cron jobs"
  rsync "${opts[@]}" --delete "$src" "$dest"
  echo "== done"
  exit 0
fi

opts=(-rlt --human-readable --itemize-changes --chmod=D755,F644 --exclude=/.well-known/ --exclude=/cgi-bin/ --exclude=/agenda/ --exclude=/.deploy-target)
if [ -n "${RSYNC_SSH:-}" ]; then opts+=(-e "$RSYNC_SSH"); fi

echo "== pass 1: everything except the start page and the service worker"
pass1_log=$(mktemp)
rsync "${opts[@]}" --exclude=/index.html --exclude=/service-worker.js "$src" "$dest" | tee "$pass1_log"
# Between the two passes: is every NEW file really served? A file that did not exist on the host before (seen 2026-11-14 with a new folder:
# 404 for a few minutes after the upload) must be reachable BEFORE the start page and the service worker start pointing to it; otherwise
# the app would not start. Only the new files are asked for (rsync marks them +++++++++): a changed file was already served, and asking
# for every file at each upload (116 requests in a row) made the host answer the next request with something else than the file
# (seen 2026-11-14: the version check after the upload then failed). One request per new file, with a short pause in between.
# DEPLOY_CHECK_SITE=https://azcarpool.nl switches the check on (the workflows do); it waits up to DEPLOY_CHECK_TRIES x DEPLOY_CHECK_WAIT seconds.
if [ -n "${DEPLOY_CHECK_SITE:-}" ]; then
  site="${DEPLOY_CHECK_SITE%/}"; tries="${DEPLOY_CHECK_TRIES:-30}"; pause="${DEPLOY_CHECK_WAIT:-10}"; gap="${DEPLOY_CHECK_GAP:-0.5}"
  files=$(grep -E '^[<>]f\+{9} ' "$pass1_log" | sed -E 's/^[<>]f\+{9} //' | grep -vE '(^|/)\.[^/]*$' | sort || true)
  count=$(printf '%s\n' "$files" | grep -c . || true)
  if [ "$count" = 0 ]; then echo "== check: no new files in this upload, nothing to ask the site"
  else
    echo "== check: the $count new file(s) are served by $site"
    for attempt in $(seq 1 "$tries"); do
      missing=""
      while IFS= read -r f; do
        [ -n "$f" ] || continue
        code=$(curl -s -o /dev/null --max-time 20 -w '%{http_code}' "$site/$f" || true)
        [ "$code" = 200 ] || missing="$missing $f($code)"
        sleep "$gap"
      done <<< "$files"
      if [ -z "$missing" ]; then echo "   all $count new files are served"; break; fi
      echo "   attempt $attempt of $tries, not served yet:$missing"
      if [ "$attempt" = "$tries" ]; then echo "ERROR: these files are uploaded but not served by $site:$missing. The start page and the service worker were NOT replaced: the site still runs the previous version." >&2; rm -f "$pass1_log"; exit 1; fi
      sleep "$pause"
    done
  fi
fi
rm -f "$pass1_log"

echo "== pass 2: start page, service worker, and clean-up of files that are gone"
rsync "${opts[@]}" --delete "$src" "$dest"
echo "== done"
