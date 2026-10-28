# Milo execution plan

> **Operational task list · 10 September 2026.** This is a dependency-ordered
> implementation checklist, not a replacement for the blueprint, roadmap, or
> building guide. The highest achieved release level is **R0**. Local native
> services, disposable funding, compiled artifacts, staged bootstrap/lock,
> maintenance controls and actor-process restart are bounded partial evidence;
> completed Midnight coverage remains
> **0/6 provider rows and 0/14 operation rows**.

## Working rules

**Connected prerequisites checkpoint:** implemented separate Preprod preflight,
SDK reconciliation, consent-bound Lace transport, approved-quote freezing and
internal test-payment provisioning/observation. These are not completed deployment,
reservation or lifecycle gates. [Remaining dependencies and verification](connected-implementation.md)
include concrete transaction authority, native contract observation, approved
catalog/customer inputs, payment confirmation and UI wiring. No gate closes early.

**11 September priority update:** execute Preprod contract observation, then
buyer reservation and lifecycle ahead of remaining provider rollout. The first
read-only node/indexer block comparison passed; contract/SDK compatibility and
transaction execution did not. See the [dependency checkpoint](network-policy.md#read-only-preprod-checkpoint--11-september-2026).
Payment provenance remains a mandatory admission dependency even while Stripe
ingestion is deferred. No synthetic input may substitute for it.

- Keep the fixed `image-pack-v1` scope and one bilateral order contract per
  order. Preserve M-01–M-14, B-01–B-11, MID-P1–P6, and MID-T01–T14 IDs.
- A mock, compiler result, deployment, local API response, or positive policy
  observation does not close an integration gate. Record command, cohort,
  network, fingerprints, expected/actual result, negative case, and limitation.
- Work marked **parallel** may be explored in isolation, but its dependent gate
  cannot close early. Only owned disposable local transactions are in the current
  lane; no public-network/paid-cloud spending, production data or approval bypass
  is authorized by this plan. Provider credentials require approved isolated setup.
- Any protocol, registry, storage-layout, authority, or policy alternative
  requires a reviewed ADR before implementation; retain the current approach
  until the decision is accepted.

## 0. Baseline and control plane — DONE / ongoing maintenance

- [x] **R0 / M-01 planning baseline:** canonical documents, synthetic UI,
  Compact compiler/runtime evidence, native node/indexer/prover diagnostics,
  disposable funding, and staged bootstrap evidence exist.
- [ ] Refresh the exact toolchain, local-network cohort, artifact hashes,
  resource limits, and release evidence on every material protocol change.
  **Exit:** reproducible fresh setup/health/reset and immutable receipt.
  **Depends on:** none. **Blocks:** M-02 onward when a cohort changes.
- [ ] Obtain written organizer clarification for date/timezone/rules/rubric and
  reuse eligibility. **Exit:** retained written response; otherwise omit
  eligibility claims. **External decision gate:** organizer.
- [ ] Maintain a current truth table and an immutable release reference; do not
  convert historical receipts into current PR/CI status. **Exit:** release SHA,
  lockfile, artifacts, addresses, fixtures, known limitations, and evidence.
- [x] Establish and verify remote CI for the pinned checks with private-safe logs;
  retain current commit-linked results and resolve review feedback. Local tests and
  an enabled PR auto-fix subscription are not passing CI evidence.
  **Evidence:** read-only `.github/workflows/local-checks.yml` and all three remote
  checks passed on the historical `roundbolder-afk/milo` PR #1 head `019edb1`
  (squash-merged as `445b093`; squash heads are not preserved in this clone). That
  PR added the pinned local-checks workflow. The later `pcrsicp/milo` PR #1 (merge
  `060fb4e6`) is a different repository's PR #1: its merge message records that
  GitHub returned no checks or registered workflows, so no remote CI pass is
  claimed for it — see [the handoff](AGENT_HANDOFF.md). New heads still
  require their own CI results; the old pass is not a blanket release guarantee.
- [x] Correct stale manifest/publication summaries and remove the legacy pre-admission
  reservation call. **Evidence:** both diagnostic modes have no SDK circuit-call
  entrypoint; source-boundary canary and existing bootstrap tests pass. This does
  not implement admission or prove network rejection.

## 1. Immutable local order admission — ONGOING, critical path to R1

