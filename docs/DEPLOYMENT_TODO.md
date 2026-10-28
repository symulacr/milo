# Deployment continuation checklist

## Connected prerequisites checkpoint — 11 September 2026

See [current implemented/remaining checklist](connected-implementation.md) before
using the older deployment tasks below. Preprod preflight and Lace transport are
not a deployment executor; quote freezing and Stripe intent creation do not supply
payment authorization. Fresh wallet approvals and securely configured provider
credentials remain necessary, alongside the listed unimplemented backend/UI seams.

Provider work is now separately prepared in [provider setup](provider-setup.md):
Privy/Lace connection diagnostics, optional Convex session verification and a
read-only Stripe test observer. This does not close the native deployment lane
below or authorize mainnet. Missing hosted development deployment, rotated
credentials, trusted admission inputs and actual preprod lifecycle evidence remain blockers.

Scope: handoff §4, blueprint §3.3 and roadmap M-01–M-03/R1. This checklist
tracks execution; it does not replace the canonical plan or close readiness gates.

The [full execution plan](EXECUTION_PLAN.md) covers downstream integration, QA,
submission and externally approved live work. The [maintenance audit](maintenance-audit.md)
records the current negative-test implementation and evidence boundaries.

- [x] Read the handoff and canonical admission requirements; inspect current checkout.
- [x] Refresh PR state: PR #2 merged with explicit permission at `72fbb23`
  after green checks, before this deadline-policy iteration. The 10 September
  discovery checkpoint found `hoplite/kios-dfb1e49c` aligned with
  `main`/`origin/main` at `9d9c321`, with no open branch PR.
- [x] Observe independently expected public state, all keys and maintenance lock
  against finalized node/indexer state; bind a versioned backend observation to
  genesis/block/state fingerprints. [Native receipt](receipts/admission-observation-2026-09-10.json)
  is a read-only prerequisite, not canonical admission.
- [x] Extend observations to version 2 with exact immutable deadline provenance;
  verify native `run-xr5c1B` at block 32 with supervisor/driver exit 0 and all 18
  pre-run source hashes unchanged. [V2 receipt](receipts/admission-timing-2026-09-10.json).
- [x] Verify local acceptance and complete resolution/capture-window policy,
  strictly positive server-owned margin, exact expiry boundary and fail-closed
  legacy/unsafe input handling. 63 unit tests / 586 assertions and 58 integration
  tests pass; provider retrieval, measured margin and atomic persistence remain open.
- [x] Identify the pinned runtime cost API, SCALE types and applicable block limits.
- [x] Add bounded read-only measurements before sending a finalized transaction:
  artifact fingerprint, transaction/extrinsic bytes, runtime/block identity and cost.
- [x] Test encoding, limit comparison and fail-closed/privacy behavior.
- [x] Reproduce the disposable experiment and identify the actual limiting dimension:
  [execution weight, not encoded size](deployment-resources.md).
- [x] Assess pinned staged verifier APIs against the single-contract policy;
  implement an explicitly non-admitted diagnostic without changing contract rules.
- [x] Verify the opt-in seven-plus-seven bootstrap on the unchanged native network
  and record all three transaction resources, observations, latency and fee estimates.
- [x] Observe complete original state/14-key equality and positive maintenance-lock
  state; reject incomplete/upgrade-trusted observations with the local completion guard.
- [x] Verify bounded complete artifacts/state, actor-process interruption/restart,
  final locking and retained-key maintenance controls. This does not close broader
  wallet/provider/browser recovery or admission acceptance.
- [x] Obtain independent review and rerun relevant regression checks for the
  resource-diagnosis checkpoint (not a staged-bootstrap implementation).
- [x] Update evidence, manifest, changelog and handoff for a bounded checkpoint.
- [x] Obtain independent staged-bootstrap review, run 28 Node tests and the full
  non-network regression suite, and retain [final native evidence](staged-bootstrap.md).

- [x] Remove the premature full-mode reservation call and correct stale status text.
- [x] Verify four retained-key native maintenance rejections with exact code 134 and
  unchanged later finalized/indexed state; retain the [sanitized audit](maintenance-audit.md).

- [x] Verify pre-lock positive maintenance batch and actual stale/future/signed-update
  replay controls, then seven post-lock retained-key cases:
  [allowlisted native receipt](receipts/maintenance-controls-2026-09-10.json).
- [x] Verify actual actor SIGKILL before deployment acknowledgement, encrypted
  restore and fresh indexer reconciliation without duplicate sends:
  [allowlisted native receipt](receipts/actor-recovery-2026-09-10.json).

Next: canonical quote/payment-window/state/artifact/key/entrypoint/address admission,
atomic persisted binding, then buyer-proved reservation and lifecycle evidence.
Keep full-wallet/broker loss, coordinator-key loss, provider outage, clean-profile/
device and reservation recovery open. The native restart kept the wallet broker
and recovery key alive. Pure backend policy tests are not deployed-provider proof.
The earlier maintenance/recovery reruns use an actual [pre-run implementation snapshot](receipts/final-native-source-2026-09-10.json),
all 16 listed files verified unchanged afterward. Both durable driver exits are 0;
maintenance shell exit 0 was observed; recovery has completion/cleanup log markers
but no directly observed shell exit. Earlier runs retain their post-run provenance
limitations. Final local regression checks passed separately: lint (64 files),
strict typecheck, plan check (8 documents / 51 gate IDs / 185 links),
56 unit tests / 521 assertions, 50 integration tests on pinned Node 24.20.0,
and build. Independent integration/backend scoped review reported no concrete findings.

Publication and CI are tracked by the continuation PR, not inferred from local checks.

Stop conditions: no raised chain limits, omitted operations, dependency upgrades,
automatic outcome-unknown retries, public-network transactions or real credentials.
R1 remains blocked. Cloud/auth/payment work is outside this deployment lane; isolated
feasibility may be separately prioritized under the full execution plan. Optional
features remain deferred until their documented triggers and approvals.
