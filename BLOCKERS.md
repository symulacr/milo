# BLOCKERS.md

## B-D2A-01 genesis-wallet-sync Wallet.Sync ErrorEvent
- Error: `Wallet.Sync: [object ErrorEvent]` at wallet-sdk-*-wallet Sync.js; testkit-js timeout; stage `genesis-wallet-sync` failed
- Stack up: node/indexer/proof-server healthy. Compiler artifacts validated (0bede3fb, 14 keys)
- Node RPC `chain_getBlockHash` works. Indexer GraphQL works
- Suspect: `indexerPublicDataProvider(env.indexerWS)` WS URL shape (`ws://127.0.0.1:8088`)
- Substitutes tried: compose up, wait healthy, local.mjs with MILO_LOCAL_* env
- Next: probe indexer WS endpoints; match midnight-js-indexer-public-data-provider expected URL