1. [x] **Bounded M-02 compiler/runtime slice:** typed terms/capability vectors: independent buyer,
   merchant and operator roles; salts; bounds; disclosure/terms/digest/version
   bindings. Test malformed, altered, stale, replayed and cross-order inputs.
   **Exit:** compiler/runtime positive and rejection evidence with preserved IDs.
   **Evidence:** existing original generated-runtime suite. Network/provider and
   parent milestone completion remain separate; recheck this slice after source changes.
2. [ ] **M-03 admission guard:** attack every retained deployment/maintenance
   key using the exact deployed SDK cohort. Show supported irreversible policy
   on all relevant operations *and* rejected replacement/maintenance attempts;
   deleting a local key or threshold zero is insufficient. **Exit:** retained-key
   adversarial evidence plus inspected policy. **Depends on:** M-02, staged
   bootstrap. **Current work:** ongoing; positive lock observation alone is not
   completion.
   **Implemented probe:** [seven-case retained-key audit](maintenance-audit.md), with
   exact node error classification and independently checked finalized state.
   Live evidence does not replace the full canonical admission gate.
   - [x] Seven retained-key native rejection cases (four operation/authority and
     three counter/replay cases), exact code 134 and unchanged finalized/indexed
     state: [verified receipt](receipts/maintenance-controls-2026-09-10.json).
   - [x] Pre-lock seven-update positive batch and actual stale/future/signed-update
     replay controls; counter failures are finalized `FailFallible` with matched
     `ReplayCounterMismatch`, not post-lock authority failures.
3. [ ] Test actual partial-bootstrap interruption and private recovery before
   canonical admission: preserve pending identifiers and actor-local secrets,
   reconcile confirmed/rejected/unknown outcomes, never guess or deploy a duplicate.
   **Exit:** real interruption/restart evidence and non-admissible incomplete state.
   **Depends on:** item 2; a transport fixture does not close this task.
   - [x] Bounded native actor restart: [receipt](receipts/actor-recovery-2026-09-10.json)
     verifies actual `SIGKILL` after deployment send/result at the broker but before
     acknowledgement, encrypted restore, fresh indexer reconciliation and exactly
     three bootstrap submissions without duplicates.
   - [ ] Remaining recovery acceptance: wallet/broker or coordinator-key loss,
     provider outages/unknown outcomes at real boundaries, clean-profile/device
     recovery and reservation interruption. The successful actor case kept the
     wallet broker and recovery key alive; it does not close M-05 or MID-P1.
4. [ ] Bind frozen quote/window/state/key/entrypoint/artifact fingerprints to
   exactly one canonical address, atomically where application state is involved.
   Reject duplicate, swapped, stale, wrong-network and cloned-contract bindings.
   **Exit:** persisted canonical binding and negative controls. **Depends on:**
   item 3's bounded bootstrap restart is evidenced; broader recovery acceptance
   stays open. **Immediate implementation priority:** canonical admission, without
   claiming those broader gates passed or introducing a silent registry/protocol change.
   The canonical atomic Convex repository is implemented and locally verified with
   synthetic inputs (receipt below); pure package policy tests alone are not a
   persisted binding. Connect and verify trusted observation/payment/auth
   boundaries before calling this connected admission. Neither closes a provider row.
   - [x] Read-only native observation producer: independently expected initial
     state/keys/lock, node/indexer agreement, genesis/block provenance and a
     versioned backend record. [Receipt](receipts/admission-observation-2026-09-10.json)
     is fixture-based and creates no canonical binding.
   - [x] Local deadline/capture-window policy: v2 records bind all four immutable
     deadlines; admission must precede acceptance and leave a positive
     server-owned margin strictly before actual provider capture expiry.
     Boundary/overflow/substitution tests use explicit provider/repository doubles.
     The [v2 native receipt](receipts/admission-timing-2026-09-10.json) separately
     verifies the deadline-producing observer at block 32, not live admission.
     Real provider retrieval and measured margin configuration remain part of the
     unchecked parent task. These policy tests do not establish atomic persistence;
     the separate local Convex slice below does, with synthetic inputs only.
   - [x] Internal frozen-quote observation coordinator: reject caller-supplied
     policy/transports, compare retrieved constructor inputs with frozen policy
     before reads, and validate native record identity/freshness. Fresh
     [native receipt](receipts/observation-coordinator-2026-09-10.json) exercises
     the coordinator at block 32 with an explicitly synthetic in-memory quote.
     This historical receipt is not authenticated retrieval or persistence. The
     implemented atomic mutation rechecks quote version/current payment state;
     the production worker needs bounded dependency cancellation and cleanup.
   - [x] Actual Convex admission mutation and isolated native concurrency/restart
     slice: [receipt](receipts/convex-atomic-admission-2026-09-10.json) records one
     persisted winner across 16 calls. Synthetic observations/local admin identity
     do not close the parent gate. The [connected checkpoint](connected-implementation.md)
     adds buyer quote freezing and internal test-intent creation/ordered observation
     writes, with request-driven one-shot scheduling. Later
     [bounded monitoring](payment-monitoring.md) adds separately consented recurring
     reads, not unbounded reconciliation or provider acceptance. The checkpoint's
     updated local Convex admission regression does not verify actual worker
     provider effects/concurrency. Trusted membership, approved-quote/customer and
     chain ingestion, real hosted authentication, Stripe confirmation and Preprod
     contract observation remain required.
