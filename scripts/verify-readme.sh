#!/usr/bin/env bash
# verify-readme.sh — execute README ```bash verify blocks; fail on first error.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# J3 flake: bun must be on PATH even when the caller has a bare PATH
export PATH="${HOME}/.bun/bin:/home/eya/milo/milo-main/.tools/node-runtime/node-v24.20.0-linux-x64/bin:${PATH}"
python3 - <<'PY'
import re, subprocess, sys, os
from pathlib import Path
text = Path("README.md").read_text()
blocks = re.findall(r"```bash verify\n(.*?)```", text, re.S)
print(f"verify blocks {len(blocks)}")
fail = 0
env = os.environ.copy()
for i, b in enumerate(blocks):
    print(f"--- block {i} ---")
    r = subprocess.run(["bash", "-ec", b], capture_output=True, text=True, timeout=300, env=env)
    print((r.stdout or "")[-500:])
    if r.returncode != 0:
        print((r.stderr or "")[-500:])
        print(f"BLOCK {i} FAIL")
        fail = 1
    else:
        print(f"BLOCK {i} PASS")
sys.exit(fail)
PY
