#!/usr/bin/env bash
# Runs ESLint (config: eslint.config.mjs, two rules: no-undef and no-unused-vars) over the whole repo. Local and in CI (.github/workflows/lint.yml):
# `bash scripts/run-lint.sh`. The repo has no npm dependencies, so ESLint is installed in a temporary folder, not in the repo.
set -euo pipefail
cd "$(dirname "$0")/.."
tools="${LINT_TOOLS_DIR:-$(mktemp -d)}"
mkdir -p "$tools"
if [ ! -x "$tools/node_modules/.bin/eslint" ]; then
  (cd "$tools" && npm init -y >/dev/null && npm install --no-audit --no-fund eslint@9.39.5)
fi
"$tools/node_modules/.bin/eslint" --max-warnings 0 .
echo "Lint: no problems."
