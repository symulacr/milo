# Changelog

Note (2026-10-11): the project is licensed Apache-2.0 (`LICENSE:1`, `package.json:5`). The
"MIT for original project material" entries below are historical: the licence was MIT at v0.0.1
(commit `9689fae`) and changed to Apache-2.0 at commit `31b5c9a`.

## v0.0.4 - 2026-09-25

CORRECTION (2026-10-11): this entry described a "concurrency wave" whose code is not in this
tree. `hardening/` holds 0 files (only empty directories), so every citation of a
`hardening/v6/...` file below names something absent. The batch, pipeline, burst, prover-efficiency
and dependency-ratchet work described here has no implementation in the tree: `batch-calls.mjs`,
`batch-proof.mjs`, `burst-probe.mjs`, `bench.mjs`, `batch-proving.mjs`, `deploy-pipeline.mjs`,
`prover-pool-sizing.mjs`, `block-packing.mjs`, `dependency-footprint.test.mjs` and
`hardening/v6/run-gates.sh` do not exist anywhere on the filesystem, and no batching exists
(`packages/integration/src/tx.mjs:24` asserts `tx.intents.size === 1`). The claims below are
retained only as a record of what was asserted on 2026-09-25; they are not verified against this
tree. The one claim still checkable in the tree is the delivery-commitment encoder (see below).

### implemented and proven

- **the adversarial audit converged.** the cited `hardening/v6/audit/FINDINGS-2026-09-24.md` does
  not exist; `hardening/` holds 0 files. No finding list can be re-verified from this tree.
- **the audit's tracked-document drift is fixed at the source.** the opposite was true: the
  README and `ARCHITECTURE_AUDIT.md` carried a false "A0-2 tree loss" block and a false "the
  simulator was removed" claim, and `apps/web/src/workspace/model.tsx` exists. Both documents are
  corrected in the 2026-10-11 pass.
- **the delivery commitment is compared through the one canonical encoder.** the protected read
  compares the retrieved manifest against `deliveryCommitment(delivery.files)` in
  `convex/files.ts` (line 427), closing H-01, where a 64-hex write was compared as 192 hex and made
  every protected read unsatisfiable. This claim is checkable in the tracked tree.
- **the `check:plan` gate is real and CI can call it.** FALSE as written: `package.json` has no
  `check:plan` script (`npm run check:plan` fails with `Missing script: "check:plan"`), and the
  tracked `scripts/check-plan.ts` itself fails with `AssertionError: Missing canonical ID: MID-P2`
  (the corpus has MID-P1 and MID-P6 but no MID-P2). `.github/` is untracked (`.gitignore:21`), so
  no CI exists in a clone.
- **the stale hardcoded review deadline is deleted** (H-06). FALSE: `apps/web/src/reviewDeadline.ts`
  exists and is imported by 5 files. **the dead `HTTP_SUBMIT_MODULE` export is gone** (M-04). FALSE:
  it is still exported at `packages/integration/src/http-submit.mjs:215`. **the lane is wired for
  typing** via `packages/integration/tsconfig.json`. FALSE: that file does not exist.
- **a 24-intent batched transaction finalized on Preprod.** NOT IN TREE. no batching exists;
  `tx.mjs:24` asserts a single intent, and `batch-calls.mjs` does not exist.
- **block packing was measured, not projected.** NOT IN TREE. no `block-packing.mjs`, no retained
  per-block packing receipt.
- **the pipeline overlap is real: 1.70x.** NOT IN TREE. no pipeline mode, no `pipeline-comparison`
  artifact; the cited `protocol-limits.md` does not exist.
- **the prover's efficiency win is applied where the server is spawned.** NOT IN TREE. no
  `proverSpawnPlan`, no `RAYON_NUM_THREADS` or `MALLOC_*` in `scripts/native-services-health.ts`;
  the cited `prover-efficiency.md` does not exist.
- **the lane's proof fan-out is bounded.** NOT IN TREE. no `boundedProvingProvider`, no
  `batch-proving.mjs`.
- **the dust fence is derived, not hardcoded.** NOT IN TREE. no `deriveFence`, no `bench.mjs`, no
  `bench.test.mjs`.
- **a rejected submission releases its dust.** NOT IN TREE. no `submitOrRevert` in
  `packages/integration/src/`.
- **spec versions are allowlisted.** NOT IN TREE. `packages/integration/src/resources.mjs` still
  asserts and records only spec version `1000000`; there is no `1000300` allowlist.
- **new lane modes.** NOT IN TREE. `packages/integration/src/preprod-actions.mjs` carries no
  `--batch-proof`, `--pipeline`, `--burst` or `--burst-sweep` dispatch.
- **a dependency duplicate ratchet.** NOT IN TREE. `dependency-footprint.test.mjs` does not exist.
- **one gate entry point.** NOT IN TREE. `hardening/v6/run-gates.sh` does not exist.

### refuted or refused

the refutations below all rest on measurements whose artifacts are absent (`prover-efficiency.md`,
`protocol-limits.md`, `dust-efficiency.md` and the burst/pipeline receipts do not exist), so they
are recorded as unverifiable assertions of the 2026-09-25 round, not as results:

- more prover workers (1/2/4 workers), the trim-threshold stack, taskset pinning, `/prove-tx` as a
  batch lever, and the "one transaction per block" refutation.

### numbers

the numbers this entry carried (24 intents at 1,242,000,000,000 of 1,299,891,843,000 ref-time;
block 2709384; packing 2/3/4; pipeline speedup 1.7023; prover RSS 514.8 to about 289 MB; dust fence
166 to 318,448; audit findings 37; dependency ratchet 24 and 6; 443 integration tests) are not
reproducible from this tree. The only dated, reproducible figure for the current tree is measured
by the product gate: `sh scripts/with-bun.sh test apps/web packages/domain packages/contract
packages/backend scripts` -> **577 pass / 0 fail across 50 files (measured 2026-10-11)**.

### known limits

- **the fee floor is open.** the cited `dust-efficiency.md` does not exist.
- **packing above 7 coins is open.** no coin-seeding burst run and no retained receipt exist.
- **the lane typecheck backlog is open.** the cited `packages/integration/tsconfig.json` does not
  exist, so the lane is not typecheckable from a package config.
- the receipts cited above were said to live under `.hoplite/artifacts/preprod/` and the analysis
  under `hardening/`; the only retained Preprod deploy receipts are the two 2026-09-30 files, and
  both record `"status":"failed"` on `Wallet.InsufficientFunds: could not balance dust` with
  `finalCircuitCount: 0`. `hardening/` holds 0 files.

Changes are grouped by verified scope. “Added” does not mean a live service or a passed
integration gate. Execution status lives in [PROGRESS_MANIFEST.md](PROGRESS_MANIFEST.md).

## Preprod deployment - 2026-09-20

CORRECTION (2026-10-11): the cited disclosure `hardening/v6/deployment/preprod-disposition.md` does
not exist (`hardening/` holds 0 files), and the claims below are not proven by any retained
receipt. The only retained Preprod deploy receipts under `.hoplite/artifacts/preprod/`
(`staged-deploy-happy-path.json` and `staged-deploy-negatives.json`, 2026-09-30) both record
`"status":"failed"` on `Wallet.InsufficientFunds: could not balance dust` with
`finalCircuitCount: 0`. The Midnight-hosted Preprod endpoints (`indexer.preprod.midnight.network`,
`rpc.preprod.midnight.network`) were decommissioned from 22:00 UTC on 2026-10-09
(docs.midnight.network/guides/networks-and-environments), so the on-chain claims cannot be re-read
live. The entry is retained as the historical record of what was asserted on 2026-09-20.