5. [ ] From inspected `DEPLOYED` bootstrap state, execute buyer-authorized
   `reserve`, observe `RESERVED`, and preserve pending identifiers/private
   recovery context across an actual interruption. Resume or safely reconcile
   without duplicate admission. **Exit:** prove → submit → indexer observation,
   interruption/recovery trace, and no usable order after failed admission.
   **Depends on:** item 4.
6. [ ] Complete independent/adversarial lifecycle evidence: distinct actor
   stores/witnesses; accept, delivery commitment, approve, dispute, timeout and
   terminal-state/replay/race failures. Map actual results to every applicable
   MID-P and MID-T row rather than incrementing counters by inference.
   **Exit:** required real rows are complete with positive and negative evidence.
   **Depends on:** item 5. **R1 gate:** only after the full local path is real;
   staged deployment and funding do not pass it.
7. [ ] Measure one-per-order deployment/proving latency, DUST/NIGHT cost, and
   wallet feasibility on the named target cohort. **Exit:** bounded measurement,
   affordability/safety decision, and no undisclosed spend. **Decision gate:**
   if unacceptable, ADR for a shared registry before any design change.

## 2. Independent feasibility lanes — preparation ongoing; provider gates PENDING

Current preparation includes the preprod-only `/connections` diagnostic,
Convex Privy-JWT configuration/membership schema, atomic admission, approved-quote
freezing and server-only Stripe test provisioning/observation through an internal
Node action. [Setup and unclosed gates](provider-setup.md) are explicit. Privy dialog
rendering and missing-provider browser checks are not authenticated provider
acceptance. Connected UI admission, mainnet and business-circuit execution remain
disabled; the authenticated backend admission mutation exists independently.

- [ ] **B-02 / M-04 prerequisites:** isolated Convex schema, atomic
  read-index/insert, inbox/outbox idempotency, crash and duplicate/out-of-order
  recovery. **Exit:** deployed isolated environment and durable-state tests.
  **Historical policy preparation:** the September 10 suite passed 56 unit tests /
  521 assertions, including 19 backend tests, and 50 integration tests; scoped
  independent review reported no concrete findings. Subsequent real local Convex
  evidence verifies atomic admission and restart persistence with synthetic inputs.
  Neither establishes hosted Privy authentication, Stripe webhook ingress, actual
  payment-worker effects/concurrency or connected browser acceptance. See the
  [current checkpoint](connected-implementation.md) for the newer bounded checks.
- [ ] **B-03:** Privy email OTP → native Convex ES256/JWKS validation,
  membership/disabled-user/refresh/identity-switch denial and redaction.
  **Exit:** real isolated auth evidence. **No fallback auth substitution.**
- [ ] **M-06 / B-04:** authenticated membership checks on every file read;
  constrained upload/manifest; guessed ID, orphan, overwrite and tampering
  rejection. **Exit:** clean-profile authorized and denied file tests. **Depends
  on:** B-03 to close; storage experimentation may precede it.
  **Preparation only:** tested local delivery policy checks constrained immutable
  manifests, grant ownership/reuse and per-read access. Real stored-byte inspection,
  authenticated transport and confirmed-commitment adapters remain open.
- [ ] **M-04 / B-09:** supported browser wallet/prover/artifact cohort; separate
  buyer/merchant contexts; quote-to-canonical-address binding; pending/stale/
  rejected outcomes; encrypted actor-local export/import. **Exit:** real browser
  prove/sign/submit/observe and clean-profile recovery—never seed collection.
  **Depends on:** section 1 admission; blocks R2.
