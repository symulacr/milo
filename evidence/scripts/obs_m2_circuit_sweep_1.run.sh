#!/usr/bin/env bash
# Evidence: obs_m2_circuit_sweep_1
# Drive all 14 proof circuits on the disposable undeployed network.
# One fresh staged instance per scenario; every call must land SucceedEntirely.
set -euo pipefail
export MILO_LOCAL_ALLOW_TRANSACTIONS=disposable-owned-local
export MILO_LOCAL_NETWORK_ID=undeployed
export MILO_LOCAL_GENESIS_HASH="${MILO_LOCAL_GENESIS_HASH:-0xe72f7a21a0397844563b4206f887b779ffa0d937c2d1b2339441faa1f08b9846}"
export MILO_LOCAL_NODE_HTTP=http://127.0.0.1:9944/
export MILO_LOCAL_NODE_WS=ws://127.0.0.1:9944/
export MILO_LOCAL_INDEXER_HTTP=http://127.0.0.1:8088/api/v4/graphql
export MILO_LOCAL_INDEXER_WS=ws://127.0.0.1:8088/api/v4/graphql/ws
export MILO_LOCAL_PROOF_HTTP=http://127.0.0.1:6300/
export MILO_LOCAL_BOOTSTRAP_MODE=staged
export MILO_LOCAL_TIMEOUT_MS=1800000
# Local disposable only: fixed fee escape hatch (fee-math refuses other networks).
export MILO_ALLOW_FIXED_LOCAL_FEE=local-disposable-only
export MILO_SWEEP_RUN_DIR="${MILO_SWEEP_RUN_DIR:-/tmp/m2-circuit-sweep}"
export MILO_SWEEP_TRAIL="${MILO_SWEEP_TRAIL:-/tmp/m2-circuit-sweep-trail.jsonl}"
mkdir -p "$MILO_SWEEP_RUN_DIR"
# Share the local lane safely with other agents.
# Canonical isolated Node runtime (artifacts.validateCohort asserts 24.20.0).
NODE_BIN="${MILO_NODE_BIN:-.tools/node-runtime/node-v24.20.0-linux-x64/bin/node}"
if [ ! -x "$NODE_BIN" ]; then
  echo "missing $NODE_BIN (run scripts/setup-integration-runtime.ts)" >&2
  exit 1
fi
exec flock /home/eya/milo-wt/A-R6/.locks/local-circuit-sweep.lock \
  "$NODE_BIN" packages/integration/src/local-circuit-sweep.mjs
