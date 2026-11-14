#!/usr/bin/env bash
# Runs the Firestore rules tests (firebase/rules-test/*.test.mjs) against the Firestore emulator, with the rules in firebase/firestore.rules.
# Local and in CI (.github/workflows/rules-tests.yml): `bash scripts/run-rules-tests.sh`. Needs node and Java (JDK 11 or newer).
# The repo has no npm dependencies, so the test tools are installed in a temporary folder, not in the repo. node_modules (git-ignored)
# is a link to it, because the tests import their packages from there.
set -euo pipefail
cd "$(dirname "$0")/.."
tools="${RULES_TOOLS_DIR:-$(mktemp -d)}"
mkdir -p "$tools"
if [ ! -d "$tools/node_modules/firebase-tools" ]; then
  (cd "$tools" && npm init -y >/dev/null && npm install --no-audit --no-fund firebase-tools@15.36.0 @firebase/rules-unit-testing@5.0.2 firebase@12.19.0)
fi
if [ -e node_modules ] && [ ! -L node_modules ]; then echo "node_modules exists and is not a link: remove it or run the tests by hand" >&2; exit 1; fi
ln -sfn "$tools/node_modules" node_modules
trap 'rm -f node_modules' EXIT
"$tools/node_modules/.bin/firebase" emulators:exec --only firestore --project demo-test --config firebase.json \
  'set -e; cd firebase/rules-test; for f in *.test.mjs; do echo "== $f"; node "$f"; done'
