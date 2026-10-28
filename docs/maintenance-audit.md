# Retained-key maintenance audit

Scope: blueprint §3.3, handoff §4 and execution-plan section 1. This is an
explicitly owned local-network control/negative experiment, not an admission or recovery
implementation. No contract source, verifier artifacts, dependency pins or chain
limits change. Neither bootstrap mode contains a reservation call.

```sh
npm run test:native-node -- --with-services --transactions --staged-bootstrap --maintenance-audit --maintenance-controls
```

Both audit flags are required for the full control matrix below;
`--maintenance-controls` requires `--maintenance-audit`. An unknown audit mode or
missing staged-bootstrap mode fails closed. The normal three-transaction staged diagnostic is still available
without attacks. This maintenance lane retains keys in memory and cannot resume an
interrupted order or admit real counterparties. The separate [actor recovery
experiment](recovery-audit.md) does not broaden that admission scope.

## What is tested

Before locking, exercise the live retained authority at counter 1: reject stale
counter 0 and future counter 2, then finalize one seven-update positive batch.
That batch inserts a canary, removes/replaces `reserve` with the original `accept`
key, restores the original `reserve` key, removes the canary, and replaces the
authority with the same signer at counter 2. All 14 original operations are restored.
Replay the identical signed maintenance payload in a newly balanced transaction;
this is signed-update replay, not a resend of spent fee inputs.

After complete bootstrap and positive lock inspection, retain the original maintenance
key and construct seven signed proposals at the observed locked counter **3**:

1. Insert an absent `maintenanceCanary` entrypoint using the valid original `accept` key.
2. Replace `reserve` using an ordered remove-v3 then insert-v3 batch, with the valid
   but different original `accept` verifier artifact.
3. Remove the `reserve` v3 verifier.
4. Restore the retained signer as a one-member, threshold-one authority at counter 4.
5. Use a stale signed counter against the locked authority.
6. Use a future signed counter against the locked authority.
7. Replay the pre-lock positive batch's signed maintenance payload.

The ordinary three-transaction diagnostic still locks at counter 2. The audit's
positive control increments the counter once more; this is not a protocol change.

Each uses the original address/network, a fresh TTL and a locally verified retained
signature. It traverses the unchanged real proof-provider, wallet fee/balancing,
finalization, individual-resource guard and single submission boundary. A missing fee,
invalid proof, resource limit, client guard or unknown submission is not authority proof.

An accepted post-lock transaction is a test failure. For rejection, require the actual node's
RPC 1010 and exact runtime custom code **134**, then an independently indexed later
finalized block and unchanged complete contract state. Any other code or an uncertain
outcome stops the run, without retry or advancing to another probe.

Pre-lock counter controls have a different boundary: this cohort finalized all
three as `FailFallible`. A bounded private native-log matcher binds the exact
identifiers, contract address and failed segment to the independently indexed
result and concludes `ReplayCounterMismatch`. Only allowlisted identifiers,
counts and conclusions are published; raw logs are not. These are not RPC 134
authority failures or successful maintenance transactions. Unchanged complete
state is separately checked. A generic partial-success result is insufficient.

## Exact source and state semantics

