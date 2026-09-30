#!/usr/bin/env bash
# Evidence: obs_d2a_local_happy_complete_1 / obs_m2_multi_instance_1
# Reproduce local happy path on disposable undeployed network (fresh run dir).
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
rm -rf /tmp/d2a-happy-run && mkdir -p /tmp/d2a-happy-run
node packages/integration/src/local-happy.mjs
