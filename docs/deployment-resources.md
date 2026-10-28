# Full-contract deployment resource investigation

Scope: handoff §4, blueprint §3.3, roadmap M-01–M-03/R1. This is a
resource-only diagnostic of the original complete contract, not a new protocol,
admission implementation, immutable-order claim or payment integration.

## Measurement contract

The isolated driver now checks the wallet-finalized ledger transaction before calling
the wallet's submission method. It retains only allowlisted measurements:

- Exact compile-receipt/artifact-set fingerprints and a count/digest of identifiers.
- SHA-256 and byte lengths of the ledger transaction and unsigned Substrate extrinsic.
- Owned genesis, finalized block hash/height, runtime versions, code hash and metadata hash.
- Runtime gas/ref-time, live configurable size weight, normal per-extrinsic weight
  limits and normal block-length limit at that same block.
- Each exceeded individual dimension, or an explicit unknown-cost result.

The probe rejects wrong genesis/runtime, metadata drift, malformed/missing values
and unsuccessful gas-cost responses. It does not emit transaction bodies, private
openings, signing material, arbitrary errors or raw RPC responses. Oversized or
unknown-cost deployments stop before submission; there is no automatic retry.
Funding and DUST registration remain real disposable local transactions.

Passing these comparisons would **not** establish pool acceptance, available space
in a later block, ledger validity, finalization or canonical order admission.
Existing-block occupancy and all other validation remain separate boundaries.
The observed runtime code hash is evidence, not a consensus-verification claim.

## Exact source and encoding

The node is the unchanged checksum-pinned `node-1.0.0`; no limits are raised.
The already locked `@polkadot/api@16.5.6` is now an explicit integration dependency,
without changing any resolved package version.

1. [Runtime API](https://github.com/midnightntwrk/midnight-node/blob/node-1.0.0/pallets/midnight/src/runtime_api.rs#L20-L43):
   `state_call("MidnightRuntimeApi_get_transaction_cost", SCALE(Vec<u8>), block)`.
   There is no invented `midnight_getTransactionCost` RPC. This runtime does not
   implement `TransactionPaymentApi`, so the probe does not use `queryInfo`.
2. [Gas type](https://github.com/midnightntwrk/midnight-node/blob/node-1.0.0/ledger/src/common/types.rs#L82-L84):
   `GasCost = u64`. Successful SCALE `Result` output is exactly tag `0` plus eight
   little-endian bytes. An error result remains unknown; its contents are not logged.
3. Installed Polkadot `Bytes` treats a `Uint8Array` as **already SCALE encoded**.
   The probe supplies raw hex, then calls `toU8a()` to add the compact length.
   `state.getStorageHash` returns a `Hash`, not `Option<Hash>` in this client.
4. Installed `wallet-sdk-node-client/dist/effect/PolkadotNodeClient.js` submits
   unsigned `api.tx.midnight.sendMnTransaction(rawHex)`. The probe reconstructs
   that extrinsic with the finalized block registry and checks exact byte equality
   with the SDK builder after requiring identical metadata.
5. [Dispatch weight](https://github.com/midnightntwrk/midnight-node/blob/node-1.0.0/pallets/midnight/src/lib.rs#L615-L620)
   is `Weight::from_parts(gas, 0) + ConfigurableTransactionSizeWeight`.
   This is an additive weight, not a byte multiplier. No gas-to-currency conversion
   or commercial affordability conclusion is made.
6. [Limits](https://github.com/midnightntwrk/midnight-node/blob/node-1.0.0/runtime/src/lib.rs#L308-L321)
   are read through block-scoped metadata, not inferred from verifier-file sizes.
   Individual dispatch weight is compared with `normal.maxExtrinsic`; encoded
   extrinsic length is compared with `BlockLength.max.normal`.

## Next gate

Installed ledger-v8 8.1.0 declares `VerifierKeyInsert`,
`ContractOperationVersionedVerifierKey('v3', rawVk)` and signed `MaintenanceUpdate`
with a replay counter. Midnight.js contracts 4.1.1 exports
`submitInsertVerifierKeyTx`. This establishes API availability only, not successful
installation or its resource cost. Its current deploy helper initializes the full
compiled contract; no batch-size switch is assumed. Keep the existing explicit
entrypoint-set equality check: `verifyContractState` alone checks expected keys,
not rejection of additional entrypoints.

At this resource-only checkpoint, staged bootstrap was unimplemented. The subsequent
[staged experiment](staged-bootstrap.md) observes bounded deployment, complete key/state
inspection and positive maintenance-lock state on one noncommercial `DEPLOYED`
contract. It stops before canonical binding and reservation. Forbidden maintenance,
actual interruption/recovery and commercial cost/latency acceptance remain unverified.
A protocol conflict still requires an explicit architecture decision.

All 14 operations, the single-contract policy and existing readiness gates remain
unchanged. Cloud/auth/payment integration and optional work are not reactivated.

## Observed result and verification — 10 September 2026

The [sanitized receipt](receipts/deployment-resources-2026-09-10.json) records
`run-PwtzKR` at finalized block 23. The wallet-finalized ledger transaction is
30,793 bytes; the actual unsigned extrinsic is **30,804 bytes**, below **786,432**.
Declared dispatch ref-time is **1,330,680,000,001**, above the individual maximum
**1,299,891,843,000** by **30,788,157,001**. Only execution ref-time exceeds its limit.
The transaction was **not submitted**; the driver exited 1 and owned services stopped.
This identifies the fresh transaction's blocker, not missing metrics from September 7.

Checks run in this continuation:

- Repository-owned setup, exact native-service/runtime installation and full Compact
  compilation: all 14 circuit artifact sets and 60 hashes verified.
- **37 Bun tests / 397 assertions**, **22 Node 24.20.0 tests**, lint, strict
  typecheck, static build and bounded canonical-plan checks passed.
- Separate native node/indexer block-identity and prover-readiness smoke passed
  (`run-hR2zLZ`); its owned services stopped normally.
- Independent code review identified metadata drift, receipt privacy/naming and
  finality-wording issues; those were addressed. Reviewer also ran the 22 Node tests.
- Live execution verified the resource arithmetic and fail-closed stop. Identifier
  projection/naming, numeric/metadata guard hardening and guard tests changed afterward; no second identical
  funded attempt is claimed or needed to retest those pure changes.
- Platform setup/settings discovery still fails; `npm run setup` succeeds through
  the existing repository script. The fault was reported. Automatic QA remains
  blocked and no UI/browser, hosted provider or remote-CI verification is claimed.

The resource regression suite tests successful/malformed SCALE decoding, exact
block binding, missing limits, wrong genesis/runtime/metadata, integer precision,
each individual dimension, private-error redaction and blocked sends for oversized
or unknown measurements. These tests are not protocol prove/submit/observe evidence.