- The [upstream `SingleUpdate` reference](https://docs.rs/midnight-ledger/latest/midnight_ledger/structure/enum.SingleUpdate.html)
  explicitly says insertion does not replace an existing key: remove it first.
  The installed contracts SDK 4.1.1 also rejects an existing operation in its public
  insert helper. The reference supports the ordered replacement shape; actual
  pre-lock positive control above now exercises that ordered shape on this cohort.

- [Pinned pallet validation](https://github.com/midnightntwrk/midnight-node/blob/node-1.0.0/pallets/midnight/src/lib.rs#L556-L575)
  converts ledger errors to `InvalidTransaction::Custom(u8)`.
- [Pinned ledger error mapping](https://github.com/midnightntwrk/midnight-node/blob/node-1.0.0/ledger/src/versions/common/types.rs#L313-L361)
  maps `Malformed(KeyNotInCommittee)` to **134**. Invalid committee signature is
  135, threshold missed is 136, replay-counter mismatch is 108 and unbalanced is 126.
  These are distinct failures, not interchangeable evidence.
- Diagnostics accept only exact `Custom error: <u8>` RPC data with code 1010.
  They do not parse arbitrary messages or publish raw errors, transactions or secrets.
- [Pinned node state RPC](https://github.com/midnightntwrk/midnight-node/blob/node-1.0.0/pallets/midnight/rpc/src/lib.rs#L36-L49)
  supports `midnight_contractState(address, blockHash)` for actual as-of state.
  The audit binds this to a finalized hash, independently checks that block's
  height/hash in the indexer, and requires identical serialized state from the
  node, latest indexed contract action and previously inspected locked bootstrap.
- The installed indexer provider's `queryContractState(address, blockHash)` filters
  **contract actions** at that block; it is not an arbitrary as-of state lookup.
  A block without a contract action can return null even though the contract exists.
  Tests explicitly cover this distinction, drift and observation deadlines.

## Evidence boundaries

**Current bounded runs:** [maintenance controls receipt](receipts/maintenance-controls-2026-09-10.json)
records fresh final-source `run-f5Chw8`, with driver exit 0 and a successful supervisor completion.
The positive batch finalized at block 38; stale/future/replay failures finalized
at blocks 32, 35 and 41. All seven post-lock cases returned RPC 1010 / custom 134,
with unchanged finalized/indexed state through **44→45→46→47→48→49→50→51**.
All 14 individual preflights passed unchanged limits (three bootstrap, four
pre-lock controls, seven post-lock probes). Bootstrap plus pre-lock controls took
128,118 ms after wallet readiness; the post-lock audit took another 41,944 ms.
The final `submissionCount: 3` counts bootstrap transactions only, not controls
or rejected proposals. No reservation ran.

The fresh run is bound to the actual [pre-run implementation snapshot](receipts/final-native-source-2026-09-10.json):
all 16 listed files were verified unchanged after maintenance completed. Compiler,
contract-source and artifact fingerprints were also emitted during the run.
The earlier successful `run-9Q08JL` had only a
[post-run source observation](receipts/integration-source-observation-2026-09-10.json),
potentially after hardening; it is superseded, not retroactively source-attested.
The fresh [recovery rerun](recovery-audit.md) also completed with driver exit 0
and supervisor completion/cleanup markers; its shell exit code was not directly
observed. Maintenance's supervisor shell exit 0 was observed. These establish
bounded observations, not remote CI success or immutable admission.

**Earlier four-case run: `run-HBy3FX`, supervisor exit 0.** The
[sanitized source-fingerprinted receipt](receipts/maintenance-audit-2026-09-10.json)
records all four node rejections as `Custom(134) / KeyNotInCommittee`, with unchanged
state at successive finalized/indexed blocks **32→33, 33→34, 34→35 and 35→36**.
All seven individual preflights (three bootstrap, four attack candidates) stayed
within unchanged limits. Bootstrap took 55,790 ms after wallet readiness; the audit
took a further 23,215 ms. Owned services stopped; no reservation ran.

Verification also passed: 37 Node tests, 37 Bun tests / 397 assertions, lint, strict
typecheck, build and plan checks. Unit fixtures remain distinct from native proof.
Independent final review found no blocking correctness/privacy findings in the
four-case implementation and checked its code/receipt fingerprints.

The first attempt (`run-uHvQeo`) reached real node submission and returned custom
code 134 for verifier replacement, but stopped when the old post-rejection observer
queried an empty block as though it were an as-of state lookup. This was an observer
bug, not evidence that the contract disappeared. It does not establish a completed
full audit. The observer and exact custom-code projection were corrected
before final verification.

`run-ZgJPbE` then verified node code 134 and unchanged state for three proposals.
Review identified that its single insert against an existing `reserve` entrypoint
was not a lawful replacement candidate: insertion does not overwrite a present key.
That run is not valid replacement-category proof. The corrected final implementation
tests absent-key insertion separately and uses explicit ordered remove/insert for
replacement. SDK method names such as `addOrReplaceContractOperation` do not establish
the actual ledger instruction semantics.

The pre-lock positive/stale/future/replay and seven post-lock controls are now
bounded native evidence; [actual actor-process recovery](recovery-audit.md) is
recorded separately. Neither closes malformed-bootstrap admission, canonical
quote/payment-window/state/key/entrypoint/address binding, buyer-proved reservation
or independent lifecycle/recovery acceptance. The aggregate
`adversarialMaintenanceRejectionVerified` flag deliberately remains false; the
nested current audit reports only its seven concrete retained-key cases.

Bootstrap elapsed time/fee estimates remain separate from audit duration and rejected
submission counts. SDK fee estimates for rejected proposals are not settled charges.
MID provider/operation completion remains **0/6 and 0/14**, highest release gate **R0**.