the staged preprod deploy: the contract was claimed to run on the real network, all 14 order circuits
were driven with finalized transactions, the must-reject suite was rejected at the contract layer, and
the maintenance drills ran against the deployed contract. these claims are historical and unverified
against retained evidence.

### implemented and proven (as asserted 2026-09-20)

- **the contract is deployed on Preprod at `0xb95c8243f269c995c76577006f233b7c37f353067df8737b9b17537739e74586`.**
  it was deployed in block 2636672, tx
  `0xd10923d24e70eb9c2e928f4cd18fd689822c85568d59b7ad3aa3af86222ab472`, which is where its
  `ContractDeploy` sits; seven verifier keys went in that transaction and the remaining seven were
  installed by maintenance update in block 2636676, tx
  `0x8a6aed776b9ef01bc141da7414f008d56b64de47289e4bfce5bab7b2d52a8939`, the only `ContractUpdate` on
  this contract before the drills. the operation set read back from state is 14 of 14. the run's own
  receipt recorded the ids `0x63f45a99...` and `0x06a85a07...` with no block heights, and a direct
  indexer query for both returns an empty result, so they are not on chain in any form. blocks
  2636398 and 2636469, cited in an earlier draft of this entry, belong to the superseded contract
  `0x731948c6...` that the resume-path defect produced. the deploy is staged because the full 14-key
  deploy does not fit one transaction (see below).
- **all 14 order circuits were driven on Preprod.** each call has a real txId and a block height
  between 2638272 and 2639589.
- **the must-reject suite was rejected at the contract layer.** every negative case failed with its
  expected assert: `stale revision`, `accept requires reserved`, `approve requires submitted`,
  `resolve requires disputed`, `expire requires disputed`, `submit requires accepted`, plus a
  capability error for the wrong role.
- **the maintenance drills ran against the deployed contract.** `removeVerifierKey` in block
  2639606, `insertVerifierKey` in block 2639612, and `replaceAuthority` to an empty committee in
  block 2639638, after which the contract state reads `committee: [], threshold: 1, counter: 4`.
  authority is now relinquished by default from the deploy path, so the locked state is a property
  of the deployment rather than a manual follow-up.
- **funding and DUST are on chain, and the deploy is now linked.** the DUST registration transaction
  `0xebb3dd39cb87d1ed9bf5...` in block 2634013 spent the generating NIGHT UTXO, and the wallet's
  spendable balance was measured at `60349100000000000` specks after the operator funded five more
  UTXOs. the README links the contract on both Preprod explorers, this registration transaction, the
  deploy and insert transactions, and the three maintenance calls; the deploy and insert blocks were
  recovered by scanning the chain for the contract's own actions, because the run's receipt persisted
  neither a resolving transaction id nor a block height.

### refuted or refused

- **the full 14-key deploy in one transaction: still impossible (measured).** the fee-paying form
  finalized locally declares 1,330,680,000,001 ref-time against a 1,299,891,843,000 per-extrinsic
  limit, 2.37 percent over; the Preprod staged path declares the construction-only form at
  1,321,480,000,001, 1.66 percent over. the 9,200,000,000 difference is the DUST fee-offer overhead
  the fee-paying form carries, so these are one deploy measured two ways rather than a disagreement.
  the staged 7+7 path is what makes the deploy fit; the limit was not raised and no missing
  operation was dropped.

### numbers

contract address `0xb95c8243f269c995c76577006f233b7c37f353067df8737b9b17537739e74586`, deployed in
block 2636672 (14 of 14 keys installed); order-circuit blocks 2638272 to 2639589;
maintenance blocks 2639606, 2639612 and 2639638. the one-transaction deploy is 2.37 percent over
its per-extrinsic ref-time limit as the fee-paying form finalized locally, and 1.66 percent over as
the construction-only form the Preprod staged path declares. no dependency was added, removed or
changed by this round.

### known limits

provider acceptance remains partial: the run exercised the provider slots, but no connected-provider
order is claimed. the browser workspace is still simulated and no order is connected end to end;
canonical address binding, a buyer-authorized application reservation, and browser, provider and
payment acceptance remain open. the off-chain half is prototyped, not deployed end to end: a hosted
Convex deployment and a Privy app id DO exist (`dist/api/public-config` =
`{"privyAppId":"cmtvmx5ny02jg0blcvamxm1sd","convexUrl":"https://tremendous-rooster-473.convex.cloud","midnightNetwork":"preprod"}`),
and the browser has no circuit-call path.

Changes are grouped by verified scope. “Added” does not mean a live service or a passed
integration gate. Execution status lives in [PROGRESS_MANIFEST.md](PROGRESS_MANIFEST.md).

## v0.0.3 - 2026-09-20

the fast-sync wave: a start-late DUST seeder that skips the genesis replay, the fail-closed
restore gate it is verified by, and the decision that closes the upstream fast-sync route.
the code claims below are backed by modules under `packages/integration/src/` that exist in this
tree (`dust-seed.mjs`, `wallet-state-verify.mjs`, `preprod-lane.mjs`,
`packages/integration/test/dust-seed.test.mjs`). the cited prototype evidence under
`hardening/v6/` does not exist: `hardening/` holds 0 files.

### implemented and proven

- **the DUST genesis replay is skipped by seeding the trees instead of replaying them.**
  `packages/integration/src/dust-seed.mjs` seeds both dust Merkle trees from indexer collapsed
  updates and replays only the post-seed tail. the recipe is verified rather than assumed: the
  block end index is exclusive while the collapsed update end index is inclusive, so the range
  ends at `E - 1`; the chain publishes `0x73 || byteReverse(local)` where the local bigint root
  is the byte-reversed 32-byte hash; and `Block.*MerkleTreeRoot` are mutable tip values that can
  lag one state. one pinned indexer request fetches the block and both updates so the roots
  compared belong to the same indexer state. the seeder emits nothing unless both roots verify
  inside a one-state lag window, the tail cursor is anchored to the pinned block, and the
  snapshot round-trips through the SDK's own serialization. the live branch of
  `packages/integration/test/dust-seed.test.mjs` confirmed a lag-0 match at two distinct live
  heights on this round's run. that test asserts the two heights differ and are safe integers,
  but it does not write their numeric values to any durable artifact, so no specific heights are
  cited here. the only durably recorded height is the offline fixture's `GOLDEN.height` = 2633333
  (`packages/integration/test/dust-seed.test.mjs` line 31).
- **the restore gate exists, and no restore is trusted without it.**
  `packages/integration/src/wallet-state-verify.mjs` is the gate: G1 to G10, ported from the
  `prototype/restore-verify/verify.mjs` definition. it cross-checks restored content against the
  chain rather than against itself (version pin, all three snapshots present and preprod, no
  stale pending state, a bounded restore per role with a hung-versus-slow CPU classification,
  the chain-reconstructed unshielded UTXO set, applied id against the indexer, dust and shielded
  indices inside their high-water marks, tip sanity, dust address consistency, and a bounded
  restored start with zero pending). its receipt holds the SHA-256 and byte size of every
  snapshot file and never their contents. the lane authorises the fast path only when every
  check passes and none is unexercised.
