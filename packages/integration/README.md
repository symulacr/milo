# Bounded native-network integration

## Separate Preprod profile

`npm run preprod` runs a read-only profile check in this package's pinned Node
24.20.0 process. It never constructs a testkit wallet, reads a seed, signs,
submits, deploys, or records order admission. `local.mjs`, `bootstrap.mjs` and the
native admission observer retain their `undeployed` guards unchanged.

Required public settings (no defaults inferred from the node being checked):

- `MILO_PREPROD_NETWORK_ID=preprod`
- `MILO_PREPROD_GENESIS_HASH`: independently approved lowercase `0x` + 64-hex hash
- `MILO_PREPROD_RUNTIME_SPEC_VERSION`: independently approved positive integer
- `MILO_PREPROD_MODE=observe` (default) or `deployment-preflight`

RPC and GraphQL endpoints are fixed to official Preprod HTTPS services. WS routes
match testkit 4.1.1's Preprod configuration; WS connectivity is not tested by this
HTTP check. Unknown `MILO_PREPROD_*` settings and any `MILO_LOCAL_*` settings are
rejected rather than silently ignored. Run this profile in a separate environment
from local diagnostics. Chain identity, genesis, finalized block, runtime spec,
node version and indexer block agreement must match; redirects and indexer lag
fail closed. The historical public health receipt in `docs/receipts` is reference
evidence, not automatic approval of a current chain or deployment.

Deployment **preflight**, not deployment execution, additionally requires:

- `MILO_PREPROD_ALLOW_PREFLIGHT=owned-preprod-test-only`
- `MILO_PREPROD_ARTIFACT_SET_SHA256` and
  `MILO_PREPROD_COMPILE_RECEIPT_SHA256`: independently approved compiler receipt
  fingerprints; do not substitute hashes copied from an untrusted client
- `MILO_PREPROD_PROOF_HTTP`: explicit loopback HTTP proof service, e.g.
  `http://127.0.0.1:6300`, without credentials, query, fragment or subpath

Preflight validates the original source, complete 60-file generated inventory,
compiler 0.31.1/language 0.23.0/runtime 0.16.0, artifact hashes, installed direct
SDK cohort and lockfile before contacting Preprod. It does not probe the proof
service, validate Lace, prove a circuit, estimate DUST or validate a deployment.
All outputs explicitly retain `sdkCompatibilityVerified: false`,
`deploymentVerified: false`, `admissionVerified: false` and zero submissions.
Do not pass this output to trusted order-admission storage as contract evidence.

