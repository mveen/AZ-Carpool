#!/usr/bin/env bash
# .github/scripts/probe-host.sh <site-host> [path]
# READ-ONLY probe of mijn.host (used by .github/workflows/host-probe.yml, started by hand). It uploads, changes and deletes nothing.
#
# Question: when the host shows its wait page ("One moment, please...", Imunify360 WebShield, a bot check) to this GitHub computer,
# is there a way to reach the web server from the INSIDE that still returns the real file? Three ways are tried, each round, next to a control:
#   control   the normal request from this computer (the one the robot test makes). Tells us whether the host is blocking right now.
#   server    curl run ON the host over SSH, to the host's own address (127.0.0.1) with the site's name
#   tunnel    an SSH port forward (ssh -L) from this computer to the host's port 443, then a request through it with the site's name:
#             the real certificate and the real server settings, which is what the robot test would need
#   tunnel80  the same for port 80 (plain http, Host header)
# Each answer is called REAL-FILE (the service worker, with CACHE_NAME), WAIT-PAGE (the bot check), NO-ANSWER or OTHER(...).
# A round where the control says REAL-FILE proves nothing (the host was not blocking then): look at rounds where the control says WAIT-PAGE.
#
#   SSH_CMD    the ssh command without the destination (e.g. "ssh -p 26 -i key -o IdentitiesOnly=yes ...")
#   SSH_DEST   user@host
#   ROUNDS     how many rounds (default 3), ROUND_GAP seconds in between (default 30)
set -uo pipefail

classify() {   # <body-file> <http-code>
  if [ ! -s "$1" ]; then echo "NO-ANSWER(HTTP ${2:-?})"
  elif grep -q 'One moment, please' "$1"; then echo "WAIT-PAGE"
  elif grep -q 'CACHE_NAME' "$1"; then echo "REAL-FILE"
  else echo "OTHER(HTTP ${2:-?}, $(wc -c < "$1" | tr -d ' ') bytes)"; fi
}

# split_answer <output-with-marker> <body-file>: puts the body in the file, prints the HTTP code (the marker is added by curl -w).
split_answer() {
  local out="$1" code
  code="${out##*\[HTTP }"; code="${code%%\]*}"
  printf '%s' "${out%$'\n'\[HTTP *}" > "$2"
  echo "$code"
}

main() {
  local host="${1:?usage: probe-host.sh <site-host> [path]}" path="${2:-service-worker.js}"
  local rounds="${ROUNDS:-3}" gap="${ROUND_GAP:-30}"
  : "${SSH_CMD:?SSH_CMD is required}" "${SSH_DEST:?SSH_DEST is required}"
  local tmp; tmp=$(mktemp -d); trap "rm -rf '$tmp'" EXIT
  local fmt='\n[HTTP %{http_code}]'
  local summary=""
  say() { echo "$*"; summary="$summary$*"$'\n'; }

  echo "== is curl on the host?"
  # shellcheck disable=SC2086
  $SSH_CMD "$SSH_DEST" 'command -v curl && curl --version | head -1' 2>&1 | head -3 || true

  local r
  for r in $(seq 1 "$rounds"); do
    echo; echo "== round $r of $rounds"
    local out code control server tunnel tunnel80 pid i err

    # control: the request from this computer
    out=$(curl -sS --max-time 20 -w "$fmt" "https://$host/$path" 2>&1); code=$(split_answer "$out" "$tmp/c"); control=$(classify "$tmp/c" "$code")

    # server: curl on the host itself, https with the site's name pointed at the host's own address
    # shellcheck disable=SC2086
    out=$($SSH_CMD "$SSH_DEST" "curl -sS --max-time 20 --resolve $host:443:127.0.0.1 -w '$fmt' https://$host/$path" 2>&1); code=$(split_answer "$out" "$tmp/s"); server=$(classify "$tmp/s" "$code")

    # tunnel: ssh -L to the host's port 443 (https, real certificate) and to port 80 (http, Host header)
    for kind in 443 80; do
      local lport=$((18000 + kind)) result
      err="$tmp/tunnel-$kind.err"; : > "$err"
      # shellcheck disable=SC2086
      $SSH_CMD -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=10 -L "127.0.0.1:$lport:127.0.0.1:$kind" "$SSH_DEST" 2> "$err" &
      pid=$!
      result=""
      for i in $(seq 1 20); do
        if ! kill -0 "$pid" 2>/dev/null; then result="TUNNEL-NOT-OPENED"; break; fi
        if (exec 3<>"/dev/tcp/127.0.0.1/$lport") 2>/dev/null; then break; fi
        sleep 0.5
      done
      if [ -z "$result" ]; then
        if [ "$kind" = 443 ]; then out=$(curl -sS --max-time 20 --resolve "$host:$lport:127.0.0.1" -w "$fmt" "https://$host:$lport/$path" 2>&1)
        else out=$(curl -sS --max-time 20 -H "Host: $host" -w "$fmt" "http://127.0.0.1:$lport/$path" 2>&1); fi
        code=$(split_answer "$out" "$tmp/t$kind"); result=$(classify "$tmp/t$kind" "$code")
        if grep -qiE 'prohibited|not allowed|refused' "$err"; then result="FORWARDING-REFUSED-BY-HOST"; fi
      fi
      kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
      [ "$kind" = 443 ] && tunnel="$result" || tunnel80="$result"
      if [ -s "$err" ]; then echo "   (ssh said, port $kind: $(head -c 200 "$err" | tr '\n' ' '))"; fi
    done

    say "round $r: control=$control | server=$server | tunnel443=$tunnel | tunnel80=$tunnel80"
    [ "$r" = "$rounds" ] || sleep "$gap"
  done

  echo; echo "== summary"; printf '%s' "$summary"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then { echo '### Host probe (read-only)'; echo; printf '%s' "$summary" | sed 's/^/- /'; } >> "$GITHUB_STEP_SUMMARY"; fi
  return 0
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