- **the lane wires the gate before any restore, with two operator modes.**
  `preprod-lane.mjs` runs the gate ahead of restoring snapshots, with `--verify-state` (verify,
  print the receipt, exit non-zero when the fast path is refused) and `--repair-state` (rewrite
  `sdk-versions.json` from the installed versions, deliberately, never automatically during a
  restore). a restore that fails any check is discarded and the run takes a full from-seed sync.
- **a real defect in the version gate is fixed.** the gate added in `ac7ccd0` was a no-op:
  every Midnight package is ESM-only and its `exports` map does not expose `./package.json`, so
  `require()` of the specifier or its `package.json` throws `ERR_PACKAGE_PATH_NOT_EXPORTED` for
  all six packages. the throw was caught and an empty matrix recorded, so two empty records
  compared as no drift and the gate would have restored under any SDK version. the manifests are
  now read by path, and a version that cannot be resolved is recorded as null and the restore is
  refused as `sdk-versions-unresolvable`.

### refuted or refused

- **upstream projections-based fast sync: rejected (decided).** dust-wallet 5.0.0-beta.3 /
  wallet-sdk 2.0.0-beta.3 ship a projections path that skips event replay, but it exists only in
  the `./v2` ledger-v9 variant; the `./v1` ledger-v8 line keeps event replay permanently by an
  upstream decision dated 2026-08-19. even on ledger-v9, a fresh wallet on a chain that forked
  over history still replays the ledger-v8 dust events before crossing, which is exactly a fresh
  Preprod wallet. independently, the deployed Preprod indexer rejects the beta's subscription
  shape (unknown arguments `blockHash` and `dtimeCutoffHeight`), and adopting it would force a
  roughly fourteen-package cohort swap plus a second contract artifact. the cited
  `hardening/v6/prototype/upstream-fast-sync/RESULTS.md` does not exist (`hardening/` holds 0
  files), so this decision is recorded without a retained artifact.
- **ledger WASM replay ceiling: measured, and the target is unreachable by replaying.** the
  apply loop runs at 564 to 667 dust events per second and is CPU-saturated on one core. the
  five minute target needs about 5,130 events per second, roughly 8x to 9x the measured replay
  rate, so minutes can only come from skipping the replay - which is what the seeder does.
