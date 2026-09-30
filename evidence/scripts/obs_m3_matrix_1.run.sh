#!/bin/bash
# M3 ×3 chain-layer matrix: run local-circuit-sweep three times.
set -euo pipefail
export PATH="/home/eya/.bun/bin:/home/eya/milo/milo-main/.tools/node-runtime/node-v24.20.0-linux-x64/bin:/usr/bin:/bin"
cd /home/eya/milo/milo-main
mkdir -p .locks
exec 9>.locks/local-circuit-sweep.lock
flock 9

for i in 1 2 3; do
  echo "=== M3 RUN $i $(date -Is) ==="
  rm -rf /tmp/m2-circuit-sweep-run-$i
  mkdir -p /tmp/m2-circuit-sweep-run-$i
  if [ -f evidence/scripts/obs_m2_circuit_sweep_1.run.sh ]; then
    # stamp run id
    MILO_M3_RUN=$i timeout 3600 bash evidence/scripts/obs_m2_circuit_sweep_1.run.sh \
      > /tmp/m3-run-$i.out 2>&1 || echo "run $i exit $?"
  else
    timeout 3600 node packages/integration/src/local-circuit-sweep.mjs \
      > /tmp/m3-run-$i.out 2>&1 || echo "run $i exit $?"
  fi
  # archive trail
  if [ -f /tmp/m2-circuit-sweep-trail.jsonl ]; then
    cp /tmp/m2-circuit-sweep-trail.jsonl /tmp/m3-run-$i-trail.jsonl
    python3 - <<PY
import json
from pathlib import Path
seen=set()
for line in Path("/tmp/m3-run-$i-trail.jsonl").read_text().splitlines():
    try: o=json.loads(line)
    except: continue
    if o.get("event")=="call-finalized" and o.get("status")=="SucceedEntirely":
        seen.add(o.get("circuit"))
print("RUN $i circuits", len(seen), sorted(seen))
PY
  fi
  if [ -f /tmp/m2-circuit-sweep/m2-circuit-sweep.json ]; then
    cp /tmp/m2-circuit-sweep/m2-circuit-sweep.json /tmp/m3-run-$i-sweep.json
  fi
done
echo M3_SWEEPS_DONE
