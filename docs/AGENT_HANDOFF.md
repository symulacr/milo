# Milo agent handoff

## Current repair and completion pass

Stage 2 now adds `stripeCustomerProvisioning:provision`: a read-only provider-fact
adapter feeding the existing audited mutation, not a new ingestion lifecycle.
The account/customer facts are checked; the Milo buyer mapping remains an approved
internal caller's assertion. Do not describe email/metadata or this digest as
ownership proof. T09b2 requires an explicit authoritative source/operator decision.
T10a now persists public role commitments and canonical constructor encoding,
with reconstruction/fingerprint checks and the local-only observer guard intact.
T10b is next: trusted frozen-input loading and independent Preprod ingestion;
T10c still requires real artifact/key/network/state provenance. Legacy incomplete
rows need reviewed source-backed migration before the stricter schema deploys.
Consult the live manifest for fresh evidence; no provider gate is closed here.

12 September continuation: `provisioning:requestObservation` separates one-shot
read-only consent from creation, and new observation-mode jobs cannot create a
replacement intent if the immutable payment binding disappears. T14a passed 270
unit tests / 1,288 assertions, both typechecks, lint/build and the real local Convex
regression. Observation behavior is tested with doubles, not real Stripe requests.
The later [bounded monitoring checkpoint](payment-monitoring.md) adds five-minute
recurring-read consent, stop controls, stale-result fencing and lease recovery.
Use the live manifest for its current verification, not the earlier totals above.
The next checkpoint adds an authorized redacted status query and start/stop UI
under the existing verified Convex session, with explicit quote lookup and consent.
See the ordered plan in `TASKS.md`; reuse these controls rather than building another
client/authentication layer. Local control tests do not verify hosted login or Stripe.
Confirmation/settlement, connected lifecycle UI and real Stripe verification remain open;
bounded reads are not unbounded background reconciliation.

Use [TASKS.md](../TASKS.md) and [EXECUTION_MANIFEST.md](../EXECUTION_MANIFEST.md)
for in-progress repairs, fresh evidence and explicit blockers. Internal provisioning
is described in [its runbook](trusted-provisioning.md); external provenance and
connected acceptance remain open. Older checkpoints below retain their dated scope.

The earlier repair checkpoint passed 264 unit / 104 SDK tests, both typechecks,
lint/build/plan checks, local Convex admission concurrency/restart, and current-SDK
staged deployment, maintenance controls and actor restart (broker survives).
Connections navigation/retry and role-gate focus passed in offline Chrome; managed
Preview/provider UI and full accessibility are not verified. No public transaction,
buyer reservation, settlement or release gate was completed. Next implement T09b
and T10–T14 from the task list, not already-completed atomic admission or local repair work.

T09c is now locally verified too: actual internal provisioning first-write races,
idempotency, revocation and restart persistence passed with synthetic source labels.
The [receipt](receipts/provisioning-persistence-2026-09-11.json) records exact counts
and 21 unchanged pre-run source hashes. Do not repeat this local prerequisite as
unfinished or mistake it for T09b's real-source verification.

## Latest continuation — connected prerequisites, not lifecycle execution

See [implementation and remaining work](connected-implementation.md). Added
Preprod profile/preflight, direct Wallet SDK 1.2.0 with transitive identity tests,
Lace signing/submission transport and consent/recovery tests, approved-quote
freezing and generation-guarded internal Stripe creation/observation. No actual
payment or wallet transactions were executed. Concrete transaction authority,
native Preprod contract observer/deployment, trusted catalog/customer ingestion,
Stripe confirmation, UI wiring and full connected lifecycle remain incomplete.
R0/0-of-6/0-of-14 unchanged. 215 unit / 104 SDK tests and local Convex admission
regression passed. Historical native SDK receipts use the previous graph.

**Current boundary:** `provisioning:freeze` and consent-gated
`provisioning:requestPayment` are authenticated public mutations;
`stripeProvisioning:run` is an internal Node action with internal `begin`/`finish`
claim/persistence mutations. These requests remain one-shot; separately consented
`paymentMonitoring:start`/`stop` controls bounded read-only refresh.
Local Convex evidence covers deployment and synthetic admission concurrency/restart,
not hosted JWT or real Stripe worker effects/concurrency. Membership, approved
quotes/catalog, customers and chain observations still need trusted ingestion.
See [setup and distinct observer/provisioning permissions](provider-setup.md).