- **rejected levers, recorded so they are not retried.** gzip or permessage-deflate (the indexer
  negotiates no compression extension; upstream request midnight-indexer #1251 is open);
  transaction priority or fees (syncing submits no transaction); replacing the ledger WASM
  (consensus-critical).

### numbers

fresh-sync baseline 125 to 150 minutes to traverse about 1.3M to 1.54M dust events; the seeder
replaces the tree reconstruction with two full-range collapses of a few hundred bytes each plus
a bounded tail. measured apply rate 564 to 667 events/s against a 5,130 events/s five-minute
target. new modules `dust-seed.mjs` and `wallet-state-verify.mjs`, plus `dust-seed.test.mjs`;
`preprod-lane.mjs` gained the gate wiring and the version-gate fix. line counts are deliberately
not recorded here: they drift on every edit, and an earlier draft of this entry carried counts
that were already wrong. this round added, removed or changed no dependency.

### known limits

the seeder's own live test verified two distinct live heights with lag 0, but records no numeric
heights. the gate's shielded content has no
independent chain query and is its largest residual gap, and the dust and shielded forward sync
after restore needs keys the gate will not handle, so those checks stay unexercised until a real
snapshot exists. no snapshot existed at the time of writing: a full sync was killed by a host
reboot at about 1,037,418 of 1,540,000 dust events (roughly 75 percent) with no snapshot
written. the fast path is wired and gated but has not yet restored a real Preprod snapshot end
to end.

Changes are grouped by verified scope. “Added” does not mean a live service or a passed
integration gate. Execution status lives in [PROGRESS_MANIFEST.md](PROGRESS_MANIFEST.md).

## v0.0.2 - 2026-09-20

six hardening programs (v1 to v6) on top of the v0.0.1 surface. the cited evidence under `hardening/`
is absent: `hardening/` holds 0 files. the test counts recorded for this release (v0.0.2,
2026-09-20): 361 unit tests, 185 integration tests, 27 contract tests, 25 verifier checks. these
disagree with the other counts in this file (443, 647, 493, 771, 735, 562, 485) and are not
reproducible from this tree; the one dated, reproducible figure for the current tree is measured by
the product gate: `sh scripts/with-bun.sh test apps/web packages/domain packages/contract
packages/backend scripts` -> **577 pass / 0 fail across 50 files (measured 2026-10-11)**.

### implemented and proven

- **the integration lane works from a clean checkout.** `bun run test:integration` provisions the pinned Node 24.20.0 runtime, installs the integration package from its own lockfile, and runs the suite. before v1 the same command could not resolve its dependencies at all.
- **a real Midnight path exists and is a first-class command.** `bun run test:native-node` provisions the native node, indexer and prover, starts a disposable loopback network, and runs a staged deploy, install and lock with real proof generation and submission. retained receipts show three finalized transactions (SucceedEntirely) at blocks 27, 31 and 46, 14 proof-provider completions, DUST fee readiness and wallet balancing; the node's ledger roots and the indexer's blocks agree (54 = 54) and the deploy transaction id is present in the indexer.
- **constructor-only bootstrap state is sealed.** `protocolVersion` and `configuration` carry the `sealed` modifier, so no context reachable from an exported circuit can rewrite them. the change is artifact-identical (generated index.js, index.d.ts, contract-info.json, all 14 zkir and all 28 keys unchanged), and a source tripwire fails if the seal is removed or commented out.
- **the double-wrap defect class is closed.** one construction point (`tx.mjs`) with a shape gate, a committed bite test, a single-construction tripwire, and a real-lane run in which the replay path executes end to end.
- **protocol boundaries have one owner each.** payment-to-quote binding (7 hand copies to one predicate), buyership (7 shapes to one), payment-observation invalidation (3 to one), plus the image-pack policy shape, the route split, the public-config schema and the harness transaction factory, each with drift tests.
- **the verifier is adversarial.** git hygiene, six gates, layering and architecture assertions, circuit and artifact identity, the deployment receipt checked against the current source, sealed fields, and release-adjacent invariants. every check class was deliberately broken at least once and shown to fail.

### refuted or refused

- **native primitive substitution: refuted.** no official Midnight primitive replaces Milo's hand-rolled plumbing today (six falsifiers, live-verified twice); ledger-9 is still not deployed.
- **stronger circuit invariants: refused.** four circuit variants were prototyped (payment binding, state pruning, merged transactions, proof/authorization boundaries) and refused: the circuit cannot observe the payment or account surface, and the one mechanical gain required retiring counter-control evidence.
- **full product wiring: deferred, cost measured.** browser-side construction and proving for the order flow costs roughly +395 to +1,970 production lines, and Lace implements neither wallet-side proving nor signData. the simulator stays, with KEEP with reason.

### numbers

production 17,051 to 17,057 lines (v5 to v6: +3 for the predicate export and +3 for the restored seal), test 9,911 to 10,077, tracked files 198 to 200. v1 to v5 removed 609 production lines net; v6 removes none and adds six. dependencies: two upgraded in v1 (ledger-v8 8.1.2, onchain-runtime-v3 3.1.1), none added or removed since.

### known limits

the local lane needs network access and about 450 MB on first provisioning. the cited procedure in
`hardening/v6/deployment/preprod-disposition.md` does not exist (`hardening/` holds 0 files). the
sample workspace remains a simulator, admits no order, and no preprod transaction is proven by any
retained receipt.

Changes are grouped by verified scope. “Added” does not mean a live service or a passed integration gate. Execution status lives in [PROGRESS_MANIFEST.md](PROGRESS_MANIFEST.md).

## Unreleased — native local execution, protocol work ongoing

### 15 September 2026 — round 4: unified audit + refactor (gap analysis, debt, interface, contracts)

- **Four-agent round 4**: source-of-truth gap analysis, current-work audit,
  interface/cognitive pass, and contracts/network validation. Contracts are
  locally verified end to end — compile cohort, 61/61 artifact fingerprints,
  admission pins, 234 contract+backend tests — while "mainnet-ready" remains
  honestly unclaimable (R0, 0/6, 0/14); the ordered evidence gap is recorded
  in Addendum 5 of the drift audit.
- **Interface**: order screen states its headline once (F1); evidence moves
  to an on-demand details block (F2); order/payment states no longer fuse in
  one pill (F3, shared `paymentLine`); reserve and accept now have deliberate
  confirmation dialogs (F4); receipt uses the shared framing + honesty row
  (F5); progress track styles the current step and keeps a terminal item for
  halted flows (F6); account/recovery stays reachable on mobile (F7); one
  status-pill implementation across both bundles (F8); hover states on
  secondary controls (F10); bare pills carry glyphs (F11); role-keyed
  breadcrumb (F12); the notice reserves its row (F13, CLS); radius literals,
  shadow alphas and the two off-scale type steps became tokens (F9 bounded).
- **Backend debt**: Stripe API version single-sourced; the 60 s freshness
  boundary agrees by construction (producer and admission now share the same
  edge); Lace-named error copy on the generic multi-wallet path is neutral.
- **Docs/hygiene**: stray critic working file removed from root; happy-dom
  pinned exactly; TASKS/EXECUTION_MANIFEST T04 contradiction reconciled;
  roadmap stale cells refreshed (compliance row, R1 = BLOCKED with partial
  local evidence); `@noble/hashes` and the wallet-sdk namespace question
  recorded for the dependency ledger.
- 370 unit tests, strict typecheck, lint and build pass; order page and
  reserve/accept dialogs browser-verified.

### 15 September 2026 — condensation and maintainability wave (third critic round)

- **Third four-critic round** (contract topology, cognitive load, LOC,
  visual consistency). Contract verdict: the documented protocol requires
  exactly 5 transactions per completed order; merging transitions, parallel
  contracts per order, and shared mutable order maps are **prohibited by the
  blueprint** (01:276, 01:272) and were refused, not implemented. Honest
  savings paths are escalated as decisions (maintenance-tx merge, circuit
  consolidation per 01:274, per-action cost measurement per 01:1113).
- **One framing source**: shared `phaseFrame` module (heading, next actor,
  deadline, consequence — role-aware) replaces four drifting phase-keyed
  dictionaries across OrderView, Orders and ActionPanel; progress track now
  maps phases explicitly and never runs ahead; role-neutral headings and a
  real non-buyer SUBMITTED frame replace a dead panel.
- **Bug fix caught by type-level totality**: `actionLabels` is now a total
  `Record<Action, string>` — the missing `authorize`/`verify` labels that
  rendered blank buttons are impossible by construction.
- **Condensation**: per-field "sample" qualifiers trimmed (the persistent
  badge carries syntheticity); payment fallback sentences per state; studio
  quote moved to the studio page; demo summary de-duplicated with technical
  IDs in a details element; account recovery exploration uses deep links
  instead of hidden global resets; NewQuote shows the documented fixed
  rights/deadline/operator review rows and reuses `reset()` (fixing stale
  deep links); landing scenario links are labeled as the separate workspace
  environment.
- **One fiction**: SC-01 merchant is North Studio everywhere (demo, landing,
  workspace) so the same artwork tells one story.
- **Visual system**: one `.tag` pill replaces badge/chip/sample-tag
  duplication on the public side; all radii unified onto the documented
  8/16/24 scale (04:54).
- **LOC**: net −56 across 18 files (dead route titles, dead classes, export
  hygiene, PublicApp extracted so public headings are truly tested).
- 370 unit tests, strict typecheck, lint and build pass; merchant and buyer
  perspectives browser-verified. Escalations recorded in
  [docs/drift-audit-2026-09-14.md](docs/drift-audit-2026-09-14.md) Addendum 4.

### 15 September 2026 — blueprint framing refactor (public bundle split, consent surfaces)

- **Split the web build into a lean public bundle** (01 §7.4): `/demo` and the
  info pages now ship a separate `public-app` entry (~252 KB raw / ~78 KB gz
  JS, down from the 5.4 MB monolith that inlined Privy/Convex for every
  visitor), with a reachable-source boundary test replacing the two-file scan
  and a build-time bundle inventory. `PageTitle` decoupled from the workspace
  model; public routes use a context-free `PublicPageTitle`.
- **Consent surfaces rebuilt per the documented ordering** (05 §4.2, 04 §5.2):
  preparation is now three checks with a current-blocker presentation —
  prepare device → **verify the recovery kit** (new distinct consent moment
  in the domain state machine) → separate payment authorization — replacing
  the single "ready" click and the phantom "Acknowledge the terms" step.
- **Deliberate-action dialogs**: operator dispute resolution and merchant
  delivery submission now get confirmation dialogs (authority, terminal
  consequence, payment policy), matching the buyer approval pattern; the
  approval dialog gains the disclosure row, capture-consequence wording, an
  in-dialog "Open a dispute instead" alternative, and the rank-1 label
  "Approve delivery and request payment capture" (01:1254 over 04:353;
  doc conflict logged in the audit).
- **Framing repairs**: persistent order status line (next actor, absolute
  deadline, consequence of inaction — 01:1259); timeline/evidence visible
  without tab switching (04 §7.1); hero motion inside the 120–220ms budget
  with a complete first frame (04:466–468); landing sample strip shows scope
  and deadline (04:99); merchant RESERVED framing + decline action (05:136);
  expired-hold explanation and permitted path (01:1279); sample-clock
  advance control; persistent file-check failure state (04:335); task-organized
  queue rows (04:396); scope shows service context and recipients (04:244).
- **Second-round critic fixes**: demo context switch keeps focus on the
  selector (04:153); hero CTA no longer carries dead query params; FAQ wallet
  claim qualified (no real Lace connection evidence yet); Lace copy treats
  wallet names as unauthenticated metadata with a late-injection reload note.
- Second four-critic round and resolutions recorded in
  [docs/drift-audit-2026-09-14.md](docs/drift-audit-2026-09-14.md) (Addendum 3).
  370 unit tests, strict typecheck, lint and build pass; key flows
  browser-verified.

### 15 September 2026 — Midnight integration audit and reconciliation

- Four evidence-only critics audited the Compact contract, integration
  runtime, admission/binding backend and UI/wallet boundary against the
  read-only blueprint; consolidated report with citations in
  [docs/midnight-integration-audit-2026-09-15.md](docs/midnight-integration-audit-2026-09-15.md).
  Verdict: honest and fail-closed — the 0/6 and 0/14 gates hold consistently
  across code and receipts; no hidden overclaims found.
- Fix the audit's actionable findings: landing FAQ no longer implies a
  present-tense sponsor (01:1273, 05:244); Lace discovery enumerates
  `window.midnight` per 01:334 with user selection for multiple wallets; the
  simulator's dispute graph matches 01:589 (buyer ACCEPTED/SUBMITTED, merchant
  ACCEPTED) and full-approval resolution now requires a submitted delivery;
  the resolution desk discloses the sample's collapsed operator authorities
  (01:353–360); handoff test counts refreshed (20 tests / 372 assertions).
