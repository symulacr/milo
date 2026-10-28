# Midnight integration audit — 15 September 2026

> **Audit document.** Four evidence-only critics reviewed the Midnight integration against the read-only blueprint (01, rank 1), roadmap (02), backend design (06), Midnight core audit (08) and the UX/UI specs (04/05). Every finding cites file:line and doc line, or is marked `UNSPECIFIED`. Companion to [docs/drift-audit-2026-09-14.md](drift-audit-2026-09-14.md).
> Critics: (C1) contract & protocol, (C2) integration runtime & operations, (C3) admission/binding/backend, (C4) UI/wallet boundary.

## Verdict

The integration is **honest, fail-closed and correctly bounded** — no hidden overclaims found. The manifest's `0/6 providers, 0/14 operations` counters are consistent with code and receipts everywhere. The Compact contract implements the full documented protocol (all 12 transitions, preconditions, contract-enforced invariants, typed fixed-order encoding, correct private-input handling). The browser-cannot-mint-truth boundary holds. The real gaps are **disclosed missing capabilities** (settlement layer, observer writer, operator-authority separation) and a small set of fixable drift items, most of which are fixed in this pass.

## Findings and resolutions

### Fixed in this pass (with source cites)

| # | Finding | Cite | Resolution |
|---|---|---|---|
| C4-F1 | Landing FAQ overclaimed sponsored execution in the present tense (B-10 is DEFERRED, no sponsor selected) | 01:1273; 05:244; 04:232 | **Fixed** — FAQ now states actor-funded execution on the current test profile, sponsorship as a deferred experiment with no selected sponsor, keeps the no-"free forever" disclaimer |
| C4-F2 | Lace discovery hardcoded `mnLace` instead of enumerating `window.midnight` (UUID keys); no multiple-wallet selection | 01:334 | **Fixed** — `discoverLaceWallets` enumerates all injected v4 wallets, fails closed, and the UI requires user selection for multiples; positive path still unverified against real Lace (docs/provider-verification.md:25) |
| C4-F4 | Wayfinding copy pointed "above" to a control rendered below after verification | UNSPECIFIED | **Fixed** — now "in the payment monitoring section below" |
| C1-F1 | Simulator's dispute graph narrower than the protocol: buyer-only, SUBMITTED-only | 01:589 (buyer in SUBMITTED; either party in ACCEPTED) | **Fixed** — sim dispute now allows buyer in ACCEPTED/SUBMITTED and merchant in ACCEPTED; `resolve-approve` requires a submitted delivery (order.compact resolve); new domain tests pin the matrix |
| C1-F2 | Simulator's single operator role spans dispute + finance authorities | 01:353–360 | **Annotated** — the resolution desk now discloses the collapse and points at §3.4.3 |
| C1-F5 | AGENT_HANDOFF stale "19 contract tests / 302 assertions" | current: 20/372 | **Fixed** |

### Open findings (escalated, not silently fixed)

