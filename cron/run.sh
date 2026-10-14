#!/usr/bin/env bash
# cron/run.sh <backup|matches|purge|agenda|push|selftest> — what the cron jobs on the host call.
# Finds a Node.js 20+ (the host has several places for it), then runs the job.
# Prints one line on success; problems go to stderr with exit code 1 (DirectAdmin mails them).
set -euo pipefail
here="${BASH_SOURCE[0]%/*}"; [ "$here" = "${BASH_SOURCE[0]}" ] && here="."
here="$(cd "$here" && pwd)"

case "${1:-}" in backup|matches|purge|agenda|push|selftest) ;; *) echo "usage: run.sh backup|matches|purge|agenda|push|selftest" >&2; exit 2 ;; esac

best=""; bestv=0
for c in "$(command -v node 2>/dev/null || true)" "$HOME"/nodevenv/*/*/bin/node /opt/alt/alt-nodejs*/root/usr/bin/node /usr/local/bin/node /usr/bin/node; do
  [ -n "$c" ] && [ -x "$c" ] || continue
  v=$("$c" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  case "$v" in ''|*[!0-9]*) v=0 ;; esac
  if [ "$v" -gt "$bestv" ]; then best="$c"; bestv="$v"; fi
done
if [ "$bestv" -lt 20 ]; then echo "ERROR: no Node.js 20 or newer found on this host" >&2; exit 1; fi

case "${1:-}" in
  backup)   exec "$best" "$here/backup.mjs" ;;
  matches)  exec "$best" "$here/match-calendars.mjs" ;;
  purge)    exec "$best" "$here/purge.mjs" ;;
  agenda)   exec "$best" "$here/agenda.mjs" ;;
  push)     exec "$best" "$here/push.mjs" ;;
  selftest) echo "node: $best (v$bestv)"; exec "$best" "$here/selftest.mjs" ;;
esac
