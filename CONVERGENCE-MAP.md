# CONVERGENCE-MAP.md

| concern | implementations | canonical | consumers | removal plan | proof |
|---|---|---|---|---|---|
| hex/encoding helpers | convex/http.ts bytesToHex; packages/** ad hoc | ONE encoder TBD | http, tests | consolidate | property tests |
| delivery commitment | packages/backend delivery-commitment; volume-batch | backend delivery-commitment | integration, contract | migrate | unit |
| network/guard | midnight-client network.ts; config.mjs; preprod-lane | network.ts + config.mjs | client, harness | document split | typecheck |
| provider assembly | provider-factory.ts; provider-assembly.mjs | provider-factory | integration, client | migrate scripts | unit 11/11 |
| indexer GraphQL | ingest, diagnostics, scripts | TBD typed client | many | consolidate | tests |
| observation | orders.ts + observationIngest.ts | observationIngest applyChainObservation | convex | document split | tests |
| FrozenQuote / phases | schema, domain, UI, generated Phase | generated Phase | all | import | semantic-sim |
| validation | zod vs convex/values | per-boundary map | — | document | — |
| errors | midnight-client errors.ts | errors.ts | client | — | unit |
| lockfiles | bun.lock + packages/integration/package-lock.json | bun (if harness allows) | — | verify | — |
| TS/.mjs dual | many .mjs in integration | convert or checkJs | — | phased | typecheck |

Open rows: encoder, indexer client, lockfile, TS/checkJs, preprod-lane split, volume-batch split.


## CVG3 lockfile decision (2026-10-01)

`packages/integration/package-lock.json` (178KB) exists for the Node 24 harness
(`node --test`) which does not read bun.lock. **Keep dual lockfile** with reason:
integration tests resolve via npm-style package-lock in worktrees without root
node_modules. Removing it breaks `node --test packages/integration/...`.