| # | Finding | Severity | Source | Why open |
|---|---|---|---|---|
| C3-F1+F5 | Operator-authority separation absent: single `operator` role in schema; flat trusted-provisioning allowlist provisions any kind from one credential (latent — no operator surfaces exist yet) | medium | 01:353–361 | Product/schema design decision: split membership role or add authority-assignment records before dispute/finance/archive surfaces land |
| C3-F2 | `deploymentObservations` has no production writer; admission's chain-truth input is fixture-only (fail-closed, disclosed) | medium | 01:311, 01:278–282 | Needs the native observer ingestion path — real provider work |
| C3-F3 | Settlement layer absent: no webhook ingress, capture/void worker, outbox, crons | medium | 01:694–721; 06 §5.1 | Blocks capture/approval workflow; scheduled roadmap work |
| C3-F4 | Hosted Checkout absent: raw PaymentIntent, no Session binding, no abandoned-Session expiry | medium-low | 01:682–690, 01:698 | Interim adapter preserves manual-capture/one-attempt rules; schema change needs review |
| C3-F6 | No `auditEvents` family; superseded payment observations are deleted, not archived | low-medium | 01:311; 06 §3, §12 | Needed before settlement; contested-refund forensics have no durable home |
| C3-F7 | Binding replay identity includes observation/authorization IDs; legitimate re-observation retry dead-ends | low | 01:294 | Needs an operator unbind/migration path or relaxed `already-bound` match |
| C3-F8 | Merchant-side binding read path absent (binder is buyer-only) | low | 01:294–298 | Needed before merchant acceptance work |
| C3-F9 | `admissionTimingPolicies` has no provisioning path (fail-closed when absent) | low | 01:698–700 | Needs an audited operator provisioning path |
| C2-F1 | MID-Txx row IDs reused as harness stage labels and synthetic test titles | low | 01:452, 01:431 | Rename to neutral vocabulary; 0/14 guards prevent miscounting today |
| C2-F4 | `registerHooks` module-resolution hook never unregistered (process-lifetime) | low | — | Acceptable for single-run CLI; scope before long-lived/multi-cohort realms |
| C2-F5 | Provider tuple closes over module-scope mutable harness state | low-medium | 01:437 | The per-actor `packages/midnight-client` assembly is unbuilt, consistent with 0/6 |
| C2-F6/F7 | Error classification walks Effect internals; evidence parsers coupled to node-1.0.0 log strings | low (fail-closed) | — | Re-verify on SDK/node bumps; prefer typed surfaces when exposed |
| C2-F2 | Blueprint internal inconsistency: §3.7:448 lists umbrella `/protocol` export; §6.2:964 shows the published export map lacks `/protocol` | low | 01:448 vs 01:964 | **Blueprint is read-only (owner rule)** — recorded as a doc observation; subpackage-direct imports follow the §6.2 verified map |
| C2-F3 | Roadmap R1 row still "NOT STARTED" while the manifest records BLOCKED/ONGOING with partial evidence | low | 02:188 vs PROGRESS_MANIFEST:3 | Docs-side status refresh is the owner's call |
| C1-F3 | Blueprint §3.7:431 rationale "no Milo contract/client application exists yet" is stale (the contract exists with generated-runtime evidence); the 0/6 and 0/14 status itself stays accurate | low | 01:431 | Blueprint read-only — recorded; rows remain open pending real network/provider execution |
| C1-F4 | Currency fixed to USD at artifact build time | low (accepted) | 01:556, 01:44 | Reviewed artifact policy for v1; a second currency = new artifacts + admission per 01 §1.6 |
| C4-F3 | Vendor/network naming in the diagnostic page heading | low (accepted) | 04:35 | Acceptable on a self-declared diagnostic surface; drift only if it migrates into order-flow headings |

## Verified-aligned highlights (no drift — do not touch)

- **Claim discipline:** every sampled receipt carries explicit `0/6`, `0/14`, R0 and synthetic-vs-real flags; no quiet overclaim found anywhere.
- **Contract:** all 12 §4.2 transitions implemented and test-covered; approve/submit-once/dispute/resolve/timeout preconditions enforced; typed fixed-order `persistentHash` encoding with regression vectors; integer minor units; buyer-limit witness never exposed to the merchant flow; disclosure canary proves the compiler rejects undisclosed secret writes.
- **Observation discipline:** `SucceedEntirely` + expected-state re-observation required before "confirmed" across bootstrap, maintenance, recovery and the Lace transport; submitted is never rendered as confirmed.
- **Backend boundary:** no browser-writable path to membership, catalog approval, customer linking, phase or payment truth; admission/binding atomic (16-concurrency single-winner evidence); maintenance lock fail-closed; payment rules (one attempt, manual capture, provider `capture_before` + server margin, no auto-refund) honored for the implemented slice.
- **UI boundary:** auth ≠ authority negations on every surface; per-action digest-bound consent; monitor consent explicit, revocable, five-minute bounded; Lace transport swappable via injected interfaces; `/demo` import boundary test-enforced.

## Verification of this pass

Lint 0/0 · strict typecheck pass · **370 unit tests, all passing** (1,760 assertions across 24 files; this pass added dispute-matrix and Lace enumeration coverage) · build pass · Compact contract suite green (20 tests / 372 assertions, included in the unit lane).
