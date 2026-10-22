#!/usr/bin/env bash
# post-push-verify.sh — run the shipped checks and fail if any of them fails.
#
# The previous version piped every step through `tail`, so the exit status was
# tail's and the script could not fail. Each step now runs to completion, its
# status is recorded, and the summary decides the exit code.
set -uo pipefail
cd "$(dirname "$0")/.."

failed=0
step() {
  local name="$1"
  shift
  echo "--- $name ---"
  if "$@"; then
    echo "PASS $name"
  else
    echo "FAIL $name"
    failed=$((failed + 1))
  fi
}

step judging-minimum bash scripts/judging-minimum.sh
step unit npm run test:unit
if [ -f scripts/verify-readme.sh ]; then
  step readme bash scripts/verify-readme.sh
fi

echo "=== failed: $failed ==="
[ "$failed" -eq 0 ]
