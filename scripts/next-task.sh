#!/usr/bin/env bash
# next-task.sh — first unblocked unchecked TODO ID (deps checked), or NONE.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
python3 scripts/todo_lib.py next
