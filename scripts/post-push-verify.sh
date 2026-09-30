#!/usr/bin/env bash
set -u
echo "=== post-push verify ==="
bash scripts/judging-minimum.sh
echo "--- unit ---"
bun run test:unit 2>&1 | tail -5
echo "--- readme ---"
bash scripts/verify-readme.sh 2>&1 | tail -8
