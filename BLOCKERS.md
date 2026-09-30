# BLOCKERS.md

## B-D2A-01 genesis-wallet-sync Wallet.Sync ErrorEvent
- Error: `Wallet.Sync: [object ErrorEvent]` at wallet-sdk-*-wallet Sync.js; testkit-js timeout; stage `genesis-wallet-sync` failed
- Stack up: node/indexer/proof-server healthy. Compiler artifacts validated (0bede3fb, 14 keys)
- Node RPC `chain_getBlockHash` works. Indexer GraphQL works
- Suspect: `indexerPublicDataProvider(env.indexerWS)` WS URL shape (`ws://127.0.0.1:8088`)
- Substitutes tried: compose up, wait healthy, local.mjs with MILO_LOCAL_* env
- Next: probe indexer WS endpoints; match midnight-js-indexer-public-data-provider expected URL

## B-D2C-01 Preprod DUST balance 0 after dust-already-registered
- Error: `preprod-lane --check` → `balances: {night: "35000000000", dust: "0"}` while
  `dust-already-registered` fires (all 7 available UTXOs have registeredForDustGeneration=true).
- Stack: wallet sync OK (16/16 checks); chain tip height 2776500; address
  `mn_addr_preprod1y7kqu…`.
- Substitutes tried: `--register-dust` (no-op), self-split UTXO script (testkit
  `Wallet sync timeout after 90000ms` without preprod-lane snapshots).
- Next: reuse preprod-lane session restore, transfer 2 NIGHT to self to mint an
  unregistered UTXO, register it, wait for DUST > 0, then `MILO_SWEEP_ONLY=happy-path
  preprod-lane --sweep` with installFeeMath wired (Agent A).
