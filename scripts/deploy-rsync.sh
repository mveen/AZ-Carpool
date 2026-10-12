#!/usr/bin/env bash
# scripts/deploy-rsync.sh <source-folder> <destination>
# Uploads the folder made by `npm run build:deploy` to the web host.
#   destination: user@host:domains/azcarpool.nl/public_html/   (or a local folder, used by the tests)
#   RSYNC_SSH:   the ssh command to use, e.g. "ssh -p 26 -i key -o StrictHostKeyChecking=yes"
# Safety:
#   - refuses a remote destination that is not the azcarpool.nl web folder (the same account holds other sites);
#   - uploads everything except index.html and service-worker.js first, then those two last, so a phone never
#     gets a new start page or service worker that points to files that are not there yet;
#   - removes files that are no longer part of the app, but never touches .well-known (certificate checks) or cgi-bin.
set -euo pipefail

src="${1:?usage: deploy-rsync.sh <source-folder> <destination>}"
dest="${2:?usage: deploy-rsync.sh <source-folder> <destination>}"
src="${src%/}/"
case "$dest" in */) ;; *) dest="$dest/" ;; esac

if [ ! -f "${src}index.html" ] || [ ! -f "${src}service-worker.js" ]; then
  echo "ERROR: ${src} does not look like the upload folder (index.html or service-worker.js missing). Run: npm run build:deploy" >&2
  exit 1
fi
if [[ "$dest" == *:* ]] && [[ ! "$dest" =~ ^[^:/]+@[^:/]+:domains/azcarpool\.nl/public_html/$ ]]; then
  echo "ERROR: refusing to upload to '$dest'. The remote folder must be exactly domains/azcarpool.nl/public_html/" >&2
  exit 1
fi

opts=(-rlt --human-readable --itemize-changes --chmod=D755,F644 --exclude=/.well-known/ --exclude=/cgi-bin/)
if [ -n "${RSYNC_SSH:-}" ]; then opts+=(-e "$RSYNC_SSH"); fi

echo "== pass 1: everything except the start page and the service worker"
rsync "${opts[@]}" --exclude=/index.html --exclude=/service-worker.js "$src" "$dest"
echo "== pass 2: start page, service worker, and clean-up of files that are gone"
rsync "${opts[@]}" --delete "$src" "$dest"
echo "== done"
