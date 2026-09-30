#!/usr/bin/env bash
# todo-check.sh — exclusive counts, evidence HEAD pins, code refs.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
echo "=== TODO COUNTS ==="
python3 scripts/todo_lib.py counts
echo "=== CODE REFS ==="
python3 scripts/todo_lib.py verify-refs
echo "=== EVIDENCE HEAD ==="
HEAD=$(git rev-parse --short HEAD)
echo "HEAD=$HEAD"
# any evidence ID files
if [ -d evidence/scripts ]; then
  echo "evidence_scripts=$(ls evidence/scripts | wc -l)"
fi
# stale pin scan: evidence IDs in TODO/RECEIPTS
python3 - <<'PY'
from pathlib import Path
import re
ids = set()
for p in Path(".").rglob("*.md"):
    if "node_modules" in str(p):
        continue
    try:
        t = p.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        continue
    ids.update(re.findall(r"obs_[a-z0-9_]+", t))
print(f"evidence_ids {len(ids)}")
for i in sorted(ids)[:30]:
    print(f"  {i}")
PY
echo "=== NEXT ==="
bash scripts/next-task.sh
