#!/usr/bin/env bash
# Execute README ```bash verify blocks in a scratch clone. Exit 1 on any failure.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
python3 - <<'PY'
import re, subprocess, sys
from pathlib import Path
text=Path("README.md").read_text()
blocks=re.findall(r"```bash verify\n(.*?)```", text, re.S)
print(f"verify blocks {len(blocks)}")
fail=0
for i,b in enumerate(blocks):
    print(f"--- block {i} ---")
    r=subprocess.run(["bash","-c",b], capture_output=True, text=True, timeout=300)
    print(r.stdout[-500:])
    if r.returncode!=0:
        print(r.stderr[-500:])
        print(f"BLOCK {i} FAIL")
        fail=1
    else:
        print(f"BLOCK {i} PASS")
sys.exit(fail)
PY
