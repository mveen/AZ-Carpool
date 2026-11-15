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
#   -pub      the same, but to the server's own PUBLIC address instead of 127.0.0.1 (the connection is then made by the server itself)
#   -k        the same with the certificate check off (the certificate on the host's own port 443 does not match the site's name)
# Answers that are neither are shown (first 300 characters, and the headers of the tunnel answers: who answers, WebShield or the web server behind it).
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

# show <label> <body-file>: the first part of an answer that is neither the real file nor the wait page (error text, status page), one line.
show() {
  [ -s "$2" ] || return 0
  echo "   $1 said: $(head -c 300 "$2" | tr '\r\n\t' '   ' | tr -s ' ')"
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
  echo "== which ports does the host listen on (only the listing, nothing is changed)?"
  # shellcheck disable=SC2086
  $SSH_CMD "$SSH_DEST" '(ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | head -40' 2>&1 | head -45 || true

  # the public address of the site (the same one the control request uses)
  local pubip; pubip=$(getent ahostsv4 "$host" 2>/dev/null | awk '{print $1; exit}')
  echo "== public address of $host: ${pubip:-not found}"

  local r
  for r in $(seq 1 "$rounds"); do
    echo; echo "== round $r of $rounds"
    local out code control server serverpub tunnelpub serverk tunnel tunnelk tunnel80 root80 pid i err

    # control: the request from this computer
    out=$(curl -sS --max-time 20 -w "$fmt" "https://$host/$path" 2>&1); code=$(split_answer "$out" "$tmp/c"); control=$(classify "$tmp/c" "$code")

    # server: curl on the host itself, https with the site's name pointed at the host's own address
    # shellcheck disable=SC2086
    out=$($SSH_CMD "$SSH_DEST" "curl -sS --max-time 20 --resolve $host:443:127.0.0.1 -w '$fmt' https://$host/$path" 2>&1); code=$(split_answer "$out" "$tmp/s"); server=$(classify "$tmp/s" "$code")
    case "$server" in REAL-FILE|WAIT-PAGE) ;; *) show "server curl" "$tmp/s" ;; esac

    # server, certificate check off: what does the host's own https port answer when the certificate is not checked?
    # shellcheck disable=SC2086
    out=$($SSH_CMD "$SSH_DEST" "curl -sSk --max-time 20 --resolve $host:443:127.0.0.1 -w '$fmt' https://$host/$path" 2>&1); code=$(split_answer "$out" "$tmp/sk"); serverk=$(classify "$tmp/sk" "$code")
    case "$serverk" in REAL-FILE|WAIT-PAGE) ;; *) show "server curl -k" "$tmp/sk" ;; esac

    # server -> its own PUBLIC address (127.0.0.1 turned out to be a different site: "domain reserved"): is the server's own address challenged?
    if [ -n "$pubip" ]; then
      # shellcheck disable=SC2086
      out=$($SSH_CMD "$SSH_DEST" "curl -sS --max-time 20 --resolve $host:443:$pubip -w '$fmt' https://$host/$path" 2>&1); code=$(split_answer "$out" "$tmp/sp"); serverpub=$(classify "$tmp/sp" "$code")
      case "$serverpub" in REAL-FILE|WAIT-PAGE) ;; *) show "server curl (public address)" "$tmp/sp" ;; esac
    else serverpub="NO-ADDRESS"; fi

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
        if [ "$kind" = 443 ]; then out=$(curl -sS --max-time 20 --resolve "$host:$lport:127.0.0.1" -D "$tmp/h$kind" -w "$fmt" "https://$host:$lport/$path" 2>&1)
        else out=$(curl -sS --max-time 20 -H "Host: $host" -D "$tmp/h$kind" -w "$fmt" "http://127.0.0.1:$lport/$path" 2>&1); fi
        code=$(split_answer "$out" "$tmp/t$kind"); result=$(classify "$tmp/t$kind" "$code")
        if [ "$kind" = 443 ]; then
          out=$(curl -sSk --max-time 20 --resolve "$host:$lport:127.0.0.1" -D "$tmp/hk" -w "$fmt" "https://$host:$lport/$path" 2>&1); code=$(split_answer "$out" "$tmp/tk"); tunnelk=$(classify "$tmp/tk" "$code")
          case "$tunnelk" in REAL-FILE|WAIT-PAGE) ;; *) show "tunnel 443 -k" "$tmp/tk" ;; esac
          if [ -s "$tmp/hk" ]; then echo "   tunnel 443 -k headers: $(grep -iE '^(HTTP|server|location|content-type|via|x-)' "$tmp/hk" | tr -d '\r' | head -6 | tr '\n' ';')"; fi
        else
          out=$(curl -sS --max-time 20 -H "Host: $host" -w "$fmt" "http://127.0.0.1:$lport/" 2>&1); code=$(split_answer "$out" "$tmp/tr"); root80=$(classify "$tmp/tr" "$code")
          [ "$root80" = "OTHER(HTTP 404, "* ] || show "tunnel 80 start page" "$tmp/tr"
        fi
        case "$result" in REAL-FILE|WAIT-PAGE) ;; *) show "tunnel $kind" "$tmp/t$kind" ;; esac
        if [ -s "$tmp/h$kind" ]; then echo "   tunnel $kind headers: $(grep -iE '^(HTTP|server|location|content-type|via|x-)' "$tmp/h$kind" | tr -d '\r' | head -6 | tr '\n' ';')"; fi
        if grep -qiE 'prohibited|not allowed|refused' "$err"; then result="FORWARDING-REFUSED-BY-HOST"; fi
      fi
      kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
      [ "$kind" = 443 ] && tunnel="$result" || tunnel80="$result"
      if [ -s "$err" ]; then echo "   (ssh said, port $kind: $(head -c 200 "$err" | tr '\n' ' '))"; fi
    done

    # tunnel to the server's own public address: the connection to the web server is made BY the server (from its own address)
    tunnelpub="NO-ADDRESS"
    if [ -n "$pubip" ]; then
      err="$tmp/tunnel-pub.err"; : > "$err"
      # shellcheck disable=SC2086
      $SSH_CMD -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=10 -L "127.0.0.1:18444:$pubip:443" "$SSH_DEST" 2> "$err" &
      pid=$!; tunnelpub="TUNNEL-NOT-OPENED"
      for i in $(seq 1 20); do
        if ! kill -0 "$pid" 2>/dev/null; then break; fi
        if (exec 3<>"/dev/tcp/127.0.0.1/18444") 2>/dev/null; then tunnelpub=""; break; fi
        sleep 0.5
      done
      if [ -z "$tunnelpub" ]; then
        out=$(curl -sS --max-time 20 --resolve "$host:18444:127.0.0.1" -D "$tmp/hp" -w "$fmt" "https://$host:18444/$path" 2>&1); code=$(split_answer "$out" "$tmp/tp"); tunnelpub=$(classify "$tmp/tp" "$code")
        case "$tunnelpub" in REAL-FILE|WAIT-PAGE) ;; *) show "tunnel to the public address" "$tmp/tp" ;; esac
      fi
      kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
    fi

    say "round $r: control=$control | server=$server | server-k=$serverk | server-pub=$serverpub | tunnel-pub=$tunnelpub | tunnel443=$tunnel | tunnel443-k=$tunnelk | tunnel80=$tunnel80 | tunnel80-start=$root80"
    [ "$r" = "$rounds" ] || sleep "$gap"
  done

  echo; echo "== summary"; printf '%s' "$summary"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then { echo '### Host probe (read-only)'; echo; printf '%s' "$summary" | sed 's/^/- /'; } >> "$GITHUB_STEP_SUMMARY"; fi
  return 0
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
