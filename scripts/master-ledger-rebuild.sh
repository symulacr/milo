#!/usr/bin/env bash
# master-ledger-rebuild.sh — regenerate counts from MASTER-LEDGER.md
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
LED=../audit/discovery/MASTER-LEDGER.md
if [ ! -f "$LED" ]; then
  echo "missing $LED" >&2
  exit 1
fi
python3 - <<'PY'
from pathlib import Path
import re, datetime
p = Path("../audit/discovery/MASTER-LEDGER.md")
t = p.read_text(encoding="utf-8", errors="ignore")
rows = re.findall(r'^\| (L-[0-9A-Za-z]+) \| ([^|]*) \| ([^|]*) \|', t, re.M)
counts = {"DONE": 0, "PARTIAL": 0, "PENDING": 0, "OPEN": 0, "SUPERSEDED": 0, "OTHER": 0}
for lid, mid, status in rows:
    s = status.strip().upper()
    if "DONE" in s:
        counts["DONE"] += 1
    elif "PARTIAL" in s:
        counts["PARTIAL"] += 1
    elif "PENDING" in s or "OPEN" in s:
        counts["PENDING"] += 1
    elif "SUPERSEDED" in s:
        counts["SUPERSEDED"] += 1
    else:
        counts["OTHER"] += 1
print(f"rows={len(rows)}")
print(f"DONE={counts['DONE']} PARTIAL={counts['PARTIAL']} PENDING={counts['PENDING']} SUPERSEDED={counts['SUPERSEDED']} OTHER={counts['OTHER']}")
print("REMAINING=", counts["PARTIAL"] + counts["PENDING"] + counts["OTHER"])
# write summary sidecar
out = Path("../audit/discovery/MASTER-LEDGER-counts.txt")
out.write_text(
    f"collected={datetime.datetime.utcnow().isoformat()}Z\n"
    + "\n".join(f"{k}={v}" for k, v in counts.items())
    + f"\nrows={len(rows)}\n"
)
print(f"wrote {out}")
PY
