#!/usr/bin/env bash
# .github/scripts/open-site-tunnel.sh test.azcarpool.nl
# Runs in the robot (smoke test) job, before the robot starts. The host (mijn.host, Imunify360 WebShield) sometimes shows a wait page
# ("One moment, please...", a bot check) to the GitHub computer for minutes. This makes the robot's browsers reach the test site from the
# INSIDE of the host instead: an SSH port forward from this computer's port 443 to the site's own address, made BY the host. The browsers
# still ask for https://test.azcarpool.nl (the name points to this computer in /etc/hosts), so the real certificate and the real server
# settings are used, and the robot test itself does not change. Tried on 2026-11-15 with a read-only probe (host-probe.yml, removed afterwards; see docs/functies/wachtpagina-host.md): the
# forward to the server's own public address returned the real file with the valid certificate. NOT yet proven: that this also gets past
# the wait page (the host was not blocking during the probe); the log of the first blocked run says it ("through the tunnel the host answered").
#
# Safety:
#   - only for test.azcarpool.nl (refuses anything else, so the live site is never touched);
#   - uses its OWN key (TUNNEL_KEY), never the deploy key. On the host that key must be restricted to forwarding to the site only
#     (README, Test environment, "Robot through a tunnel"): it cannot log in, run commands or upload;
#   - never fails the job: without the secret, or when the tunnel does not work, it says so and the robot goes straight to the site as before.
#
#   TUNNEL_KEY     the private key (secret). Empty = skip.
#   SSH_USER       the account name on the host (the same as DEPLOY_USER)
#   SSH_HOST, SSH_PORT   the host (not secret; pinned in .github/deploy/known_hosts)
#   TUNNEL_TARGET  where the HOST connects to (default: the site's name, resolved by the host; the key's permitopen must say the same)
set -uo pipefail

site="${1:?usage: open-site-tunnel.sh test.azcarpool.nl}"
if [ "$site" != "test.azcarpool.nl" ]; then echo "::error::the tunnel is only for test.azcarpool.nl (got '$site')"; exit 2; fi
if [ -z "${TUNNEL_KEY:-}" ]; then echo "::notice::no TUNNEL_KEY secret: the robot goes straight to $site (no tunnel)"; exit 0; fi
: "${SSH_USER:?SSH_USER is required}" "${SSH_HOST:?SSH_HOST is required}" "${SSH_PORT:?SSH_PORT is required}"
target="${TUNNEL_TARGET:-$site}"
known_hosts="$(cd "$(dirname "$0")/.." && pwd)/deploy/known_hosts"

undo() {
  echo "::warning::$1. The robot goes straight to $site (no tunnel), as before."
  sudo sed -i "\\| $site\$|d" /etc/hosts 2>/dev/null || true
  pkill -f "ssh .*tunnel_key" 2>/dev/null || true
  exit 0
}

user=$(printf '%s' "$SSH_USER" | tr -d '[:space:]')
install -d -m 700 ~/.ssh
printf '%s\n' "$TUNNEL_KEY" > ~/.ssh/tunnel_key; chmod 600 ~/.ssh/tunnel_key
head -1 ~/.ssh/tunnel_key | grep -q 'BEGIN OPENSSH PRIVATE KEY' || undo "TUNNEL_KEY does not start with -----BEGIN OPENSSH PRIVATE KEY-----"
ssh-keygen -y -f ~/.ssh/tunnel_key > /dev/null 2>&1 || undo "TUNNEL_KEY is not a valid private key"

# a normal user may listen on 443 (this computer is thrown away after the job)
sudo sysctl -w net.ipv4.ip_unprivileged_port_start=443 > /dev/null || undo "could not allow listening on port 443"

setsid ssh -f -N -p "$SSH_PORT" -i ~/.ssh/tunnel_key \
  -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$known_hosts" -o HostKeyAlgorithms=ssh-ed25519 \
  -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=4 \
  -L "127.0.0.1:443:$target:443" "$user@$SSH_HOST" || undo "the SSH tunnel did not start (is the key added on the host?)"

echo "127.0.0.1 $site" | sudo tee -a /etc/hosts > /dev/null

# does it work? The certificate is checked (no -k): a wrong server (another site, "domain reserved") fails here.
out=$(mktemp)
code=$(curl -sS --max-time 20 -o "$out" -w '%{http_code}' "https://$site/service-worker.js" 2>"$out.err") || undo "through the tunnel https://$site does not work ($(head -c 200 "$out.err" | tr '\n' ' '))"
if grep -q 'One moment, please' "$out"; then
  echo "== tunnel is up; through the tunnel the host answered: its WAIT PAGE (HTTP $code). The tunnel does not get past the bot check."
elif grep -q 'CACHE_NAME' "$out"; then
  echo "== tunnel is up; through the tunnel the host answered: the REAL FILE (HTTP $code)."
else
  undo "through the tunnel the host answered something else (HTTP $code, $(wc -c < "$out" | tr -d ' ') bytes): not the site"
fi
echo "== the robot now reaches $site through the host itself ($user@$SSH_HOST -> $target:443)"
exit 0