- [ ] **M-05:** perform an actual interrupted private-state recovery, not a
  simulated restore: export, clean profile/device import, own-order access, and
  reconciliation without exposing a wallet seed. **Exit:** evidence trace and
  negative cross-actor access test. **Depends on:** M-04.

## 3. Connected workflow and payment — PENDING

1. [ ] Complete M-04–M-06 integration only after section 1 admission evidence:
   independent roles authenticate, reserve, observe public/private boundaries,
   exchange protected delivery, and recover. **R2 exit:** exact browser/wallet/
   prover setup and independent-actor recovery evidence.
2. [ ] **M-07 / B-06 (isolated work may start now):** use Stripe sandbox hosted
   Checkout/manual capture, backend-held keys, raw-byte signed webhooks and
   atomic durable inbox/outbox. Exercise authorization, window/expiry,
   capture, void/cancel, duplicate/out-of-order webhook, return interruption and
   reconciliation. **Exit:** observed test-mode records bound to admitted chain
   state; no live keys accepted. **Depends on:** M-02 for exploration; M-04/M-05
   and observed admission for the complete path.
3. [ ] **M-08:** replace only verified simulated edges in the buyer/merchant
   workspace; expose environment, settlement and recovery truth. Preserve
   Zod/native CSS/Radix accessibility constraints and clearly label simulations.
   **Exit:** usable two-role flow based on real integrations. **Depends on:**
   M-04–M-07.
4. [ ] **M-10:** retain a truthful synthetic landing/demo route with focus,
   history, reduced-motion and provenance checks; use readiness-appropriate CTAs.
   **Exit:** labeled, tested demo; it never proves product integration.

## 4. Pilot-candidate verification and operations — PENDING

- [ ] **M-09 / B-05 / B-09:** execute privacy, wrong-role, leak, replay, race,
  timeout, outage, webhook, restore and runner-integrity negatives against the
  integrated slice. Browser Use Cloud requires isolated public synthetic QA,
  approved capacity and independent assertions; its prose is not proof.
- [ ] Accessibility and task QA: keyboard/focus/error states, 200% zoom,
  screen-reader checks, reduced motion, public/private disclosure, and observed
  buyer/merchant task comprehension before explanation. **Exit:** issues fixed
  or honestly retained with evidence.
- [ ] **M-11:** reconciliation queue, health/expiry alerts, restore
  drill, incident owner, reminder/escalation decisions and operator runbook.
  **Exit:** failure/recovery drill and support process evidence.
- [ ] **R3:** admit only when all required MID, M-07–M-11, Preview, payment,
  supported-wallet, privacy/accessibility, recovery and operations evidence is
  present. A passing R3 does not authorize live use.

## 5. Submission and live operation — PENDING / approval-gated

- [ ] **M-12:** package the exact, independently reproducible claimed level:
  SHA, notices, artifacts, provider/operation evidence, README/deck/video,
  safe media and explicit limitations. **Exit:** organizer requirements and all
  claimed gates pass. Publishing code is not submission.
- [ ] **R4:** request explicit approval only after R3: separate live credentials,
  legal/merchant arrangements, consent/retention/support policies, safe proving
  and funding, monitored reconciliation, operator capacity and deployment
  approval. **External decision gates:** approvers, providers, counterparties.
  Do not admit real counterparties/payments before approval.
- [ ] **R5:** measure repeat orders, retention, margins, support cost and
  independent integrations. **Exit:** observed cohort economics/customer value,
  not feature completion.

## Deferred work — do not reactivate silently

- [ ] **M-13 / Cascade archive:** only after B-07/M-09 and a separate publication
  approval; use an operator-approved synthetic public bundle with retrieval,
  digest/chain verification, privacy and cost evidence. Trigger: core flow
  passes and public-evidence value is demonstrated.
- [ ] **B-10 sponsorship:** trigger: B-09 named consumer wallet/prover lifecycle
  passes; prove operator-funded DUST safely before claiming no token purchase.
- [ ] AI review assistance, mobile/Kuira, and heavy 3D/**M-14**
  launch film remain deferred. Triggers: demonstrated customer need plus the
  respective compatibility/safety/allowance evidence; M-14 additionally needs
  R3, approved capture/rights and full-output review. None replaces M-12 or the
  core protocol path.

## Evidence and status updates

For each bounded task, use `PENDING → ONGOING → DONE`, or record the specific
blocker. Update the manifest only with current evidence, retain historical
receipts as historical, and reopen affected dependent gates after a regression.
Do not promise completion of organizer, provider, spending, legal, or live-pilot
approval gates without their external evidence.
