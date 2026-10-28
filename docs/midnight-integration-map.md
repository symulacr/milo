# Midnight → chain → Milo: implementation map

**Provider continuation:** `/connections` now separates SDK-backed Privy identity,
optional Convex session verification and preprod-only Lace connection diagnostics
from the synthetic workspace. The Stripe adapter independently retrieves test
payment state when configured, but is not exposed as an application action.
These additions do not connect simulated orders, enable business circuits, or
extend the native observer beyond `undeployed`. See
[provider setup](provider-setup.md) and [network policy](network-policy.md).
The native execution evidence below predates this provider checkpoint.

**Scope: source inspection on 10 September 2026.** Milo has a real Compact
contract and an isolated native Midnight SDK/chain integration, plus a separate
synthetic browser application. It does **not** yet have an end-to-end commercial
order flow. Native staged deployment, maintenance-lock controls, bounded
actor-process recovery and the read-only admission observer have native evidence;
canonical admission, reservation,
browser wallet integration and live application-provider adapters remain gates.

This map explains wiring, not acceptance certification. The [blueprint](../01-blueprint.md)
owns protocol/privacy decisions; the [manifest](../PROGRESS_MANIFEST.md) owns
readiness. Linked receipts identify their own native executions; the observer
result below is from the verified 10 September run, not a claim of commercial
admission or a browser integration test.

## 1. The actual path and the missing connection