- Open findings are escalated in the audit report (operator-authority
  separation, settlement layer, observer writer, hosted Checkout binding,
  audit-event family, runtime coupling notes) — no silent fixes, no gate
  closures claimed. 370 unit tests (1,760 assertions across 24 files,
  including the Compact contract suite's 20 tests / 372 assertions), strict
  typecheck, lint and build pass.

### 14 September 2026 — documented `/demo` tour, landing blocks, sign-in label, token consolidation

- Build the documented public `/demo` (04 §4.4): four-step guided sample
  (Scope → Delivery → Approval → Outcome), a native **Sample context** select
  with the SC-01–SC-07 catalogue, `?context=SC-05` deep links (replace, not
  push; unknown → SC-01), the persistent synthetic label, documented step
  CTAs, an explicit zoom control, independent approval/payment outcome panels
  with a payment-pending example toggle, and no Privy/Convex/Stripe/Midnight
  imports — enforced by a new import-boundary test. The workspace sample keeps
  its routes; `/demo` moves to the public shell.
- Extend the deterministic artwork generator with six original context packs
  (18 new images, 21 total on disk, hashes recorded in
  `apps/web/artwork/README.md`); the three Still images are unchanged.
- Add the documented landing blocks (04 §4.1): merchant value stated as
  product goals, a seven-item FAQ (software, execution costs, privacy,
  recovery, deadlines, devices, cancellation) and the closing sample-first /
  pilot-second CTA. No urgency, scarcity or newsletter patterns.
- Label the Privy sign-in action "Continue to your order" (04 §5.1) and make
  `/sign-in` describe the actual live diagnostic honestly.
- Consolidate legacy hardcoded colors into 22 extended semantic tokens (04
  §2.1); remaining literals are token definitions, shadows and one-off alphas.
- 370 unit tests, strict typecheck, lint and build pass; demo flow and landing
  blocks browser-verified. Bundle delta ≈ +3 KB gz.

### 14 September 2026 — trust-anchored UI drift reconciliation

- Reconcile the synthetic UI against the concept documents (01/04/05) in a
  cited drift audit; full register and escalations in
  [docs/drift-audit-2026-09-14.md](docs/drift-audit-2026-09-14.md).
- Copy now matches documented sentences: hero subhead and CTA labels (04:98,
  04:205), payment hold/expiry wording (05:197, 04:325), file-check vocabulary
  (04:335), evidence sections (04:369), approval dialog with explicit back
  action (04:341–357), persistent sample label on every workspace surface
  (04:148), and an honest sign-in status replacing a stale claim.
- Accessibility repairs: reduced-motion guard now wins specificity (01:1215),
  mobile navigation no longer disappears (04:97), status is always icon+text
  with a danger variant (04:52), order progress announces the current step,
  sidebar links keep accessible names when collapsed, disabled buttons use
  tested colors instead of a fade, and meaningful text floors at 12px (04:56).
- Token hygiene: add `--danger`, use `--radius-frame` and `--text-micro`, drop
  the unauthorized `--font-mono`; no new dependencies and no bundle growth
  beyond ~0.3 KB gz. 360 unit tests, strict typecheck, lint and build pass.
- Open escalations (documented, not invented): `/demo` guided flow, sign-in
  placement, pilot contact channel, `/connections` inventory status, landing
  FAQ/merchant sections. No merge, release or live-user claim is made.

### 12 September 2026 — reconstructible public constructor inputs

- Persist versioned constructor encoding and individual buyer, merchant and
  operator commitments in approved/frozen quotes and deployment observations.
- Validate canonical nonzero bytes, distinct roles, ordered lossless deadlines
  and derived fingerprints before provisioning, freezing and admission. Rebuild
  the observer's configuration from persisted public inputs, retaining its
  local-only network restriction and generated-constructor parity checks.
- Legacy incomplete rows require reviewed source-backed migration, not guessed
  commitments. This checkpoint does not establish Preprod provenance or ownership.

### 12 September 2026 — Stripe customer facts before audited provisioning

- Add an internal-only read adapter using the existing pinned Stripe test client
  and audited provisioning mutation. Validate authority/identifiers before reads;
  reject account/customer mismatch, live/deleted customers and provider failures.
- Derive stable minimal provider evidence server-side, excluding raw responses,
  email and metadata. Explicitly label buyer mappings operator-asserted rather
  than independently ownership-verified. Preserve final allowlist, immutable,
  idempotency, uniqueness and revocation checks in the existing transaction.
- Split T09b provider facts from authoritative ownership/membership/catalog sources
  and real-provider evidence; record T10's missing public-constructor prerequisites.
  No payment effects, external ownership proof or acceptance gate closure is claimed.

### 12 September 2026 — ordered completion plan and observation controls

- Extend the existing task list with dependency order, reuse rules and explicit
  verification exits; split status/controls from confirmation, settlement and
  real-provider acceptance rather than treating them as one completed task.
- Add a minimal authorized monitoring status query with effective expiry and
  revocation, including withdrawal visibility for the original consenting subject.
- Reuse the current Privy/Convex session boundary for quote lookup, explicit
  monitoring consent and start/stop controls. Fence duplicate/stale requests,
  redact errors and require refresh after uncertain outcomes. A fresh query token
  bypasses client caching without influencing server authorization.
- Verify real-app unconfigured states and mobile keyboard behavior; test actual
  control components with a clearly labeled synthetic transport. Managed Preview
  startup, hosted control flows, confirmation and settlement remain unverified.

### 12 September 2026 — bounded read-only payment monitoring

- Add separate five-minute monitoring consent for an existing immutable test
  payment, 15-second refresh scheduling and a 60-second stalled-read watchdog.
  Starting again cannot silently renew consent or take over one-shot/creation jobs.
- Original consenting subjects can stop even after membership revocation.
  Generations, attempts, claims and current authority checks fence old workers;
  admission independently rejects expired or revoked monitoring evidence.
- Invalidate observations before refresh, cap freshness at consent expiry and
  preserve later independently consented one-shot results during stale cleanup.
- See the [monitoring boundary](docs/payment-monitoring.md) and
  [live verification ledger](EXECUTION_MANIFEST.md). No confirmation, capture,
  settlement, connected UI or actual Stripe effects are claimed. Release gates
  remain R0 / 0-of-6 / 0-of-14.

### 12 September 2026 — observation-only payment requests

- Added authenticated `provisioning:requestObservation` with explicit read-only
  consent and required existing immutable payment. Validate binding fields before
  scheduling and invalidate old authorization before a new observation attempt.
- Persist creation/observation mode for new job generations. Observation jobs
  cannot create replacement intents or provider bindings; missing bindings block
  the worker. Active creation jobs are not reused by observation requests.
- Added six regressions and exercised successful observation completion through
  the new request path. 270 unit tests / 1,288 assertions, both typechecks, lint,
  build and native local Convex regression passed. No provider request was sent.
- This is one-shot observation, not recurring monitoring, confirmation, capture,
  settlement or connected UI. R0 / 0-of-6 / 0-of-14 unchanged.

### 11 September 2026 — native provisioning persistence checkpoint

- Extended the isolated Convex harness to exercise actual internal provisioning
  mutations, not handler doubles. Twenty-four concurrent same-request calls create
  three bindings and 21 replays; 12 later immutable conflicts are rejected.
- Added three different-payload first-write races on absent keys: six requests,
  three winners and three rejected losers. Verify exact target, binding and audit
  contents for whichever request wins, before and after native restart.
- Twenty-four concurrent revocation calls produce three revocation audit records
  and 21 replays. Internal-only access, allowlist, stale-version, request-conflict
  and immutable-target checks remain enforced. Existing admission regression passes.
- Preserve [source-bound local evidence](docs/receipts/provisioning-persistence-2026-09-11.json).
  Synthetic fixture labels do not verify source authenticity, customer ownership,
  hosted authorization or connected-provider acceptance. R0 / 0-of-6 / 0-of-14 unchanged.

### 11 September 2026 — tracked repairs and internal provisioning

- Added a [working task list](TASKS.md) and [live execution manifest](EXECUTION_MANIFEST.md)
  with explicit completion criteria, dependencies and remaining work.
- Reconciled stale backend/provider setup and handoff instructions without erasing
  historical receipts or changing acceptance gates.
- Repaired Connections route/retry and role-gate heading focus. Added 24 static
  route regressions; offline Chrome interaction checks passed. Managed Preview,
  mobile/zoom and connected UX acceptance remain unverified.
- Added internal-only audited immutable membership/catalog/customer provisioning
  and revocation. Recheck revocation across admission/payment paths and consenting
  membership after provider I/O. External source verification remains required;
  [internal audit labels are not authentication or attestation](docs/trusted-provisioning.md).
- Final local checks: 264 unit tests / 1,233 assertions, 104 pinned-Node SDK tests,
  both typechecks, lint, build and plan validation. Local Convex admission again
  passed concurrency and restart regression with synthetic fixtures.
- Current-SDK disposable local staged bootstrap passed with three finalized
  transactions and all 14 operations locked. This is not reservation, public
  Preprod execution or end-to-end acceptance. See the live manifest for the
  separate maintenance/recovery rerun results. R0 / 0-of-6 / 0-of-14 unchanged.

### 11 September 2026 — connected prerequisites

- Added separate Preprod profile/preflight, reconciled direct Wallet SDK 1.2.0
  and tested shared transitive runtime identities while preserving local guards.
- Added consent-bound Lace balance/submission transport and no-resend recovery;
  trusted transaction/submission backend adapters and UI wiring remain absent.
- Added authenticated approved-quote freezing and internal, generation-guarded
  Stripe unconfirmed test-intent provisioning/reconciliation. No payment executed.
- Added all-entrypoint revision-exhaustion regression. 215 unit tests / 1,068
  assertions, 104 SDK tests, static/build checks and real local Convex admission
  concurrency/restart regression passed. R0/0-of-6/0-of-14 unchanged.
- [Exact implementation limits and next work](docs/connected-implementation.md).

### 11 September 2026 — read-only Preprod block observation

- Added fixed-endpoint, fail-closed public Preprod RPC/indexer comparison and ten
  regression tests; command emits a source-hashed receipt without wallet access.
- Live agreement at finalized height 2,500,305; an earlier attempt rejected
  indexer lag. No contract state or SDK compatibility claim, no transactions.
- Prioritized Preprod contract observation, reservation and lifecycle; retained
  mandatory payment provenance and documented fresh-wallet/cohort dependencies.
  R0 / 0 of 6 / 0 of 14 remain unchanged.

### 10 September 2026 — atomic Convex admission

- Added authenticated buyer admission using trusted frozen quote/version,
  deployment provenance, current payment observation, timing policy and all
  canonical uniqueness indexes within one Convex mutation. Await the binding
  insert before reporting success. Input provisioning remains unavailable.
- Real isolated native Convex passed 16 concurrent requests: one binding, seven
  idempotent replays and eight rejected conflicts; the binding survived restart.
  Fixtures use local admin identities and synthetic observations, not verified
  Privy, Stripe or preprod state. [Receipt](docs/receipts/convex-atomic-admission-2026-09-10.json).
- Pinned binary verification precedes execution. Tamper, cold-download,
  SIGINT/SIGTERM cleanup, unowned-process preservation and full retry passed.
  Root environment remained unchanged. Fixed a lifecycle-test ownership race;
  final pinned-Node rerun passed with all 16 source hashes unchanged.
- 155 unit tests / 757 assertions, 63 Midnight SDK tests, types, lint and build
  passed. R0 / 0 of 6 / 0 of 14 remain unchanged. Next: trusted provisioning and
  ordered Stripe observation ingestion, then real provider/preprod acceptance.
- Prior checkpoint [PR #1](https://github.com/pcrsicp/milo/pull/1) merged at
  `060fb4e6`; GitHub returned no checks/workflows, so no remote CI pass is claimed.

### 10 September 2026 — preprod provider connections and MIT documentation

- Added `/connections`: Privy email-only login, optional native Convex JWT/session
  verification and consented Lace v4 preprod status checks. No seed import,
  signing, submission, wallet/account binding or mainnet path. Synthetic orders
  remain separate. Identity changes and rejected-token refresh clear verified UI.
- Added strict Convex auth configuration, initial membership/payment-binding
  schema and a server-only Stripe test observer using independently retrieved
  manual-card capture expiry. No payment action, webhook, admission or settlement
  mutation is exposed. Deployment and live provider acceptance remain pending.
- Installed blueprint pins: Privy 3.40.0, Convex 1.45.0, Stripe 22.6.1 and connector
  API 4.0.1. Secret files are ignored; runtime/static browser config allowlists
  only public app ID, deployment URL and preprod network. No disclosed secrets or
  wallet recovery material were imported.
- Added a licence for original project material (MIT at this date; the project is Apache-2.0 since
  commit `31b5c9a`), preserved third-party notices, and
  shortened README with a Mermaid sequence diagram separating local and target
  flows. See [provider setup](docs/provider-setup.md).
- Verified 128 unit tests / 705 assertions, 63 isolated Midnight SDK tests,
  root/Convex typechecks, lint, build and planning links. Static config passed an
  HTTP read and secret-canary exclusion check. Browser checks opened the genuine
  Privy email dialog, verified consent gating, missing Lace rejection and missing
  Convex status; no email/OTP was sent or session authenticated.
- Managed Preview startup is platform-blocked; browser checks used a bounded
  foreground dev-script diagnostic, subsequently stopped. No current managed
  Preview, Stripe connection, Convex deployment or preprod transaction is claimed.
  R0 and acceptance counts 0/6, 0/14 remain unchanged.

### 10 September 2026 — trusted frozen-quote observation coordinator

- Added an internal read-only coordinator accepting only quote ID and address.
  Server-owned dependencies load frozen public configuration, derive expected
  policy before network reads, and validate versioned native observation identity,
  state, keys, deadlines and freshness. No caller-selected endpoints or policy.
- Wired the staged diagnostic through that coordinator using an explicitly
  synthetic frozen quote fixture; no auth, payment, persistence or reservation
  substitute was introduced. Contract source, generated code, SDK pins and chain
  limits are unchanged.
- Fresh native `run-zYY0XT`: three staged transactions finalized, 14 operations
  installed, lock/state observation at block 32, supervisor/driver exit 0 and all
  16 captured integration source hashes unchanged. See the
  [sanitized receipt](docs/receipts/observation-coordinator-2026-09-10.json).
- Verified full 14-circuit compilation, 63 unit tests / 586 assertions, 63
  pinned-Node tests, lint, typecheck and build. Independent review prompted
  stronger semantic-rejection fixtures with recomputed IDs, plus correction of
  stale staged-deployment prose. The UI remains synthetic; R0 and 0/6, 0/14 remain.

### 10 September 2026 — chain-bound admission timing

- Require version-2 observations carrying all four immutable contract deadlines,
  exactly matched to the trusted frozen quote. Preserve original generated
  contract artifacts, SDK pins, chain limits and the no-reservation boundary.
- Reject admission at/after acceptance or when the resolution deadline plus the
  positive server-owned capture/reconciliation margin reaches actual provider
  capture expiry. Missing policy/expiry, unsafe timestamps and legacy observations
  fail closed; exact `BigInt` comparisons prevent unit conversion/overflow errors.
- Added boundary, malformed-input, deadline-substitution, no-write, idempotency and
  native-record interoperability tests. Independent review also caught and fixed
  negative observation timestamps inside the freshness window.
- Local verification: 63 unit tests / 586 assertions, 58 pinned-Node integration
  tests, lint, typecheck and build passed. This does not establish a live payment
  observation, persisted canonical binding or reservation; R0 / 0 of 6 / 0 of 14
  remain unchanged.
- Fresh native `run-xr5c1B` passed with supervisor/driver exit 0, all three staged
  transactions finalized, and the version-2 observation verified at block 32.
  All 18 pre-run source hashes remained unchanged; the
  [sanitized receipt](docs/receipts/admission-timing-2026-09-10.json) excludes
  deadline values and private inputs. Maintenance/recovery were not rerun.

### 10 September 2026 — native admission observation bridge

- Added an internal read-only observer that prepares independent public-state/key
  expectations, checks finalized node/indexer agreement and repeated genesis/block
  identity, then returns Milo's versioned backend observation record. The backend
  now rejects records missing block/state provenance; no deployed schema exists
  to migrate.
- Fresh native `run-k1ERXP` passed with supervisor and driver exit 0. Observation
  at block 33 matched the complete expected ledger, 14 verifier keys and locked
  authority. The [sanitized receipt](docs/receipts/admission-observation-2026-09-10.json)
  binds all 18 pre-run implementation hashes, unchanged after execution.
- Added observer-to-backend compatibility and rejection tests, including explicit
  missing auth/payment refusal, input mutation, controls-mode counter 3, legacy
  provenance, chain substitution and an exact public-evidence allowlist.
- Verification passed: 57 pinned-Node integration tests, 57 Bun unit tests /
  531 assertions, lint, typecheck, build and canonical plan checks. Independent
  review's nonblocking coverage suggestions were added and verified.
- Added the [SDK → chain → Milo map](docs/midnight-integration-map.md), separating
  native execution from the synthetic web UI and unimplemented provider adapters.
- This is not canonical admission, real payment authorization, persisted binding,
  a reservation proof or a browser connection. **R0, 0/6 and 0/14 remain unchanged.**

### 10 September 2026 — maintenance controls and bounded actor recovery

- Added live pre-lock seven-update positive control and stale/future/signed-update
  replay evidence; all three counter failures finalized as `FailFallible` with
  exact, private-log/indexer-bound `ReplayCounterMismatch` classification. Extended
  post-lock coverage to seven retained-key cases, all exact custom 134 rejections
  with unchanged later finalized/indexed state.
- Added encrypted actor-local bootstrap journaling and actual actor `SIGKILL`
  after deployment send/result but before acknowledgement. A fresh process
  reconciled through the indexer without resending, then installed and locked:
  three bootstrap submissions, zero duplicates. The wallet broker and recovery
  key survived; this is not browser/device/full-wallet or provider-outage recovery.
- Recorded final native runs `run-f5Chw8` and `run-jOvW0R` in strict
  [maintenance](docs/receipts/maintenance-controls-2026-09-10.json) and
  [recovery](docs/receipts/actor-recovery-2026-09-10.json) receipt allowlists.
  [Pre-run implementation hashes](docs/receipts/final-native-source-2026-09-10.json)
  cover all 16 listed files, verified unchanged after both runs. Earlier
  `run-9Q08JL` / `run-oyoIbg` had only post-run provenance and are superseded,
  not retroactively source-attested. Both durable driver exits are 0;
  maintenance shell exit 0 was observed, while recovery is evidenced by supervisor
  completion/cleanup markers without a directly observed shell exit. Final
  regression results remain separate. No raw logs/private journals are published.
- Final local verification passed: lint (64 files), strict typecheck, plan check
  (8 documents / 51 gate IDs / 185 links), 56 unit tests / 521 assertions,
  50 integration tests on pinned Node 24.20.0, and build. Independent review
  reported no concrete findings in integration or final scoped backend policies;
  these results are not remote CI, provider completion or a security certification.
- Prepared provider-independent backend admission/reconciliation policy scaffolding;
  only pure/local test-double evidence, no deployed atomic persistence, authenticated
  provider, payment or browser integration. Canonical admission and reservation
  remain next. **R0 / 0 of 6 providers / 0 of 14 operations; R1/R3 incomplete.**
- Added local protected-delivery policy: exact-three bounded image manifests,
  owned one-time grants, immutable storage association and per-read authorization.
  Actual byte inspection, authenticated transport and chain-binding adapters remain open.
- Added read-only, SHA-pinned GitHub Actions checks for the exact toolchain,
  compilation, local tests and build. Actionlint passes. The historical PR #1
  check results are recorded separately in the execution plan; no current-head
  CI result is claimed for this changelog checkpoint. No credentials, native
  transactions or private artifacts are included in the workflow.

### 10 September 2026 — admission boundary and retained-key negatives

- Added the dependency-ordered execution plan covering the remaining R1–R5 work,
  permitted parallel feasibility lanes and external approval gates. Corrected stale
  manifest/publication wording; historical repositories are not current PR state.
- Removed the old full-mode diagnostic reservation call. Bootstrap diagnostics
  cannot execute a circuit before a real admission implementation exists.
- Added explicit `--maintenance-audit`, four signed retained-key probes and exact,
  private-safe custom-code handling. The final native run rejected insertion,
  ordered remove/insert replacement, removal and authority restoration with
  `KeyNotInCommittee` (134), preserving the full contract at later observed blocks.
- Corrected two evidence hazards before accepting that result: an indexer action
  filter is not an as-of state query, and verifier insertion is not replacement.
  Generic errors, wrong causes, unknown outcomes and state drift fail closed.
- Recorded a source-fingerprinted sanitized receipt; 37 Node and 37 Bun tests / 397
  assertions plus static/build/plan checks pass. Pre-lock/replay controls, actual
  recovery, canonical admission and reservation remain open. R0, 0/6 and 0/14 stay.

### 10 September 2026 — staged bootstrap, not immutable admission

- Added an explicit `--staged-bootstrap` diagnostic using the original generated
  constructor and supported ledger primitives: seven-key deployment, seven-key
  insertion and maintenance-lock observation at one address, all within unchanged
  runtime limits. No generated source or dependency pin changed.
- Real local execution observed the complete 14-key/entrypoint set, exact original
  `DEPLOYED` ledger and empty-committee / threshold-one authority. All three
  transactions are measured before send and observed at their returned blocks.
- Added exact state/key/authority guards, signed counter/address controls, explicit
  runtime serialization conversion and interruption/unknown-outcome refusal tests.
  Partial and upgrade-trusted states remain non-admitted; staged mode never reserves.
- Recorded scoped latency and SDK SPECK fee estimates with margins, not settled
  charges or commercial affordability. The retained-key attack matrix, actual private
  recovery, canonical binding, reservation and R1 remain open; counters stay 0/6, 0/14.

### Earlier 10 September 2026 — deployment diagnosis, not deployment success

- Added a handoff-aligned continuation checklist and exact source-backed resource
  measurement contract. Protocol source, all 14 operations and readiness gates are unchanged.
- Added a read-only finalized-block preflight before deployment submission, with
  artifact/runtime/metadata binding, real unsigned extrinsic encoding, exact u64
  gas decoding and fail-closed individual weight/length comparisons.
- A fresh disposable run measured 30,804 encoded bytes (below 786,432) but
  1,330,680,000,001 declared ref-time (above 1,299,891,843,000). Execution weight is
  the identified dimension; deployment was not sent. Owned services stopped.
- Promoted the existing locked Polkadot API 16.5.6 to an explicit dependency;
  no resolved package version changed. Fixed Hash response/Bytes input assumptions
  against installed client source; added negative/privacy/guard regressions.
- At this resource-only checkpoint, staged verifier installation remained a hypothesis. R1 and full provider/operation
  counters remain blocked/unchanged; no cloud, payment or optional scope activated.

### Earlier native checkpoint

- Added a repository agent handoff with checkpoint evidence, the exact deployment blocker, ordered continuation steps, reproducible commands, deferred-work triggers and cross-check/publication rules.

- Reconciled stale manifest text with the published native/funding checkpoint: deployment block limits are the active protocol blocker; browser-wallet integration remains distinct from successful CLI funding.

- Verified the existing PR #2 was already merged with passing checks; continued on a fresh authorized branch.
- Unblocked local execution without Docker: pinned native node produced a block, exact native indexer observed the same block hash, and the pinned prover reported queue availability.
- Added opt-in, checksum-verified setup, isolated lifecycle controls, interruption regressions and scoped private diagnostics. The remaining Docker provisioning fault is not claimed fixed.
- Corrected standalone indexer configuration from exact source: SQLite/in-memory services do not require the three previously imposed backing-service passwords. Moved Docker Compose to an explicitly optional fallback.
- Added an isolated Node 24.20.0 transaction diagnostic with artifact/source validation, private-safe errors, pre-send identifiers and actual-fee DUST readiness. Finalized disposable funding and observed DUST pass; full deployment reaches submission but is rejected by the node's unchanged block limits. Reservation remains unexecuted.
- Verification: 37 Bun tests/397 assertions and 16 separate Node tests pass, along with lint, typecheck, build and bounded canonical-plan checks. R1, pilot and completed MID-row claims remain withheld.

## Earlier — verified local compiler/runtime slice

- M-01–M-03 moved from PENDING to ONGOING without claiming R1.
- Installed Compact devtools 0.5.1 and compiler 0.31.1 from exact official release archives with checked publisher SHA-256 digests; setup is repository-owned and Linux x86_64 scoped.
- Selected Compact runtime 0.16.0 and on-chain runtime 3.0.0 together, avoiding a silently newer duplicate transitive runtime. Added a real WASM identity/version canary; no blanket overrides.
- Rechecked current official support matrix through Firecrawl. Newer compiler releases are not adopted merely because they exist. The authenticated Firecrawl integration is available; sandbox CLI credentials are not.
- Original Compact order contract now compiles without skip flags: all 14 circuit artifact sets and 60 artifact hashes verified. Terms/capabilities, public timeouts and independent role actions use actual generated code, not the UI simulator.
- Corrected constructor-only bootstrap checks and an unintended public currency field after independent review. Raw-ledger injection and private fixed-currency policy regressions pass.
- Full verification passes: 33 tests/381 assertions, lint, typecheck, static build and canonical document checks. Added the negative disclosure compiler control and complete hashed artifact receipt.
- Added pinned Firecrawl CLI 1.23.3 as a development tool. Its real keyless Developer Index request was denied for this IP; the authenticated Developer Index integration succeeded. No CLI success or credentials are invented.
- Added an isolated digest-pinned Compose candidate, not an executed network. M-01–M-03 and R1 remain open: real prove/submit/observe and admission/maintenance checks are unfinished. Provider/operation evidence remains **0/6 and 0/14**.
- Docker runtime replacement was refused twice by the platform's active-operation guard after local jobs completed; reported and recorded as BLOCKED, not a successful network setup.
- PR #1 was discovered already merged outside this run. The authorized branch-rotation tool replayed the preserved toolchain/contract checkpoints onto current `main` for an independent follow-up PR; this run did not merge or close it.

## Earlier checkpoint — synthetic UI prototype

Implementation checkpoint: `6acd3a4531a851f8fea836f31149de6621a4425e`. This is a reviewable source commit, not a deployed or MVP release.

### Added and locally verified

- Native Bun/React prototype with separate public and interactive entries; no second API service or frontend bundler.
- Original synthetic three-image artwork, sample-byte verification, explicit approval/dispute confirmation and independent simulated payment state.
- Buyer, merchant and operator perspectives, bounded quote preparation, sample receipts and recovery/uncertain-outcome scenarios.
- Exact dependency setup, static build, typechecking and lint; 14 tests / 79 assertions pass.
- Actual browser checks for quote data, SHA-256 byte equality, approval consent, separate capture/void, disputes, unknown outcomes, synthetic recovery and failed rechecks.
- Stable component identities and explicit dialog focus return; named landmarks and task-first 320px layout. Axe reports zero automatic violations on sampled views, with incomplete contrast results—not an accessibility certification.
- Source-controlled progress/deferred/reactivated-state rules and [verification limitations](VERIFICATION.md). Live flow recording failed to reproduce the otherwise passing interaction reliably; failed captures are not presented as successful evidence.

### Not included

- Real authentication, Compact contracts, proving, chain observations, private-state backup, protected backend files or Stripe requests.
- Sponsorship, archive, inference, mobile SDKs and launch-film production.
- Real customer, performance, security-audit, accessibility-certification or MVP-readiness claims.

## 2026-09-07 — evidence and execution planning

- Corrected the unsupported Midnight.js umbrella `/protocol` import using exact published exports.
- Added source-backed dependency and environment decisions, experimental-version acceptance rules, and cross-wave UI/protocol sequencing.
- Preserved independent chain/payment authority, recovery distinctions, unresolved organizer/network conflicts and the **0/6, 0/14** evidence baseline.
- Published planning checkpoint `45c000e14eba0a332ad28e99ec4ce7a8c974ee02` in PR #1.
