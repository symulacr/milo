# Actor-process bootstrap recovery audit

This is an owned, disposable local experiment under blueprint §3.3. It is not a
browser-wallet recovery feature, canonical admission, or an R1/MID-completion
claim. It changes no Compact source, verifier artifacts, dependency cohort, or
chain limits. The wallet/prover/indexer broker remains running while the actor
process is lost and restarted.

```sh
npm run test:native-node -- --with-services --transactions --staged-bootstrap --recovery-audit
```

Recovery is an explicit opt-in and runs separately from the maintenance controls.
The same original three bootstrap transactions are required. No diagnostic worker
has an SDK circuit-call entrypoint, and no reservation is attempted.

## Recovery sequence

1. An isolated actor process generates its buyer witness and terms, the original
   maintenance key, and the public bootstrap configuration. It validates the
   compiled artifact fingerprint and stores an encrypted prepared intent.
2. **A `ContractDeploy` constructor randomizes its address.** The journal preserves
   the exact prepared deployment transaction, not just configuration from which a
   new deployment could be generated. Restore checks its sole deployment action,
   original address, complete initial state, and original verifier artifacts.
3. Before the wallet broadcasts, the actor durably journals **every** stable ledger
   identifier from the fully prepared transaction. The broker cannot send until
   the encrypted checkpoint has been synced and acknowledged.
4. After the deployment has been submitted and observed by the broker, it kills
   the actor with `SIGKILL` **before delivering the receipt**. The actor's journal
   therefore still says `pending`; the broker discards that acknowledgement.
5. A fresh actor process decrypts the journal, recomputes the buyer capability and
   terms commitments, and requests a fresh indexer lookup by a saved identifier.
   It verifies all saved identifiers, transaction hash, address, action kind and
   state. It does not resend the deployment or create another address.
6. Only after reconciliation and initial-state inspection can installation and
   locking proceed. Each subsequent send has the same durable identifier fence.
   Incomplete states fail the locked-bootstrap guard. Before advancing, current
   finalized node state is checked against the independent indexer observation.

The actor's pending outcome is genuinely lost across process termination. This
experiment does **not** kill/restart the wallet broker, simulate a browser profile
or device loss, or test a real provider/network outage. Those remain separate
recovery acceptance cases. An unresolved lookup, partial transaction result,
wrong identity, or invalid private context stops progression without a resend.

## Private journal boundaries

`recovery-store.mjs` uses AES-256-GCM with a fresh nonce per checkpoint and an
external 32-byte recovery key. Authenticated context binds schema, network,
genesis, artifact set, actor identity, and order identity. The key is delivered
in memory over local IPC, never through command arguments, environment variables,
public receipts, or a plaintext file next to the ciphertext.

The bounded encrypted record contains the actor-local witness/terms, original
maintenance signing key, public configuration, exact prepared deployment and
ordered pending/confirmed identifiers. Strict schemas, ownership and private
permissions, no-follow reads, exclusive checkpoint locks, atomic rename and
file/directory sync protect persistence. Identity changes, regressions, tampering,
wrong contexts and unexpected fields fail closed. A stale checkpoint lock is not
authority to steal it or resend an unknown transaction: reconcile manually.

This is a local journal primitive, not a password-based recovery export product.
The test coordinator retains the recovery key across the actor restart and clears
its copy at completion. Recovery after loss of that coordinator/key, browser
storage eviction, another device, account reauthentication and full wallet loss
is not established by this test.

Only public identifiers, counts, hashes and allowlisted diagnostics enter the
execution receipt. Neither ciphertext nor prepared transaction bytes, witnesses,
terms openings, seeds or signing material are shareable test evidence.

## Verification status

The [sanitized native receipt](receipts/actor-recovery-2026-09-10.json) records
fresh final-source `run-jOvW0R`: durable driver exit 0 and supervisor diagnostic
completion/cleanup markers. The shell polling session was lost, so a directly
observed supervisor shell exit code is **not** claimed. The actor was
actually killed with `SIGKILL` after the broker obtained the deployment result,
before the actor received its acknowledgement. A new actor restored its encrypted
context and reconciled the pending deployment through a **fresh indexer query**
(`SucceedEntirely`, block 26); it did not reuse an acknowledgement or resend.
Installation and locking then completed at the same address: 14 operations,
`DEPLOYED`, revision 0, counter 2; three bootstrap submissions, zero duplicates.
The three individual resource preflights passed unchanged limits. Reservation
and immutable admission remained false.

The wallet broker and coordinator-held recovery key survived. This is actual
actor-process interruption, not wallet/broker loss, a provider outage, clean-profile
or cross-device recovery, or interruption after reservation. The separate worker
fixture uses test-double ledger transport and is not native evidence.

The actual [pre-run implementation snapshot](receipts/final-native-source-2026-09-10.json)
binds both final native runs; all 16 listed source files were verified unchanged
after recovery completed. Compiler/contract-source/artifact fingerprints were
also emitted during execution. Earlier successful `run-oyoIbg` had only
[post-run provenance](receipts/integration-source-observation-2026-09-10.json),
potentially after hardening; it is superseded, not retroactively source-attested.
The native receipt does not certify subsequent edits or remote CI. Final local
verification passed separately: lint (64 files), strict typecheck, plan check
(8 documents / 51 gate IDs / 185 links), 56 unit tests / 521 assertions,
50 integration tests on pinned Node 24.20.0, and build. Independent review reported
no concrete findings in integration or final scoped backend policies; that is
scoped review, not a broader security certification.

Canonical quote/payment-window validation, deployed atomic application binding,
buyer-proved reservation and the remaining lifecycle/provider rows stay open.
Milo remains **R0**, with completed Midnight coverage **0/6 providers and 0/14
operations**.
