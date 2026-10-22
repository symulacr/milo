#!/bin/sh
# Start the proof server, wait for it, then run the stress job.
#
# The prover must be loopback: the lane asserts isLoopbackHostname because the
# proof server receives the serialized witness. Both processes therefore live in
# this one container, and the job dies with the prover if the prover dies.
set -eu

PROVER=/app/tools/prover/midnight-proof-server
LOADER=/lib64/ld-linux-x86-64.so.2

if [ ! -x "$PROVER" ]; then
  echo "proof server binary missing at $PROVER" >&2
  exit 1
fi

# The binary's interpreter is a /nix/store path that does not exist here, so it is
# run through the system loader rather than directly.
"$LOADER" "$PROVER" --port 6300 --num-workers "${MIDNIGHT_PROOF_SERVER_NUM_WORKERS:-1}" &
PROVER_PID=$!

# If the prover dies, stop the job rather than letting it prove against nothing.
trap 'kill "$PROVER_PID" 2>/dev/null || true' EXIT INT TERM

ready=0
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "http://127.0.0.1:6300/health" 2>/dev/null; then
    ready=1
    break
  fi
  sleep 2
done
if [ "$ready" -ne 1 ]; then
  echo "proof server did not become healthy within 120s" >&2
  exit 1
fi
echo "proof server healthy"

# The stress job. Bounds come from the environment so a run cannot outlive its
# budget: operations, instances, wall clock, and the concurrency ceiling, which
# the harness clamps to the wallet's unlocked DUST UTXOs.
exec node \
  --env-file=/app/.env.preprod \
  packages/integration/src/preprod-lane.mjs --stress
