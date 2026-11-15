#!/usr/bin/env bash
# Checks the pipeline itself: actionlint over .github/workflows (syntax, wrong names, expressions, and shellcheck on every `run:` script) and
# shellcheck (warnings and errors) over every .sh file of the repo. Local (Linux) and in CI (.github/workflows/lint.yml): `bash scripts/run-workflow-lint.sh`.
# actionlint is downloaded in a temporary folder, pinned to one version AND its checksum (no unpinned download script). Needs curl, tar,
# sha256sum and shellcheck. Already have actionlint? `ACTIONLINT=/path/to/actionlint bash scripts/run-workflow-lint.sh` skips the download.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=1.7.12
SHA256=8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8   # actionlint_${VERSION}_linux_amd64.tar.gz, from the release's checksums file
command -v shellcheck >/dev/null || { echo "shellcheck is not installed (Ubuntu: apt-get install -y shellcheck)" >&2; exit 1; }
bin="${ACTIONLINT:-}"
if [ -z "$bin" ]; then
  tools="${LINT_TOOLS_DIR:-$(mktemp -d)}"
  mkdir -p "$tools"
  if [ ! -x "$tools/actionlint" ]; then
    curl -fsSL -o "$tools/actionlint.tar.gz" "https://github.com/rhysd/actionlint/releases/download/v${VERSION}/actionlint_${VERSION}_linux_amd64.tar.gz"
    echo "${SHA256}  $tools/actionlint.tar.gz" | sha256sum -c -
    tar -xzf "$tools/actionlint.tar.gz" -C "$tools" actionlint
  fi
  bin="$tools/actionlint"
fi
"$bin" -color
# shellcheck disable=SC2046 # the file names have no spaces
shellcheck -S warning $(git ls-files '*.sh')
echo "Pipeline lint: no problems."
