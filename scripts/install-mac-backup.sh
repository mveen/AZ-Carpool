#!/bin/bash
# scripts/install-mac-backup.sh — sets up (or updates) the automatic back-up copy on the owner's Mac.
#   bash scripts/install-mac-backup.sh            install or update, then make a copy right away
#   bash scripts/install-mac-backup.sh --remove   stop the automatic copy (the files in ~/azcarpool-backup stay)
# Run it from the repo folder, in Terminal on the Mac. Safe to run again: it only replaces the code copy and the schedule.
# What it sets up: macOS (launchd) starts scripts/offsite-backup.mjs at login and every hour. That script does nothing when
# today's copy is already there, so a Mac that was off or offline catches up by itself.
set -euo pipefail

LABEL="nl.azcarpool.backup"
DIR="${AZ_OFFSITE_DIR:-$HOME/azcarpool-backup}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "$(uname)" != "Darwin" ]; then echo "This installer is for macOS only." >&2; exit 1; fi

if [ "${1:-}" = "--remove" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "The automatic back-up copy is switched off. Your files in $DIR are still there."
  exit 0
fi

NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then echo "Node.js is not found. Install it first (https://nodejs.org) and run this again." >&2; exit 1; fi
MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
if [ "$MAJOR" -lt 20 ]; then echo "Node.js 20 or newer is needed (found $("$NODE" -v))." >&2; exit 1; fi

# 1. The folder and a copy of the code (outside Documents, so macOS does not ask for folder permission in the background).
mkdir -p "$DIR/code/scripts" "$DIR/code/cron/lib"
chmod 700 "$DIR"
cp "$REPO/scripts/offsite-backup.mjs" "$DIR/code/scripts/"
cp "$REPO/cron/backup.mjs" "$DIR/code/cron/"
cp "$REPO/cron/lib/google-auth.mjs" "$REPO/cron/lib/firestore-rest.mjs" "$REPO/cron/lib/setup.mjs" "$DIR/code/cron/lib/"
printf '{ "type": "module" }\n' > "$DIR/code/package.json"

# 2. The schedule: at login and every hour.
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$DIR/code/scripts/offsite-backup.mjs</string></array>
  <key>EnvironmentVariables</key><dict><key>AZ_OFFSITE_DIR</key><string>$DIR</string></dict>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>3600</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$DIR/launchd.log</string>
  <key>StandardErrorPath</key><string>$DIR/launchd.log</string>
</dict>
</plist>
EOF
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
: > "$DIR/launchd.log"

# 3. The key. Without it nothing can be read; say how to get it and stop here (run this script again afterwards).
if [ ! -f "$DIR/backup-key.json" ]; then
  echo
  echo "Almost there. The read-only key is not on this Mac yet. Copy it from the host with this command"
  echo "(put your mijn.host user name in place of YOUR-USER; it asks for your password), then run this installer again:"
  echo
  echo "  scp -P 26 YOUR-USER@h70.mijn.host:azcarpool-secrets/backup-key.json \"$DIR/backup-key.json\" && chmod 600 \"$DIR/backup-key.json\""
  echo
  exit 0
fi
chmod 600 "$DIR/backup-key.json"

# 4. Make a copy now (so you see at once whether it works), then switch the schedule on.
echo "Making a copy now..."
if AZ_OFFSITE_DIR="$DIR" "$NODE" "$DIR/code/scripts/offsite-backup.mjs"; then
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo
  echo "Done. From now on your Mac makes a copy by itself, once a day (it checks at login and every hour)."
  echo "The newest copy:"
  ls -l "$DIR"/firestore-*.jsonl.gz
else
  echo
  echo "The copy failed, so the schedule is NOT switched on. See the message above, fix it and run this again." >&2
  exit 1
fi