The latest internal coordinator accepts only `{ quoteId, address }`, retrieves
frozen public constructor inputs through a server-owned loader, and checks the
quote against independently derived expected policy before any chain read. It
then validates the native observation and returns the quote version for a future
atomic admission mutation. See the [coordinator contract](../packages/integration/README.md#trusted-admission-observation-coordinator).
The local diagnostic's loader is explicitly a synthetic in-memory fixture, not
Convex, Privy or Stripe. The coordinator creates no binding and calls no business
circuit. Its downstream mutation must recheck the quote version and current
payment state; an observation hash is not authentication.

| Work possible in this environment | Boundary / prerequisite |
| --- | --- |
| Compile the unchanged contract and test the exact SDK cohort | Compiler/runtime tests are not chain execution |
| Run native node, indexer, prover and disposable staged transactions | Local synthetic funding only; no public-network spending |
| Exercise trusted quote-to-observer coordination and rejection tests | Real native reads, synthetic quote source; not admission |
| Implement/test internal persistence and worker contracts | Closing persistence requires the approved isolated Convex environment |
| Connect browser wallet and business circuits | Requires supported wallet/prover consent and canonical admission first |
| Complete a real prototype order | Requires authorized Privy/Convex/Stripe test configuration, payment observation, atomic binding, and full lifecycle/recovery evidence |

```text
packages/contract/src/order.compact
  → pinned Compact compiler (scripts/compile-contract.ts)
  → original generated JS + types + circuit IR + prover/verifier keys
  → artifacts.mjs validates source, complete inventory and runtime cohort
  → order.mjs loads generated module and supplies actor-local witnesses
  → local.mjs composes the six Midnight.js providers
      → proof provider / trusted native prover
      → wallet balance, sign and finalize
      → resource preflight, then node submission
      → indexer transaction result + exact block-scoped contract state
  → bootstrap / lock / negative-maintenance / recovery diagnostic receipts
  → trusted frozen-quote coordinator → native-verified read-only observer
  → backend ObservedDeployment record (with quote/version context)
  -- still requires independent payment/auth/atomic storage --> canonical binding
  -- not enabled --> buyer reserve circuit --> active Milo order

apps/web/src/App.tsx → packages/domain/src/prototype.ts → in-memory simulation
                       (no connection to the native path or backend policies)
```

The first path is not a browser wallet adapter. The staged path builds ledger
deployment/maintenance transactions with `ContractDeploy`, `MaintenanceUpdate`
and `submitTx`; it does **not** call a Milo business circuit. Successful bootstrap
therefore does not demonstrate a buyer's private `reserve` proof. The full path
uses `CompiledContract`/`deployContract`, but its complete deployment is currently
stopped by the measured resource limit.

Calling the proof provider for a deployment or maintenance transaction proves only
that transaction's applicable envelope/ledger work. It is not evidence that any
Milo business circuit, private terms check or buyer approval was executed.

**Native is not adapter-free.** The services are verified upstream executables and
the SDK/generated contract are not patched to bypass protocol checks. Milo still
implements SDK provider interfaces, uses testkit for disposable local wallets,
and has the runtime-resolution compatibility hook described below. Staged
deployment uses supported ledger maintenance operations under unchanged limits;
it is an explicit alternative to the oversized single-transaction deployment,
not evidence that that original deployment now fits. The browser is still
simulated. An absolute “no wrappers/workarounds, fully connected prototype” claim
would therefore be false.

## 2. Source, generated code and pins

| Layer | Actual source / exact selected version |
| --- | --- |
| Contract | [`order.compact`](../packages/contract/src/order.compact): one order, fixed role commitments, revision-checked transitions; 14 proof circuits |
| Compiler | [`compile-contract.ts`](../scripts/compile-contract.ts), [`setup-compact.sh`](../scripts/setup-compact.sh): Compact **0.31.1**, language metadata **0.23.0**, runtime **0.16.0** |
| Generated output | `packages/contract/generated/`: original `contract/index.js`, types/map, compiler metadata, and `.prover`, `.verifier`, `.bzkir`, `.zkir` per proof circuit; compile receipt separately records the exact **60-artifact** inventory |
| Midnight.js | [`packages/integration/package.json`](../packages/integration/package.json): compact, contracts, HTTP proof provider, indexer public-data provider, network ID, Node ZK config provider and protocol packages all **4.1.1**; testkit **4.1.1** |
| Ledger/runtime | Integration pins `ledger-v8` **8.1.0**, `compact-runtime` **0.16.0**, `onchain-runtime-v3` **3.0.0**; protocol ledger imports select the pinned cohort |
| Wallet/RPC | direct `wallet-sdk` **1.2.0** (testkit retains 1.1.0 barrel), `@polkadot/api` **16.5.6**, `rxjs` **7.8.2** |
| Local services | Native node **1.0.0**, indexer **4.3.3**, proof-server **8.1.0**; executable/image provenance in [native service sources](native-service-sources.md) |
| Execution | Root Bun **1.4.2**; integration Node **24.20.0** with its own `package-lock.json`; React **19.2.8** in the root package |

[`artifacts.mjs`](../packages/integration/src/artifacts.mjs) checks the actual source
hash, every artifact hash, no missing/extra files or symlinks, compiler metadata,
all 14 circuits, Node version, installed direct dependencies and lock metadata.
`local.mjs` then compares the loaded verifier bytes with that validated inventory.
This makes provenance explicit; hashes alone are not a chain admission decision.

[`order.mjs`](../packages/integration/src/order.mjs) uses a narrow Node module
resolution hook so the **original**, unmodified generated JS resolves the same
Compact WASM runtime as the isolated SDK package. Staged bootstrap separately
serializes/deserializes state between ledger-v8 and Compact runtime representations;
one runtime's state object cannot simply be passed as the other's.

Witness implementations return the actor's private state and requested value.
Role witnesses reject another actor's request and unavailable values fail closed.
The local fixture creates random nonce, commitments and terms salt, with a buyer
approval limit and USD image-pack terms; it is not a frozen backend quote.
Merchant/operator openings are not retained in this ordinary buyer-only diagnostic.

## 3. The six providers, exactly as composed today

All six are assembled in [`local.mjs`](../packages/integration/src/local.mjs).
These are SDK interfaces, not six product vendors.

| Provider | Current implementation | Boundary / responsibility |
| --- | --- | --- |
| `privateStateProvider` | `testkit.inMemoryPrivateStateProvider()` | Actor-local private state and deployment signing-key access; not Convex persistence or browser recovery |
| `publicDataProvider` | `indexerPublicDataProvider(indexerHTTP, indexerWS)` | Watches transaction results and queries public contract state at the observed block hash; not private terms or payment truth |
| `zkConfigProvider` | `NodeZkConfigProvider(originalGeneratedDirectory)` | Loads compiler-generated proving/verifying material from disk; keys are checked against the compile receipt |
| `proofProvider` | Wrapped `httpClientProofProvider(proofHTTP, zkConfigProvider, timeout)` | Calls `proveTx`, records only completion metadata; the trusted prover can receive private proving inputs |
| `walletProvider` | Adapter over testkit's `MidnightWalletProvider` / wallet SDK | Supplies coin/encryption public keys, waits for affordable balancing, signs the recipe and finalizes once; not app authentication or role authorization |
| `midnightProvider` | Adapter calling the buyer provider's `submitTx` | Performs applicable resource preflight and optional recovery submission fence, submits to the node and returns the identifier; observation follows separately |

Funding is local infrastructure, not Stripe or sponsorship: the harness uses
testkit's public local-genesis seed property only for its funding wallet, generates
a fresh buyer wallet, transfers **50,000 NIGHT**, and registers NIGHT for DUST.
The testkit constructor does not start Docker. Seed-bearing testkit logging is
silenced before wallet construction. Positive DUST is not proof of affordability;
[`dust.mjs`](../packages/integration/src/dust.mjs) bounds readiness retries around
balancing only, not signing, finalization or submission.

The node accepts/executes ledger transactions; the indexer supplies observations
used to verify results. [`config.mjs`](../packages/integration/src/config.mjs)
accepts a successful public receipt only for `SucceedEntirely`. Timeouts or lost
acknowledgements do not establish rollback. Stable submitted identifiers must be
reconciled rather than blindly resubmitted.

## 4. What native deployment proves—and does not

[`resources.mjs`](../packages/integration/src/resources.mjs) checks genesis,
uses finalized-block runtime data and calls
`state_call("MidnightRuntimeApi_get_transaction_cost", …, blockHash)` with the
encoded transaction. It compares encoded extrinsic length and dispatch weight
against that block's normal limits. It is not an invented fee RPC or a guarantee
of pool admission, full validity, capacity, finalization or settled fees.

The [full deployment measurement](deployment-resources.md) found **30,804 encoded
bytes**, below the **786,432-byte** limit, but declared ref-time
**1,330,680,000,001**, above **1,299,891,843,000**. The default diagnostic stops
before submission instead of relaxing chain limits.

The opt-in [`bootstrap.mjs`](../packages/integration/src/bootstrap.mjs) sequence:

1. Builds original generated constructor state: `DEPLOYED`, revision zero, empty
   balance and no constructor coin effects. Deploys seven original verifier keys;
   `reserve` is deliberately absent from this partial bootstrap.
2. Installs the other seven via signed maintenance updates **at the same address**.
3. Locks maintenance with an **empty committee, threshold one**, incrementing the
   authority counter. This is an impossible quorum, not threshold zero or merely
   deleting a local key. Ordinary lock counter is two; the extra positive control
   in the maintenance-controls mode makes it three.
4. At each indexed transaction block, checks exact generated ledger state,
   expected operations/verifier bytes, empty balance and maintenance authority.
   Each transaction passes its own resource preflight. Stops without reservation.

The [staged receipt](staged-bootstrap.md) records three successful indexed
transactions under unchanged limits. The [maintenance audit](maintenance-audit.md)
separately exercises retained-key attacks, positive and counter/replay controls;
post-lock authority rejection requires the exact node rejection and later unchanged
state, not just any exception. Neither experiment is commercial admission.

[`recovery-store.mjs`](../packages/integration/src/recovery-store.mjs),
[`recovery-process.mjs`](../packages/integration/src/recovery-process.mjs) and
[`recovery-worker.mjs`](../packages/integration/src/recovery-worker.mjs) implement
an opt-in encrypted actor journal and process restart. The [recovery receipt](recovery-audit.md)
records a killed actor after submission but before acknowledgement, a fresh worker
restoring and querying the indexer, and completion without duplicate submission.
The wallet broker and coordinator-held recovery key survive. This is **not** full
wallet loss, browser eviction, cross-device recovery or post-reservation recovery.

## 5. Where the chain reaches Milo policy

[`admission-policy.ts`](../packages/backend/src/admission-policy.ts) is real pure
policy code with transaction test doubles, **not a deployed Convex function**.
The browser may supply only quote/observation/authorization IDs and an address.
The repository adapter must independently obtain authenticated buyer identity,
server time, frozen quote, current observed payment authorization and trusted
`ObservedDeployment`, all within the atomic admission boundary.

The policy checks exact network/nonce/address, terms/roles/initial-state/artifact/
key-set/genesis fingerprints, all 14 entrypoints, `DEPLOYED` revision zero and a
locked-maintenance receipt. Current observations require `observationVersion: 2`,
`blockHash`, `blockHeight`, `stateFingerprint` and four immutable
`*DeadlineSeconds` values in addition to the policy fields. Each deadline must
match the trusted frozen quote. Admission must precede acceptance and satisfy
`resolutionDeadlineSeconds * 1000 + captureSafetyMarginMs < captureBeforeMs`.
The positive margin comes from server-owned policy, with no default or browser
override; actual capture expiry must come from an independent payment-provider
retrieval. Exact integer arithmetic prevents seconds/milliseconds rounding or
overflow. Version-1 records/fingerprints remain historical and are rejected rather
than silently upgraded; no deployed schema or data exists to migrate.
It also checks observation freshness, authorized
payment's quote version/amount/currency/buyer and active window, and atomically
preserves quote, `(network, nonce)` and reverse-address uniqueness. Fingerprints
and `source: "chain-observer"` are internal records, **not** cryptographically
verified signatures or acceptable caller-provided proof.

**Implemented and verified on the native lane:** [`admission-observation.mjs`](../packages/integration/src/admission-observation.mjs)
prepares an independent expected constructor from local configuration, checks
validated verifier bytes, and observes the exact locked state against finalized
node/indexer identity. It rechecks genesis and block identity and **returns** the
versioned internal `ObservedDeployment` record, including a hash of the serialized
observed state. `local.mjs` does not emit that full record: it emits only the
allowlisted `admissionObservationEvidence(observation)` projection, omitting
configuration, nonce, terms and role fields from the diagnostic output.
Domain-separated provenance fingerprints are not Compact commitments or signatures.
The local configuration is still **not an actual frozen backend quote**. This
read-only bridge does not perform canonical binding and does not replace payment
observation, authentication, atomic persistence or the subsequent buyer-authorized
reservation transition.

The [sanitized observer receipt](receipts/admission-observation-2026-09-10.json)
records **`run-k1ERXP`**, with supervisor and driver exit **0**. The run emitted
`admission-observation-verified` at block **33**, with `expectedPolicyMatched: true`;
all **18 pre-run source hashes** remained unchanged. This verifies the read-only
observation bridge against the native chain/indexer. It explicitly retains
`immutableOrderAdmission: false` and `reservationExecuted: false`: no canonical
database binding, live payment/auth adapter, UI connection or business circuit
execution is established by this result.

That receipt certifies the earlier version-1 producer only. The separate
[version-2 receipt](receipts/admission-timing-2026-09-10.json), **`run-xr5c1B`**,
records supervisor/driver exit 0 and exact locked state at block **32**, with all
18 pre-run source hashes unchanged. Version 2 adds deadline provenance; the
capture-window policy is verified by separate offline tests, not a live payment
observation. Neither result closes canonical admission.

[`settlement.ts`](../convex/settlement.ts) owns the durable inbox and the payment
operation reducers; it does not verify webhooks or call Stripe.
[`delivery-policy.ts`](../packages/backend/src/delivery-policy.ts) checks three-file
manifests, inspected digests and authorized access through internal repository
ports; it does not implement Convex storage or protected streaming. See the
[backend boundary](../packages/backend/README.md). Chain approval must not be
confused with payment capture, file-byte validity or a judgment of creative quality.

## 6. Runtime and privacy boundaries

| Runtime / storage | Present implementation versus intended role |
| --- | --- |
| Bun | Build/dev/test and native-service lifecycle orchestration; not a replacement for the pinned Node integration runtime |
| Node | Isolated SDK harness, wallet/proof/RPC composition, artifact files and actor-recovery processes; services are separate native executables |
| Browser | React app imports the deterministic domain fixture; actions, roles, payment holds, deployment and approval are simulations. No wallet/chain/backend integration is imported by `App.tsx` |
| Convex (planned) | Authorized application documents/files, atomic admission, durable inbox and independent chain/payment reconciliation; not participant witness or signing-key custody |
| Privy / Stripe (planned) | App authentication / external payment authority, respectively; neither substitutes for Midnight role capabilities |

The blueprint's browser wallet adapter still needs a tested wallet/version/browser/
network profile. Its connector and Midnight.js interfaces are different: asynchronous
address lookup versus synchronous SDK key getters, `balanceUnsealedTransaction`
versus `balanceTx`, and connector `submitTransaction` returning no transaction ID.
Stable ledger identifiers must be saved before submission. Network ID is scoped to
the JS module realm; provider objects alone do not isolate simultaneous networks.
These are design requirements, not a shipping browser adapter.

Public ledger data includes protocol version, configuration (network, nonce,
terms and role commitments, deadlines), phase/revision, delivery/evidence
commitments; operation keys and maintenance policy are also inspectable. In the
native harness, terms openings, buyer limit, role secrets and salts stay actor-local
except where the trusted proving path needs them. The target application separately
keeps authorized commercial documents and file bytes in protected Convex records/
storage; hiding terms from the chain does not mean hiding them from the authorized
application or counterparties. Witness secrets and recovery keys must not become
backend signing authority. ZK protects disclosure to the chain, **not**
against an untrusted proof recipient. Public commitments also do not conceal
transaction timing, order existence or all metadata.

The recovery journal uses AES-256-GCM and context binding; its key is delivered
over local IPC and held separately by the surviving coordinator. Seeds, signing
material, prepared transaction bodies, private state and even journal ciphertext
are not publishable diagnostic evidence. JSONL receipts allowlist public
identifiers/hashes/assertions and bounded error classifications, never raw SDK
results/errors. Native node/indexer are loopback-bound; the upstream prover binds
`0.0.0.0`, so **never expose its port through a Preview/tunnel**. The optional
Lumera public archive is planned and is not a destination for customer secrets.

## 7. What can be done in this environment now

The repository has a Docker-free native lane and project-owned provisioning for
Bun, Compact, Node, node/indexer/prover. No external account credentials are needed
to inspect source, compile, run local policy/runtime tests, build the synthetic UI,
or reproduce explicitly opted-in disposable native diagnostics. Tool files being
present does not establish service health; run the setup/readiness checks before
claiming a current native result.

```sh
# Root build and local correctness checks (use the repository's pinned wrapper).
npm run contract:cohort
npm run contract:compile
npm run test:unit
npm run typecheck
npm run build

# Provision/verify the isolated Node runtime and native service lane as needed.
npm run setup:integration-runtime
npm run setup:native-network
npm run test:native-network

# Explicitly opted-in disposable transactions; stops before reservation.
npm run test:native-node -- --with-services --transactions --staged-bootstrap
```

For integration unit tests/install, follow the [integration README](../packages/integration/README.md)
with **Node 24.20.0 on PATH**, not an incidental host `node`.
The native supervisor owns service setup/cleanup and supplies explicit loopback
endpoints, `undeployed` network ID, independently observed genesis and
`disposable-owned-local` acknowledgement. The harness has no remote endpoint,
faucet fallback or reservation-enabling environment switch. Use the dedicated
maintenance/recovery instructions for those separate opt-ins; do not reset or
attach to someone else's live chain.

Next local work includes repository-adapter contracts, expanded observation/
fingerprint rejection coverage and additional isolated
recovery cases. Admission can be tested with explicit doubles, but a double is not
independent live payment/auth evidence. Real Convex/Privy/Stripe integration and
signed-webhook tests require authorized project/provider configuration; a real
browser wallet needs an installed supported wallet, consent and tested proving/fee
route. Sponsorship, hosted QA and optional archive publication have separate
provider/approval gates. Those gates should remain explicit, not be bypassed with
fabricated credentials, browser flags or a local diagnostic's success label.

To proceed to a real connected prototype, the project owner must authorize an
isolated Convex deployment and Privy application, a Stripe test-mode account and
webhook setup, and the exact supported browser wallet/network/prover profile.
Provide configuration through the approved secret/configuration mechanism, not
chat or committed files. After those boundaries are available, implementation must
still establish trusted frozen-quote persistence and atomic admission before
submitting `reserve`, then verify the remaining lifecycle and independent-actor
recovery. If the intended prototype instead omits commercial admission/payment,
that is a scope/architecture decision—not permission to silently bypass the
current blueprint.
