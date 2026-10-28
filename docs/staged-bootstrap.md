# Staged bootstrap — bounded local experiment

Scope: blueprint §3.3, handoff §4 and roadmap M-01–M-03/R1. This is a deployment
procedure experiment, not a protocol change or an admission implementation.
The original Compact source, 14 operations and complete artifact cohort are unchanged.

## Observed result — 10 September 2026

This section preserves the original three-transaction checkpoint. Subsequent
[maintenance controls](maintenance-audit.md) and [actor-process recovery](recovery-audit.md)
have separate native receipts and scope limits; neither implements admission.

The final reviewed run, `run-gtM1Mv`, completed all three transactions with
`SucceedEntirely`, observed all 14 original keys at one address and the positive
empty-committee / threshold-one lock state, then stopped its owned services with
exit 0. The [sanitized receipt](receipts/staged-bootstrap-2026-09-10.json) retains
per-block resource/runtime binding, transaction hashes, indexed observations and
source-log fingerprints without raw transaction identifiers or private material.

| Transaction | Encoded extrinsic bytes | Declared dispatch ref-time | Result |
| --- | ---: | ---: | --- |
| Seven-key deployment | 18,662 | 755,600,000,001 | Within individual limits; indexed success |
| Remaining seven-key insertion | 15,356 | 846,760,000,001 | Within individual limits; indexed success |
| Maintenance authority lock | 3,602 | 32,920,000,001 | Within individual limits; indexed success |

Each transaction's unchanged limits were 786,432 bytes and 1,299,891,843,000 ref-time.
The complete sequence took **62,362 ms after wallet readiness**. Its summed SDK
fee estimate was **3,460,368,173,245,625 SPECK with margin/overhead**, excluding funding
and services; no settled-charge, affordability or production-performance claim follows.
Splitting fits the individual limits but increases aggregate work; the cost gate is
not passed merely because three transactions succeed.

An earlier run, `run-Fj1fOR`, also completed the three observations (54,757 ms).
The final run verified the subsequent explicit process-exit path, supervisor result
wording and final test suite. Neither run performed a Milo circuit call or reservation.

Verification: **28 pinned Node 24.20.0 tests**, **37 Bun tests / 397 assertions**,
lint, strict typecheck, static build, bounded canonical-plan checks and patch whitespace
checks passed. Independent review found no functional defects and identified stale
status documentation, now reconciled. This review does not establish the still-open
maintenance-attack or admission gates. No fresh UI/browser or remote-CI pass is claimed.

## Explicit opt-in

After the existing compiler/native/Node setup and integration dependency install:

```sh
npm run test:native-node -- --with-services --transactions --staged-bootstrap
```

Without the new flag, the existing full-deployment diagnostic is unchanged.
The supervisor requires both services and transaction mode, supplies the same
owned loopback endpoints/genesis, and owns cleanup. `MILO_LOCAL_BOOTSTRAP_MODE`
accepts only `full` (default) or `staged`. No public network or external credentials
are introduced.

## Sequence and invariants

1. Validate all original artifacts and create the original constructor state.
   Convert the serialized state across the ledger-v8 / Compact runtime boundary;
   do not pass one WASM runtime's `ChargedState` object to the other. Reject
   constructor coin effects and unexpected balances.
2. Create one deployment with seven verifier keys and one disposable maintenance
   signer. `reserve` is deliberately absent from this initial set. Record the
   deployment address before submission. This partial bootstrap is not admissible.
3. Resource-check the wallet-finalized transaction, submit once, observe the indexed
   result at its returned block, and inspect exact ledger, seven-key set and authority.
4. Insert the other seven original keys with one signed `MaintenanceUpdate` bound
   to the same address and observed counter. Resource-check, submit once, observe
   and inspect all 14 keys, exact entrypoint set, ledger and authority. This complete
   but upgrade-trusted state is still not admissible.
5. Only after complete inspection, replace authority with an empty committee and
   threshold **one**, using the next maintenance counter. Again resource-check,
   submit once, observe and inspect complete keys, unchanged `DEPLOYED`/revision 0
   ledger and the expected locked authority.
6. Stop. No canonical quote binding, reservation, pilot or R1 is claimed.

The transport never retries an unknown submission. A missing, malformed, partial,
unexpected-counter or mismatched observation prevents subsequent operations. This
is an ephemeral diagnostic: it does **not** implement durable actor-private recovery.
An interrupted run must not be resumed by guessing or automatically deploying another
address for the same order. Disposable incomplete deployments remain non-admitted.

## Source-backed API choices

- Pinned ledger-v8 8.1.0 exposes `ContractDeploy`, `ContractState.setOperation`,
  `VerifierKeyInsert`, `ContractOperationVersionedVerifierKey('v3', bytes)`,
  `MaintenanceUpdate`, `ReplaceAuthority`, `signData` and `verifySignature`.
- Midnight.js contracts 4.1.1 uses the same signed-maintenance construction and
  `Transaction.fromParts`/`Intent.addMaintenanceUpdate` path. Its high-level insert
  helper is single-key; this experiment uses the supported ledger update-array
  interface for seven insertions, not modified generated code.
- The versioned key getter returns untagged payload bytes, while the installed
  operation getter returns the serialized verifier artifact. Tests distinguish
  those representations; actual state inspection still requires exact full-artifact
  byte equality. No prefix stripping is used to weaken deployed-key checks.
- Wallet `calculateTransactionFee` delegates to `feesWithMargin` plus configured
  overhead. Recorded SPECK values are **SDK fee estimates with margin**, not observed
  settled charges, currency prices or a passed commercial cost gate.

## Remaining gates

The [retained-key audit](maintenance-audit.md) now records pre-lock positive/counter/
replay controls and seven post-lock rejections. The separate [actor recovery
audit](recovery-audit.md) records actual actor-process interruption with fresh
reconciliation and no duplicate send. Neither adds admission permission to this
three-transaction bootstrap diagnostic.

Even successful deployment, complete installation and positive lock observation
do not prove rejection of every maintenance attack. Required next evidence includes
quote/payment-window validation, atomic canonical binding, reservation, broader
wallet/provider/browser/device recovery, independent actors and the rest of the
MID lifecycle. Unit transport failures are not real network interruption or
recovery evidence; the successful actor restart kept the broker/key alive. Provider/operation completion
counters and R1 must not advance from this experiment alone.