**Historical guidance below:** previous continuations and the dated September 10
baseline preserve their original evidence and next steps, not active absence
claims. Quote freezing, atomic admission and internal Stripe provisioning/ordered
observation have since landed as bounded prerequisites. Use the latest linked
checkpoint for current work; no historical receipt or new prerequisite closes a gate.

## Previous continuation — read-only public Preprod observation

User prioritized Preprod observation → buyer reservation → lifecycle. Added
`scripts/preprod-observe.mjs` and ten fail-closed tests. The public node and indexer
agreed on finalized block 2,500,305; one preceding attempt rejected indexer lag.
[Receipt](receipts/preprod-block-observation-2026-09-11.json) binds the source hashes.
This is not contract observation, SDK cohort acceptance or transaction execution.
No disclosed credentials were used. R0 / 0 of 6 / 0 of 14 remain unchanged.
Next: compatible preprod deployment/observer profile and fresh consented signing
wallet, trusted quote and admission provisioning. Payment provenance remains
required even though Stripe ingestion was deprioritized; do not bypass admission.
See [exact dependencies](network-policy.md#read-only-preprod-checkpoint--11-september-2026).

## Previous continuation — atomic admission and local persistence

Prior [PR #1](https://github.com/pcrsicp/milo/pull/1) merged at `060fb4e6` under
user authorization. GitHub returned no checks or registered workflows; this was
not a remote CI pass. Follow-up branch: `hoplite/kios-dfb1e49c-atomic-admission`.

`admission:bind` now uses actual Convex mutation semantics for authenticated buyer
membership, quote version, trusted observations, timing and canonical indexes.
The [native local receipt](receipts/convex-atomic-admission-2026-09-10.json)
shows one winner/seven replays/eight conflicts across 16 concurrent calls and
binding persistence across restart. The test identity and provider records are
explicitly synthetic. Checksum-before-execution and interruption cleanup passed;
all 16 pre-run source hashes remained unchanged. 155 unit tests / 757 assertions,
63 SDK tests, types, lint and build passed. No UI change or new Midnight transaction.

**Next at that checkpoint (partly superseded above):** trusted frozen quote/payment
provisioning and the internal Stripe observation action plus ordering/replay-safe
persistence. Input tables then had no application write API; do not insert invented provider records to enable
orders. Then validate real Privy/JWKS and the preprod observer/profile before any
buyer reservation. Hosted configuration remains necessary for hosted acceptance,
but local Convex concurrency testing no longer requires cloud credentials.
See [commands and boundaries](../packages/backend/ADMISSION.md). R0/0-of-6/0-of-14
remain unchanged. Earlier checkpoints below retain their dated limitations.

## Previous continuation — provider setup, preprod and licensing

The user selected Privy, Lace preprod and Stripe test mode and requested MIT plus
concise architecture docs. `/connections` now provides real SDK-backed login and
connection diagnostics, separate from sample orders. Convex auth/schema and a
read-only Stripe observer are present; no admission/payment mutation is exposed.
See [provider setup](provider-setup.md), [network policy](network-policy.md), and
the README sequence diagram. Root MIT excludes upstream third-party material.

Only the public Privy app ID was configured locally. No pasted app secret, Stripe
secret, wallet keys or recovery phrase was imported. Rotate disclosed credentials
and replace the wallet. Next requires an approved development Convex deployment,
matching Privy origin/JWKS configuration, membership provisioning, fresh Stripe
test configuration and a supported Lace extension. Then implement/test atomic
admission, payment reconciliation and consented preprod lifecycle execution.
Do not relabel the native `undeployed` observer as preprod-compatible.

Verification: 128 unit tests / 705 assertions; 63 isolated SDK tests; root/Convex
types, lint, build and plan checks. Static public config passed an HTTP read and
secret-canary check. Real browser opened Privy's email dialog without submitting
an email; consent gating, missing Lace and missing Convex states were verified.
Managed Preview is platform-blocked (startup requires promotion of an undiscovered
port, and settings lookup misses the existing repo config). A bounded foreground
dev-script diagnostic supplied browser evidence and was stopped. No authenticated
login, deployed backend, Stripe request or preprod transaction was performed.
R0 / 0 of 6 providers / 0 of 14 operations remain unchanged.

## Previous continuation — trusted observation coordinator

On 10 September 2026, continued from documentation commit `f2575d0` on
`hoplite/kios-dfb1e49c`. The internal coordinator in
`packages/integration/src/admission-observation.mjs` now retrieves frozen public
inputs through a server-owned loader and validates them before native reads.
The staged diagnostic exercises this path with an explicitly synthetic in-memory
quote, not an application database. Fresh `run-zYY0XT` finalized all three staged
transactions and observed locked initial state at block 32; supervisor/driver
exited 0 and all 16 captured integration source hashes stayed unchanged. See
[the scoped receipt](receipts/observation-coordinator-2026-09-10.json).

Full 14-circuit compilation, 63 unit tests / 586 assertions, 63 pinned-Node
integration tests, lint, typecheck and build passed. Independent review improved
semantic negative tests so stale content hashes cannot mask missing guards.
Native processes were stopped; no persistent browser network was established.
No contract/SDK/chain-limit change, auth, payment, binding or reserve was added.

**Next:** implement the authenticated persisted quote loader and approved atomic
Convex admission boundary, independently retrieved payment state and server-owned
timing policy. Recheck quote version atomically; supervise observation dependencies
with timeout/cleanup. Only then execute buyer-authorized reservation and the full
lifecycle with actor-owned recovery. Browser wallet/prover connection remains
separate. Do not replace required providers with local mocks to claim completion.
R0, provider coverage 0/6 and operation coverage 0/14 remain unchanged.

The checkpoint below is preserved historical discovery context; its references
to the "latest" implementation describe that earlier inspection, not this update.

Checkpoint: **10 September 2026**, inspected at commit
`9d9c321cbbb937506e50a8a5349a0cece7689e8e` (*Enforce chain-bound admission
timing and capture-window safety*). The live checkout at inspection was
`hoplite/kios-dfb1e49c`, aligned with `main`/`origin/main`, with no linked or
open branch PR. The only discovered uncommitted change was platform-generated
preview configuration, restored to the versioned repository configuration before
this documentation update.

The latest bounded implementation is version-2 deadline-bound admission
observation and local capture-window policy following the verified maintenance
controls and bounded actor restart.
Earlier native implementation `041d853` and reconciliation `5b735da`
remain historical receipts. This document is a continuation guide, not a replacement specification
or permission to claim unfinished gates. Refresh GitHub and workspace state before
acting: branch, PR, CI and running processes can change after this snapshot.

## 1. Start here

Use [the full execution task list](EXECUTION_PLAN.md) for all remaining workstreams;
this handoff's section 4 remains the immediate protocol priority. The legacy
pre-admission reservation path has been removed, not merely relabeled.

The [SDK-to-chain-to-Milo map](midnight-integration-map.md) separates working
native execution from the simulated web UI. The latest
[observation receipt](receipts/admission-observation-2026-09-10.json) verifies
expected state/keys/lock and finalized block identity in `run-k1ERXP`, not
canonical persistence or a real quote/payment decision. Next: supply the observer
from trusted frozen configuration and integrate authenticated, independently
observed payment state and an atomic repository before reservation. Local doubles
must remain separate from native/provider acceptance evidence.

Current policy additionally requires the four `*DeadlineSeconds` values in the
version-2 observer/quote, independently retrieved `captureBeforeMs`, and a positive
server-owned `captureSafetyMarginMs` from `getAdmissionTimingPolicy(network)`.
There is no default margin: resolution plus margin must be strictly before capture
expiry, and admission must precede acceptance. Legacy records cannot be relabeled
as v2; the earlier observer receipt remains evidence for its original source only.
The [v2 native receipt](receipts/admission-timing-2026-09-10.json) verifies
`run-xr5c1B` at block 32, with both supervisor/driver exit 0 and all 18 pre-run
source hashes unchanged. Capture-window policy tests used explicit doubles; no
real auth/payment/persistence or reservation was added. The current local suite
passed 63 unit tests / 586 assertions and 58 pinned-Node integration tests.

1. Inspect the checkout, dirty files, current branch and linked PRs. Preserve work
   you did not author. At this checkpoint the branch is `hoplite/kios-dfb1e49c`
   at `9d9c321`, aligned with `main`/`origin/main`, and no branch PR is open.
   PR #2 was merged with user permission at `72fbb23` before this iteration.
2. Read [the progress manifest](../PROGRESS_MANIFEST.md),
   [protocol verification](../PROTOCOL_VERIFICATION.md) and
   [the changelog](../CHANGELOG.md). They distinguish verified slices from gates.
3. Read the canonical documents below, especially blueprint §3.3, the admission
   sequence, the provider/operation tables, and the roadmap's M-01–M-03/R1 gates.
   Re-read the relevant sections **during** implementation, not just once.
4. Inspect current PR checks/review threads. The September 10 checkout is
   `roundbolder-afk/milo`; [continuation PR #1](https://github.com/roundbolder-afk/milo/pull/1)
   and [PR #2](https://github.com/roundbolder-afk/milo/pull/2) are merged;
   refresh the follow-up PR's review/auto-fix state. Earlier PR #1–#3
   links refer to the historical `amolikpe-bit/milo` repository, not current live
   PR status. Refresh any subsequently published continuation PR before acting.
5. Continue with canonical admission in section 4 and
   [the execution checklist](DEPLOYMENT_TODO.md). Native maintenance controls and
   actor-process bootstrap recovery are now bounded evidence, not admission.
   Do not start payment/cloud integration to avoid the blocked protocol gate.

### Authority and reading order

| Read | Owns |
| --- | --- |
| [01-blueprint.md](../01-blueprint.md) | Scope, privacy, protocol, admission, exact package decisions |
| [02-roadmap.md](../02-roadmap.md) | Work ordering, acceptance gates, R0–R5 and release boundaries |
| [03-building-guide.md](../03-building-guide.md) | Implementation and verification discipline |
| [04-ui-design.md](../04-ui-design.md), [05-ux-design.md](../05-ux-design.md) | UI, task flows, consent and presentation |
| [06-backend-design.md](../06-backend-design.md) | Auth, data/files, jobs and observation boundaries |
| [07-video-design.md](../07-video-design.md) | Truthful demo and publication requirements |
| [08-midnight-core-audit.md](../08-midnight-core-audit.md) | Source audit, unresolved evidence and Midnight priorities |

Historical audit statements describe their original evidence turn. Use the
manifest and execution receipts for subsequent implementation results. If prose
contradicts current evidence, correct it explicitly; do not silently change a gate.

## 2. What is done, partial, blocked and pending

**Highest completed release gate: R0.** No R1, controlled-pilot or live-pilot claim.
Completed provider/operation rows remain **0/6 and 0/14**. Actual partial provider
use exists, but that is not completion of each row's acceptance contract.

| Work | Current result | What must still happen |
| --- | --- | --- |
| Source-backed plan | Eight canonical documents; status/evidence ledgers | Resolve organizer date/rubric discrepancies before eligibility claims |
| UI foundation and prototype | Synthetic buyer/merchant/operator routes, sample files and browser-checked interactions | Real auth, files, wallet consent, recovery, accessibility/usability evidence; broader context inventory |
| Domain simulation | 14 tests / 79 assertions in the earlier UI/domain slice | Never use simulation as chain/payment evidence |
| Original Compact contract | Full compilation; 14 circuit artifact sets, 60 hashes; 20 contract tests / 372 assertions; complete staged key/state observation | Admission, operation and adversarial network evidence |
| Native services | Node block production, matching indexed block, prover queue readiness and scoped shutdown | Not a persistent browser network or proof of an executed Milo circuit |
| Disposable wallet funding | Finalized synthetic NIGHT funding; buyer NIGHT/DUST observed | Does not establish browser-wallet onboarding, order recovery or commercial affordability |
| M-01–M-03 / R1 | **Blocked at immutable admission/lifecycle evidence** | Staged deployment, pre/post-lock controls and bounded actor restart pass locally; canonical binding, reservation, broader recovery and adversarial operations remain |
| M-04–M-06 / R2 | Pending | Isolated Convex/Privy, real browser wallet, membership/files, independent actors and recovery |
| M-07 payments | Simulation only | Stripe sandbox, signature verification, actual authorization windows, capture/void and reconciliation |
| R3 MVP candidate | Pending | Required predecessors, Preview execution, privacy/security/failure review, supported-wallet and task evidence, runbook |
| M-12 submission | Pending | Exact SHA/evidence, honest demo and organizer requirements; GitHub publication is not submission |
| R4/R5 | Pending | Explicit live approval, legal/merchant arrangements, consent/support capacity; later real customer/economic evidence |

The latest [maintenance controls](maintenance-audit.md) and [actor recovery](recovery-audit.md)
receipts record final runs `run-f5Chw8` and `run-jOvW0R`, both durable driver exits 0.
Maintenance supervisor shell exit 0 was observed. Recovery's completion/cleanup
markers were verified, but its shell polling session was lost; no directly
observed supervisor shell exit code is claimed. The
earlier four-case checkpoint passed **37 Bun tests / 397 assertions plus 37 Node
tests** and static checks; those counts are historical, not a current-worktree claim.
The actual [pre-run snapshot](receipts/final-native-source-2026-09-10.json) covers
all 16 listed implementation files, verified unchanged after both final runs.
Earlier `run-9Q08JL` / `run-oyoIbg` had only post-run provenance and are not
retroactively source-attested. Compiler/artifact hashes were emitted during
execution. Final local verification passed: lint (64 files), strict typecheck,
plan check (8 documents / 51 gate IDs / 185 links), 56 unit tests / 521 assertions,
50 integration tests on pinned Node 24.20.0, and build. Independent review reported
no concrete findings in integration or final scoped backend policies. These
results do not establish current remote CI or provider/gate completion.
The earlier [resource investigation](deployment-resources.md) records the full
single-transaction blocker separately, including its limitations. Results
become historical after further changes. Remote CI must be inspected separately.

## 3. Non-negotiable patterns and invariants

- Preserve the tagline: **Private agreements. Clear approvals.**
- Seven service contexts share **one bilateral fixed-price protocol**, not seven
  contracts. Keep the `image-pack-v1` bounded three-image scope.
- Never rename/remove B-01–B-11, MID-P1–P6, MID-T01–T14, M-01–M-14 or R0–R5.
- Currency remains private agreed-terms data, not a public ledger field. The
  current artifact's fixed USD policy makes it inferable; that is not a public
  per-order currency field. Changing policy requires reviewed artifacts.
- Constructor execution is not proof of legitimate initialization. `reserve`
  independently checks bootstrap/public-configuration invariants; retain raw
  ledger-injection negative controls. Independent role witnesses, typed terms,
  revision checks and public block-time predicates must not be weakened.
- Admission requires the expected state and **complete** verifier/entrypoint set,
  observed irreversible maintenance policy, canonical address binding, then
  proved/observed reservation in the specified sequence.
- Empty maintenance committee with threshold **one** is the candidate impossible
  quorum. Threshold zero or deleting a local key is not a lock. Positive policy
  observation alone does not prove all maintenance attacks are rejected.
- Keep chain state, payment state and pending/unknown observations distinct.
  Persist identifiers before send. A timeout after submission is not rollback
  or rejection. Do not automatically resubmit an outcome-unknown transaction.
- The current integration driver is **diagnostic and non-admitted**. It retains
  only buyer openings for its bounded flow; merchant/operator openings are not
  retained. Its opt-in actor recovery lane restores that actor only, with the
  wallet broker and recovery key coordinator surviving. It is not independent-actor
  lifecycle, browser/device or full-wallet recovery evidence.
- Never lift node limits, omit circuit keys, skip proof generation or weaken tests
  merely to produce a green result. Do not call ordinary funding B-10 sponsorship.

## 4. Immediate next work: canonical admission, then reservation/lifecycle

### Established evidence — do not repeat the wrong diagnosis

| Attempt | Observation | Interpretation |
| --- | --- | --- |
| `run-OsIsLO` | Funding/DUST observed; failure after deployment proof-provider completion | Initial failure classification was discarded; no deployment success |
| `run-nacq7y` | `Wallet.InsufficientFunds` at wallet balancing on Node 24.20.0 | Positive DUST was insufficient; actual-fee/accrual fix followed |
| `run-KxqoEk` | Fee balancing passed; node returned RPC 1010, `Invalid Transaction: Transaction would exhaust the block limits` | **Newer, separate node resource rejection**, not the old funding failure |
| `run-PwtzKR` | Read-only full-deployment preflight: 30,804 bytes fit; declared ref-time 1,330,680,000,001 exceeds maximum 1,299,891,843,000 | **Fresh transaction blocked before send by execution weight**; no deployment/reservation |

The unchanged pinned node's individual ref-time limit is now measured as the
limiting dimension for the fresh complete deployment. The older attempt still
lacks its exact measurements. Verifier file sizes alone were not used to reach
this conclusion. Read [the source-backed investigation](deployment-resources.md)
and [sanitized receipt](receipts/deployment-resources-2026-09-10.json).

**Subsequent progress:** the explicit [staged diagnostic](staged-bootstrap.md)
successfully deploys seven keys, installs seven remaining keys at the same address,
then observes an empty committee / threshold-one lock. All three transactions are
preflighted against unchanged limits and indexed state is inspected at each returned
block. Exact original ledger, all 14 verifier artifacts/entrypoints, `DEPLOYED` phase
and revision 0 match. No reservation ran. This is not proof of rejected maintenance
or a completed admission sequence.

### Next experiment, in order

1. Recheck blueprint §3.3, both resource/staged evidence and pinned node/SDK source.
   Retain the existing read-only preflight and its negative controls. It is not a
   full admission/validity probe; no `TransactionPaymentApi` exists in this runtime.
2. Preserve the [maintenance rejection/control evidence](maintenance-audit.md):
   pre-lock seven-update positive batch, three stale/future/signed-update-replay
   failures and seven post-lock exact code 134 rejections with unchanged state.
   Pre-lock `FailFallible` plus matched `ReplayCounterMismatch` is a distinct
   boundary, not RPC authority rejection. Generic errors, wrong causes, resource
   rejection or deleting a local key cannot establish a lock.
3. Preserve the [bounded native actor recovery](recovery-audit.md): actual `SIGKILL`
   after deployment send/result but before actor acknowledgement, encrypted restore,
   fresh indexer reconciliation, no resend and three bootstrap submissions. The
   wallet broker/key coordinator survived. Keep provider-outage, full-wallet,
   clean-profile/device and reservation recovery acceptance open; never generalize
   this to M-05 or MID-completion. Fee estimates include SDK margins and exclude
   funding/service costs; target-wallet commercial cost/latency remains open.
4. Complete connected verification of canonical admission first: quote and payment-window validation,
   full expected state/artifact/entrypoint inspection, verified maintenance policy,
   then atomic order/address binding. Reject substituted, duplicate, stale or cloned
   bindings. A successful bootstrap or a status boolean cannot authorize reservation.
   The atomic Convex repository now has real local concurrency/restart evidence
   with synthetic inputs; quote freezing and internal Stripe workers also exist.
   Wire and verify trusted auth/payment/chain ingestion and hosted execution.
   Package test doubles prove neither real Stripe effects nor hosted JWT/browser
   integration; request-driven worker scheduling is not periodic refresh.
5. Only then attempt and independently observe reservation. Continue through legal
   and forbidden operations, role/terms/delivery binding, replay, races, deadlines,
   malicious bootstrap and recovery. Advance individual MID rows only when their
   full required evidence exists; do not close R1 from one happy-path reservation.

All bootstrap diagnostic modes deliberately stop before steps 4–5. Their locked-state inspector
is a necessary condition, not admission authorization. If the next implementation
requires a protocol change, record the conflict and obtain the architecture decision.

Stop at the failing boundary, retain identifiers and classify the result. Do not
cycle through identical funded deployments without a new measurement or justified
change. Independent review is required before treating a fix as verified.

## 5. Reproduce the environment and checks

The verified native lane is Linux x86_64. The observed sandbox was gVisor with
no Docker/Podman/socket; inspect the actual current environment rather than assuming
that still holds. Native execution uses ordinary verified binaries, not a daemon
or a privileged container workaround.

| Component | Pin / boundary |
| --- | --- |
| Bun | 1.4.2, repository wrapper |
| Compact | Devtools 0.5.1; compiler 0.31.1; language 0.23.0 |
| Generated runtime | compact-runtime 0.16.0; onchain-runtime-v3 3.0.0 |
| Native candidate | Node service 1.0.0; indexer 4.3.3; prover 8.1.0 |
| Integration process | Node.js 24.20.0, not incidental host 24.19.0 |
| Isolated SDK graph | SDK/testkit 4.1.1; ledger-v8 8.1.0; wallet-sdk 1.1.0; frozen npm lockfile |

The native candidate is not proof of compatibility with every public network or
the separately planned browser-wallet cohort. Never adopt the newest release
merely because its number is higher. Retain exact archive/layer/member hashes.

Use the project's effective setup path. In Hoplite, inspect `project_settings_get`
and use `sandbox_setup`; project overrides win over repository settings. Outside
Hoplite the repository setup command is `npm run setup`. If setup fails, diagnose
and fix its durable path; do not silently report a one-off workaround as fresh
setup success. Once the pinned Bun is installed, from repository root:

```sh
npm run contract:cohort
npm run contract:compile
npm run setup:native-network
npm run setup:integration-runtime
export PATH="$PWD/.tools/node-runtime/node-v24.20.0-linux-x64/bin:$PATH"
node --version  # Must be v24.20.0 for the isolated integration package.
npm --prefix packages/integration ci --ignore-scripts --no-audit --no-fund
npm run lint
npm run typecheck
npm run check:plan
npm run test:unit
npm run test:integration
npm run build
npm run test:native-network
```

For an intentionally revised disposable transaction experiment, after reading
section 4 and [its environment contract](../packages/integration/README.md):

```sh
npm run test:native-node -- --with-services --transactions
```

The supervisor supplies owned loopback endpoints and an independently checked
genesis hash, uses the selected Node executable and stops its services. Do not
run `local.mjs` against guessed endpoints or public assets. The current full
deployment diagnostic is expected to encounter the recorded block-budget issue
until a verified change addresses it.

Generated keys/JS/ZKIR live under ignored `packages/contract/generated/`; rebuild
them, never hand-edit them. Node-only tests use module hooks and run separately
from Bun tests. The plan checker validates gate-ID presence, fences and relative
file targets, **not** all anchors, external pages or semantic plan compliance.

### Known environment limitations

- First-party reprovisioning/setup refused lifecycle claims even when native
  commands worked. The fault was reported, not repaired. Do not call it the active
  deployment blocker: native execution has already bypassed the Docker need.
- QA audit rejected the existing `.hoplite/settings.json` without useful schema
  diagnostics; settings inspection also reported it absent despite being tracked.
  This was reported. Do not invent configuration fields, remove checks or claim
  automatic browser QA readiness. Recheck authoritative schema/tool results.
- Prover binds **all sandbox interfaces**, unlike node/indexer loopback bindings.
  No Preview/tunnel may be published for it. Use synthetic, disposable inputs only;
  trusted proving/access controls remain a later integration requirement.
- Respect current resource metadata. Low Modal reservation is not its burst ceiling.
  Resize only for demonstrated resource failures, not this ledger admission error.
- Optional Docker instructions are in [local-network-candidate.md](local-network-candidate.md),
  using `infra/midnight/compose.yml`. This Compose route has not been executed here.

## 6. File map

| Path | Purpose |
| --- | --- |
| `packages/contract/src/order.compact` | Original protocol; change only against canonical invariants |
| `packages/contract/tests/` | Encoding, disclosure, generated-runtime and malicious-state tests |
| `scripts/compile-contract.ts`, `scripts/verify-compact-cohort.ts` | Complete artifacts, fingerprints and actual runtime identity |
| `scripts/setup-native-node.ts`, `scripts/setup-native-services.py` | Checksummed native artifacts/configuration |
| `scripts/setup-integration-runtime.ts` | Canonical isolated Node.js runtime |
| `scripts/native-node-smoke.ts`, `scripts/native-services-health.ts` | Ephemeral native network and diagnostic supervision |
| `scripts/native-processes.ts` and tests | Owned processes, signal handling and late-spawn cleanup |
| `packages/integration/src/local.mjs` | Diagnostic funding/deploy/lock/reserve orchestration; latter steps not proven live |
| `packages/integration/src/artifacts.mjs` | Source, 60 artifacts and cohort binding before funding |
| `packages/integration/src/dust.mjs` | Actual-fee readiness and bounded pre-submit retries |
| `packages/integration/src/submissions.mjs`, `diagnostics.mjs` | Pre-send IDs and allowlisted diagnostics |
| `packages/integration/src/order.mjs` | Isolated generated-runtime loader and bounded synthetic buyer fixture |
| `packages/integration/test/` | Node-only regressions; construction is not live proof |
| `packages/domain/`, `apps/web/` | Synthetic model and UI; not connected to real protocol state |
| `.github/workflows/check.yml` | SHA-pinned actions; compile, cohort verification, static checks, separate suites and native health |

## 7. Evidence, privacy and research

Read [native-network.md](native-network.md),
[native-service-sources.md](native-service-sources.md),
[development-evidence.md](development-evidence.md),
[the sanitized native receipt](receipts/native-local-checkpoint.json) and
[the compiler receipt](receipts/compact-0.31.1.json).
The native receipt deliberately combines **separately labeled executions**;
do not turn those into a fabricated single end-to-end timeline.

Private diagnostics may survive in this workspace under
`.hoplite/artifacts/native-node/run-*`, including the attempts named above.
They are not guaranteed in a fresh clone. The chain is disposable; funding
identifiers do not imply a still-queryable network. Actor secrets are in memory,
not a tested backup/recovery mechanism. Do not restore one actor/database into
another run or describe this reset as user recovery.

Never commit/publish `.tools`, generated key output, raw logs, SDK transaction
bodies, seeds, witness data, environment secrets or private media. Testkit's default
wallet logging can print seeds: retain its disabled logger and the allowlisted
receipt/diagnostic projection. Cleanup must cover normal failure, SIGINT/SIGTERM
and children created during shutdown; SIGKILL cannot run application cleanup.

The user explicitly requested real Firecrawl CLI Developer Index use. The pinned
CLI 1.23.3 was actually attempted and denied keyless access from this IP:

```sh
npm run research:developer -- 'Midnight local development native node proof server run without Docker' --limit 3 --json
```

The separately authenticated Firecrawl MCP Developer Index/scrape integration
worked. Discover its available tools before calling them; do not assume credentials
or invent CLI success. Use official version-matched source/release metadata to
resolve technical choices, and record dates, revisions, exact failures and what
was actually executed. Search snippets are leads, not compatibility proof.

## 8. After the protocol gate: order and defer rules

Use roadmap dependency order, not calendar promises:

1. Resolve M-01–M-03/R1 with actual admitted protocol evidence.
2. Build R2 auth, membership/files, named browser wallet/prover profile and independent
   actor recovery using isolated real development environments. Do not substitute
   mocked provider results for integration evidence. Request missing account access
   or configuration only when it blocks that authorized stage.
3. Implement/test Stripe sandbox capture/void, signed webhooks, ordering/duplicates,
   expiry and timeout-after-effect reconciliation. No live keys or payments.
4. Complete R3 Preview, privacy/adversarial/operational and B-09/B-11 evidence,
   including actual supported-wallet/usability work and the runbook.
5. Package the exact reviewed SHA and honest demo for M-12; clarify organizer rules.
6. R4 requires explicit live authorization and operational/legal readiness. R5
   requires observed repeated customer value/economics, not more implementation.

| Deferred work | Re-entry trigger |
| --- | --- |
| B-10 DUST sponsorship | First optional phase only after funded baseline **and B-09**, plus cost/privacy/consent approval |
| B-08/M-13 public archive | Core evidence, concrete portability need, explicit synthetic publication/fee approval |
| EffectStream observer | Measured observation/history gap and a better verified operating-cost case |
| Mobile/Kuira and review inference | Actual customer need plus compatibility, safety and allowance evidence |
| Heavy 3D/M-14 launch film | R3 protocol/task clarity and a justified presentation need |

No optional item has been reactivated. Use `DEFERRED → REACTIVATED → ONGOING`
only after documenting the trigger, owner and admitted scope. Preserve older reasons.

## 9. Working and publication discipline

- Delegate bounded file ownership; parent integrates and owns final verification.
  Follow contract/integration changes with an independent review and rerun the
  relevant actual checks. Subagent claims alone are not final evidence.
- Before changing a phase, cross-check: canonical invariant → implementation path
  → positive test → negative test → real observation → honest gate/status update.
- For material UI work, use the managed Preview and actual browser assertions;
  do not reuse historical screenshots as current proof. For browser QA state,
  use declared isolated profiles/audits rather than production data or ad hoc edits.
- Review diffs for secrets, generated files, dependency drift, altered gate IDs,
  privacy disclosures and stale status prose. Check both top summaries and lower
  checkpoint paragraphs; one stale Docker sentence was already corrected in `5b735da`.
- Update the manifest, protocol/UI verification as applicable, changelog and this
  handoff when the next checkpoint changes its continuation instructions. Distinguish
  DONE slices, PARTIAL work, PENDING work and BLOCKED gates; never report a percentage
  or benchmark without evidence.
- Commit/push bounded, tested checkpoints through the authorized source-control
  tools. Inspect live PR state, keep its holistic description/current verification
  accurate, and retain auto-fix subscription. Do not sleep-poll CI after publication.
- Do not assume prior permission to merge PR #2 authorizes every future merge or
  any production launch. Obtain applicable authorization and inspect live reviews/
  checks before merging. If the current PR was merged, use the authorized branch
  rotation path; do not append independent work to a merged head.

### Next-agent completion checklist

- [ ] Live checkout/PR/CI reviewed; unrelated work preserved.
- [ ] Canonical admission and feasibility requirements reread.
- [ ] Actual limiting deployment resource measured without exposing private data.
- [ ] Proposed bootstrap change reviewed against the unchanged protocol/gates.
- [ ] Positive and negative evidence obtained on the exact candidate artifacts.
- [ ] Secrets/logs remain private; scoped processes/data handled correctly.
- [ ] Regression suites and relevant real execution rerun; limitations stated.
- [ ] Manifest/changelog/receipts/PR updated and checkpoint published.
- [ ] R1/R2/R3/live claims withheld until their full acceptance contracts pass.
