#!/usr/bin/env bash
# ownership-check.sh — fail if two active claims overlap paths.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
F=OWNERSHIP.md
if [ ! -f "$F" ]; then
  echo "no OWNERSHIP.md — ok (empty claims)"
  exit 0
fi
python3 - <<'PY'
from pathlib import Path
import re
text = Path("OWNERSHIP.md").read_text(encoding="utf-8")
rows = []
for line in text.splitlines():
    if not line.startswith("|") or "---" in line or line.startswith("| agent"):
        continue
    cols = [c.strip() for c in line.strip("|").split("|")]
    if len(cols) < 4:
        continue
    agent, task, globs, rest = cols[0], cols[1], cols[2], cols[3]
    if agent.lower() in ("agent", "---"):
        continue
    if not task or task == "—":
        continue
    active = "active" in line.lower() or "doing" in line.lower() or "started" in line.lower()
    rows.append((agent, task, globs, active))

def overlap(a, b):
    # trivial prefix overlap
    if not a or not b:
        return False
    parts_a = [p.strip() for p in a.split(",") if p.strip()]
    parts_b = [p.strip() for p in b.split(",") if p.strip()]
    for x in parts_a:
        for y in parts_b:
            if x == y or x.startswith(y.rstrip("*")) or y.startswith(x.rstrip("*")):
                return True
    return False

active = [r for r in rows if r[3]]
conflicts = []
for i in range(len(active)):
    for j in range(i + 1, len(active)):
        if active[i][0] != active[j][0] and overlap(active[i][2], active[j][2]):
            conflicts.append((active[i], active[j]))
print(f"claims {len(rows)} active {len(active)} conflicts {len(conflicts)}")
for a, b in conflicts:
    print(f"CONFLICT {a[0]}/{a[1]} vs {b[0]}/{b[1]} globs {a[2]} / {b[2]}")
if conflicts:
    raise SystemExit(1)
print("ownership-ok")
PY