The [official compatibility matrix](https://docs.midnight.network/relnotes/support-matrix.md)
(checked 11 September 2026, **Preprod** table) specifies wallet SDK 1.2.0,
Midnight.js/testkit 4.1.1, node 1.0.2, indexer 4.3.3-hotfix and proof server 8.1.0.
The [endpoint table](https://docs.midnight.network/relnotes/network.md) supplies
the fixed HTTP routes. This patch reconciles the installable wallet SDK and tests
real exports, preprod codec round-trip/cross-network rejection, and shared ledger
identity. Testkit 4.1.1 retains its own wallet SDK 1.1.0 barrel; no transitive
override forces it onto 1.2.0. The compatibility test checks that both installed
barrels resolve the same concrete facade, address-format and ledger packages,
and checks constructor identity. This is import/codec compatibility evidence,
not proof of transaction or wallet synchronization compatibility.
Remote indexer/prover versions and actual SDK transaction compatibility
remain unverified. A consented deployment and independently verified locked state
against a trusted frozen quote are still required before reservation.

Scope: blueprint §§3.3, 3.7, 4; roadmap M-01–M-03/R1; building guide §3.2; audit §5. This is a separate **Node 24.20.0 LTS process**, following the blueprint's authoritative tool pin, not the incidental host runtime. It is not a browser adapter, backend, payment flow or pilot. It uses the original `packages/contract/generated` output without editing/copying it. Compile all contract keys first using the contract README.

See the [SDK → chain → Milo integration map](../../docs/midnight-integration-map.md)
for the six providers, runtime/privacy boundaries, native evidence and remaining
application-integration gates.

The staged read-only observer now returns version-2 internal records with all
four immutable deadlines from the verified original ledger. Only an allowlisted
projection is emitted; deadline values, terms/roles and private inputs are omitted.
The [v2 native receipt](../../docs/receipts/admission-timing-2026-09-10.json)
does not establish the backend's separate capture-window policy against real
payment/auth/storage providers. Earlier v1 records are not silently upgraded.

The opt-in [staged-bootstrap diagnostic](../../docs/staged-bootstrap.md) now observes
seven-key deployment, seven-key installation and a positive maintenance-lock state
on one address. Invoke the native supervisor with `--with-services --transactions
--staged-bootstrap`. It resource-checks every transaction, inspects exact state/keys
at each indexed block, and **stops before reservation**. The default full-deployment
path remains blocked by the measured weight limit. Its former diagnostic reservation
call has been removed: neither mode exposes a circuit-call path before admission exists.

Add `--maintenance-audit` to opt into the [retained-key negative audit](../../docs/maintenance-audit.md).
It requires exact node-side authority rejection and later unchanged state; it does
not treat generic errors as passing tests or enable reservation.

Add `--maintenance-controls` with that audit for pre-lock positive maintenance,
stale/future-counter and signed-update replay controls. `--recovery-audit` is a
separate staged mode: it kills an actor worker after deployment submission but
before acknowledgement, restores the encrypted journal in a fresh process and
reconciles the saved transaction without resending. See
[recovery scope and evidence](../../docs/recovery-audit.md). Neither mode enables
canonical admission or reservation.

## Commands and lifecycle interface

```sh
npm --prefix packages/integration ci --ignore-scripts --no-audit --no-fund
npm --prefix packages/integration test
node packages/integration/src/local.mjs
```

Run these commands with the parent-provisioned Node 24.20.0 runtime on `PATH`; the parent owns runtime installation and service lifecycle. The service owner must supply all environment values explicitly. Only literal loopback HTTP/WS URLs are accepted; no remote Preview, faucet, DNS alias, credential-bearing URL or default endpoint is used.

| Environment | Meaning |
| --- | --- |
| `MILO_LOCAL_ALLOW_TRANSACTIONS` | Exact acknowledgement `disposable-owned-local` |
| `MILO_LOCAL_NETWORK_ID` | Exact local ledger/wallet ID `undeployed` |
| `MILO_LOCAL_GENESIS_HASH` | Independently observed `chain_getBlockHash(0)`, lowercase `0x` plus 64 hex digits; rechecked before any wallet starts |
| `MILO_LOCAL_NODE_HTTP`, `MILO_LOCAL_NODE_WS` | Owned native node RPC endpoints |
| `MILO_LOCAL_INDEXER_HTTP`, `MILO_LOCAL_INDEXER_WS` | Owned indexer GraphQL HTTP/subscription URLs, including their API paths |
| `MILO_LOCAL_PROOF_HTTP` | Owned trusted local proof-server URL; it receives private proving inputs |
| `MILO_LOCAL_TIMEOUT_MS` | Optional whole-process deadline, default 900000, bounded 10000–1800000 |

The parent lifecycle owns node/indexer/prover, verifies their readiness and indexer block identity, and resets **its own** chain/indexer state together. This harness never launches or tears down services. It stops its wallet subscriptions. Timeout/failure does not establish rejection or rollback: a submitted transaction may still finalize. Keep the emitted identifiers for reconciliation, then discard/reset the disposable run. Ordinary diagnostics keep actor secrets in memory; the explicit recovery mode persists an encrypted, context-bound actor journal with its key held separately by the surviving coordinator. It does not establish browser/device or full-wallet recovery. Do not use this harness for an active order or real assets.

## Behavior and evidence boundary

1. Before any wallet construction or network request, validate `generated/compile-receipt.json` against the actual Compact source and exact 60-file artifact inventory (all hashes, no missing/extra files or symlinks). Verify compiler 0.31.1/language 0.23.0/runtime 0.16.0 metadata and the complete 14-circuit set. Check canonical Node 24.20.0, direct installed SDK/runtime versions and package/lock metadata. Emit source, compile-receipt, artifact-set, compiler launcher/binary/ZK executable and package/lock fingerprints. Then verify the explicitly supplied genesis hash and load the original generated module; compare loaded verifier bytes with the validated receipt.
2. Use testkit's **public** `new LocalTestEnvironment(logger).genesisMintWalletSeed[0]` to build only the funding wallet with the supplied endpoints. The constructor only captures configuration; no `start`, injected Docker environment or container-discovery method is called. No seed literal is copied into tracked code or receipts.
3. Register local genesis NIGHT for DUST using testkit's `waitForFunds` if needed. Create a fresh random buyer wallet in memory; transfer **50000 NIGHT (50000000000 smallest units)** with wallet SDK's typed transfer recipe, sign/finalize/submit it, and observe the funding transaction through the indexer. This matches the [pinned upstream local-dev funding default](https://github.com/midnightntwrk/midnight-local-dev/blob/902561ddc27a4b096f19835ab1528f38ace515f1/README.md#funding-options), not a measured fee requirement. Register the buyer's NIGHT for DUST; positive observed DUST establishes registration/accrual only, never transaction affordability.
4. Deploy the original generated Milo contract with a random nonce, salt and role commitments. Private buyer witnesses are in the in-memory provider; merchant/operator openings are not retained because this bounded harness does not execute their operations.
5. Inspect the deployment at its observed block hash, comparing all generated ledger fields with the expected bootstrap and the complete entrypoint/verifier set. Confirm the expected single-signature maintenance authority.
6. Submit a signed ledger `MaintenanceUpdate`/`ReplaceAuthority` setting an empty committee and threshold **one**, with the next authority counter. Observe the policy, unchanged ledger and verifier set at the finalized block. This is a ledger-supported impossible quorum, not local key deletion or threshold zero.
7. Stop with `reservationExecuted: false`. A label saying “non-admitted” is not an
   admission guard. There is no reservation call or environment switch to enable one;
   a future implementation must enforce the complete canonical admission sequence.

JSONL receipts whitelist public identifiers, artifact hashes and assertions; never serialize SDK transaction results, private state, seeds, witnesses or errors. Testkit logging is set to `silent` before any wallet builder runs because its default builders explicitly log seeds. Proof-provider completion during deployment/maintenance is not a Milo circuit-proof claim; neither diagnostic executes reservation. Errors report stage, current SDK boundary, a fixed allowlist of error/cause names (including Effect's typed failures), and bounded existing source-file locations. Messages, stack headers, function arguments, arbitrary names and serialized error objects are never emitted.

Each wallet facade's published `submitTransaction` method is wrapped before wallet startup. This also captures submissions hidden inside testkit's `waitForFunds` DUST registration. The wrapper calls ledger-v8 `tx.identifiers()` and emits `submission-attempt` with the public, version-tagged identifiers and `transactionBytes` **before** invoking the original method with its original receiver. The byte count comes from the finalized transaction's published `serialize().byteLength`; its bytes are never emitted or persisted. It emits `submission-returned` only after receiving an identifier belonging to that transaction. Funding, registration, maintenance and contract transactions share this boundary. An attempt receipt is not acceptance or finalization; it survives a thrown/uncertain submission result for reconciliation. No SDK object is logged and silent seed logging remains enforced.

Artifact validation establishes consistency and freshness against the repository-owned compiler receipt, not authenticity against an attacker able to replace both source and receipt. The actual compiler/tool hashes are auditable fingerprints, not a claim that the receipt cryptographically attests which binary performed the historical build. Do not rebuild or replace the artifacts during a running isolated harness.

For each actual proved deployment, maintenance or call transaction, wallet balancing now obtains `calculateTransactionFee(tx)` as the base fee, waits for synced observed DUST covering that floor, then calls `estimateTransactionFee(tx, dustSecretKey, { ttl, currentTime })` including balancing overhead. Only successful `balanceUnboundTransaction` establishes `dust-fee-ready`. The current synced wallet state is evaluated on emissions and one-second accrual checks, bounded by the original process deadline and transaction TTL; there is no fixed sleep or guessed fee margin. A typed `Wallet.InsufficientFunds` with `tokenType: "dust"` during estimation/balancing waits for a strictly increased observed balance before trying again. Other tokens, unrelated errors and mixed failures are not retried. Signing and finalization (which can reserve inputs) occur once, outside the retry loop, followed by the separate single submission boundary. No unknown submission outcome is resubmitted. Receipts contain readiness assertions/reasons, not invented fee amounts or benchmark claims.

`immutableOrderAdmission` and `r1Complete` remain **false**. This slice does not verify adversarial maintenance-operation rejection, malicious bootstrap deployment, canonical quote/address binding, independent actor lifecycle, replay/recovery or the remaining MID operations. Positive policy observation alone must not close admission. Preserve deployment/maintenance identifiers as partial local evidence, not completed MID rows. The source canary preventing SDK circuit-call entrypoints is a regression guard, not an admission implementation or network proof.

## Exact source and dependency receipt

`package-lock.json` pins the isolated resolved graph and npm tarball integrity. Direct SDK/testkit packages are **4.1.1**, `compact-runtime` **0.16.0**, `onchain-runtime-v3` **3.0.0**, `ledger-v8` **8.1.0**, dashed `wallet-sdk` **1.2.0**, and RxJS **7.8.2**. Testkit retains its own exact **1.1.0** barrel; both resolve the same concrete facade **4.1.0**, address codec **3.1.2**, and ledger **8.1.0**. Tests verify those module identities; no override forces testkit onto a different declared dependency. The resolved graph changed, so historical native receipts do not verify this updated graph. A scoped Node module hook resolves the untouched generated module's Compact runtime import into this package, avoiding duplicate WASM object identities with the root Bun dependency graph.

Authoritative implementation/declarations inspected from the exact installed packages (npm tarballs/integrities retained in the lockfile):

- [testkit-js 4.1.1](https://www.npmjs.com/package/@midnight-ntwrk/testkit-js/v/4.1.1): `dist/index.mjs`, `test-environment/test-environments/local-test-environment.d.ts`, `wallet/midnight-wallet-provider.d.ts`, `wallet/wallet-utils.d.ts`, `contract/in-memory-private-state-provider.d.ts`. Public genesis property, constructor behavior, seed logging, wallet creation and NIGHT/DUST registration. Apache-2.0; seed material remains in ignored dependency tooling and process memory.
- [midnight-js-contracts 4.1.1](https://www.npmjs.com/package/@midnight-ntwrk/midnight-js-contracts/v/4.1.1): deployment, `verifyContractState`, `submitTx`, governance source. High-level `replaceAuthority` only accepts a new signing key; it is **not** an irreversible locking API. The harness uses the documented ledger primitive rather than pretending that method revokes authority.
- [ledger-v8 8.1.0](https://www.npmjs.com/package/@midnight-ntwrk/ledger-v8/v/8.1.0): `ledger-v8.d.ts`, `ContractMaintenanceAuthority`, `MaintenanceUpdate`, `ReplaceAuthority`, `Intent`, `Transaction`, `signData`. Empty committee/threshold-one semantics and update counters; corroborated with resolved `compact-js` `effect/ContractExecutable.js` authority-update implementation.
- [wallet-sdk 1.2.0](https://www.npmjs.com/package/@midnight-ntwrk/wallet-sdk/v/1.2.0): resolved facade `transferTransaction`, `signRecipe`, `finalizeRecipe`, `submitTransaction`, and address codec declarations. Its submission implementation returns `tx.identifiers().at(-1)`; ledger-v8's public `identifiers(): TransactionId[]` API and the SDK deployment test establish the 66-hex-character identifier encoding used here. Import/codec tests are not public-chain transaction evidence.

## Verification

Twenty-eight tests passed at that checkpoint on canonical **Node 24.20.0**; as of 18 September 2026 the suite is 106 tests, and `bun run test:integration` from the repository root provisions the pinned runtime, runs `npm ci --prefix packages/integration` and executes all of them (see `scripts/test-integration.ts`): the earlier sixteen artifact/cohort, privacy, funding, receipt and generated-runtime/SDK tests; six read-only resource guard tests; and six staged-bootstrap/configuration tests. The new tests cover original state/key preservation, exact entrypoints, false locks, unexpected balances, signed address/counter/key binding, opt-in mode, and transport interruption/unknown/tampered-state refusal. They require real generated artifacts and never skip if absent. They are local construction/boundary tests, **not live failure or recovery evidence**. Native staged observations are recorded separately in the linked experiment.

The parent's first native run (`run-OsIsLO`, incidental Node 24.19.0) observed funding finalization and positive buyer NIGHT/DUST, then deployment proof-provider completion followed by failure before deployment submission. The exact 4.1.1 SDK executes `proveTx → walletProvider.balanceTx → midnightProvider.submitTx`; these receipts narrow failure to post-proof wallet balancing, not proof-provider construction. The old error boundary discarded the underlying classification, so the specific cause cannot be recovered from that receipt. Positive DUST alone does not establish transaction affordability. No deployment, reserve, maintenance-lock or R1 success is established by the first run.

The subsequent parent-owned Node 24.20.0 run (`run-nacq7y`) identified `Wallet.InsufficientFunds` in `wallet-sdk-dust-wallet/dist/v1/Transacting.js:279:32` at `MID-T01-deploy` / `walletProvider.balanceTx`. This confirms insufficient DUST, not a signature or proof-provider API mismatch.

### Confirmed node resource rejection; targeted next experiment

The parent's `run-KxqoEk` passed actual fee balancing and emitted a deployment submission attempt, but no deployment submission return/finalization. Allowlisted extraction from retained `transactions.stderr.log` identifies JSON-RPC **1010**, `Invalid Transaction`, and the exact static reason `Transaction would exhaust the block limits`. This maps to **`InvalidTransaction::ExhaustsResources`**, not a successful submission, and not another DUST-readiness failure. The old diagnostic allowlist missed the SDK's nested `SubmissionError`/`RpcError` names; these are now included, with integer `rpcCodes` and exact `transactionValidity` enums from `RpcError.data`. Arbitrary messages/data are not emitted. No live rerun with the latest RPC/byte-count instrumentation is claimed.

Pinned source evidence:

- Node [runtime block limits](https://github.com/midnightntwrk/midnight-node/blob/node-1.0.0/runtime/src/lib.rs#L308-L321): 1 MiB block length with a 75% normal-dispatch ratio, and `BlockWeights::with_sensible_defaults` using `2 * WEIGHT_REF_TIME_PER_SECOND` with the same ratio. These source constants do not alone identify which limit the attempted transaction exceeded.
- Node [Midnight dispatch weight](https://github.com/midnightntwrk/midnight-node/blob/node-1.0.0/pallets/midnight/src/lib.rs#L615-L620): ledger transaction cost plus configurable transaction-size weight. Do not assume this is merely serialized byte size or change runtime limits to mask the failure.
- The node's Cargo.lock pins Polkadot SDK commit `2e4dd0bc22366a5af820492528869a493b5a5208`. Its [validity conversion](https://github.com/paritytech/polkadot-sdk/blob/2e4dd0bc22366a5af820492528869a493b5a5208/substrate/primitives/runtime/src/transaction_validity.rs#L106-L130) establishes the exact rejection-to-enum mapping; [weight defaults](https://github.com/paritytech/polkadot-sdk/blob/2e4dd0bc22366a5af820492528869a493b5a5208/substrate/frame/system/src/limits.rs#L393-L405) also reserve initialization weight.
- Installed `@polkadot/rpc-provider/coder/error.js` exposes numeric `code` and arbitrary `data` on `RpcError`. The diagnostic extractor emits the former only when a bounded integer, and maps the latter only by exact equality to known static validity strings.

The September 7 receipt lacks finalized transaction size/cost, so its exact dimensions
cannot be reconstructed. The [September 10 preflight](../../docs/deployment-resources.md)
now measures a fresh complete deployment at a finalized block: **30,804 encoded bytes**
fit the **786,432-byte** normal limit, while **1,330,680,000,001** declared ref-time
exceeds **1,299,891,843,000**. It stops before submission; the transaction command exits
1 and cleans up, rather than presenting the blocked deployment as a passing test.

The probe calls `state_call("MidnightRuntimeApi_get_transaction_cost", SCALE(Vec<u8>), block)`
and reads block-scoped limits/configured weight. It does not invent a
`midnight_getTransactionCost` RPC or use the absent `TransactionPaymentApi`. It emits
only allowlisted measurements and fingerprints; raw bodies/errors remain private.
Passing an individual comparison would not establish full validity, block occupancy,
finalization or admission. Staged bootstrap is implemented and separately evidenced
in [the staged experiment](../../docs/staged-bootstrap.md); it does not make the
full deployment fit. No automatic
resubmission, rule changes, circuit omission or cohort upgrade is authorized.

## Trusted admission observation coordinator

`createAdmissionObservationCoordinator` in `src/admission-observation.mjs` is an
**internal server-only composition boundary**, not a public action, browser API,
authentication check, or admission mutation. Its request accepts exactly
`{ quoteId, address }`. Extra configuration, policy, fingerprint, endpoint,
clock, and observer fields are rejected before quote retrieval.

The server supplies `getFrozenQuote(quoteId)`, which must retrieve one persisted
frozen version as `{ quote, configuration }`: the backend `FrozenQuote` record
and its public Compact constructor configuration, never private terms openings
or role capabilities. Server-owned `observerOptions` contain validated artifact
receipt/verifier keys, coin public key and network/genesis profile;
`observationOptions` contain the configured RPC/indexer/observation transports.
The default observer is the existing native `prepareAdmissionObserver`, not a
synthetic chain adapter. `prepareObserver` is injectable only at trusted server
construction for explicit test doubles. Do not derive these dependencies from
request payloads.

Before any chain read, the coordinator compares every independently derived
expected policy field with the frozen quote. It validates the returned native
record, its policy/address, locked initial state metadata, content-derived ID,
and bounded observation time, returning `{ quoteId, quoteVersion, observation }`.
Timeouts fail closed but do not cancel an in-flight dependency; transports must
honor the supplied deadline and the quote loader needs its own operational bound.
Elapsed-time rejection cannot interrupt a hung injected loader or RPC. A
production worker needs a supervisor timeout and resource cleanup; the native
harness already has its enclosing process timeout. A promise race alone would
not cancel the underlying work. Do not log the protected quote, constructor
configuration, or private inputs: the staged diagnostic emits only allowlisted
observation evidence and explicit synthetic-source/non-admission flags.

The receiving internal atomic mutation must re-read the frozen quote/version,
recheck policy and freshness, authenticate membership, retrieve trusted payment
authorization and timing policy, and enforce nonce/address/quote uniqueness
while persisting the canonical binding. Its read-only result does not close the
time-of-check/time-of-use (TOCTOU)
or authentication boundary: the mutation must atomically compare the current
quote version with the returned `quoteVersion` and reject a changed version.
The coordinator performs **no** storage, payment, authentication, deployment,
or reservation. Returning an observation
does not admit an order, prove a payment hold, or authorize `reserve`.
It retains the native observer's local `undeployed` network restriction.

The non-recovery `local.mjs` staged diagnostic now exercises this coordinator
with native node/indexer transports and the default native observer. Before
deployment it snapshots the synthetic `freshOrder()` public configuration and
its expected policy into an explicitly synthetic in-memory quote fixture. This
is not an independently persisted commercial quote or an authenticated loader.
The `admission-observation-verified` event labels
`frozenQuoteSource: "synthetic-in-memory-fixture"` and explicitly reports false
for canonical persistence, authentication and payment verification. This proves
only the exercised bridge when the native diagnostic actually succeeds; it does
not close the database/provider admission gate. Recovery-audit mode still skips
this observation path because its configuration belongs to the recovered actor.
