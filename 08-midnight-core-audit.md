# Milo — Midnight core audit and next implementation decisions

> **Evidence checkpoint · updated 7 September 2026 · R0.** Read alongside the seven planning documents, not as implemented functionality. No application code, dependency installation, wallet transaction or live service was added by this audit. **Acceptance dual-state (D2, noted after the fact):** at this audit's date the counters were **0/6 and 0/14**; they remain the *acceptance* state. Separately, *execution* later reached **14/14** order circuits on Preprod (2026-09-20, `0xb95c…e74586`). Do not collapse the two states and do not treat the later execution run as having closed this audit's acceptance rows.

**Subsequent implementation receipt:** the original contract now has [verified full compiler artifacts and generated-runtime tests](PROTOCOL_VERIFICATION.md). This does not rewrite the historical source-audit evidence below or close real network/provider gates.

## Contents

1. [Verdict and evidence boundary](#1-verdict-and-evidence-boundary)
2. [How Midnight is already at the core](#2-how-midnight-is-already-at-the-core)
3. [Add, reuse, replace or defer: net ROI](#3-add-reuse-replace-or-defer-net-roi)
4. [Red and yellow hackathon audit](#4-red-and-yellow-hackathon-audit)
5. [Next code, dependencies and services](#5-next-code-dependencies-and-services)
6. [Source receipts and unresolved evidence](#6-source-receipts-and-unresolved-evidence)

## 1. Verdict and evidence boundary

**Deepen the bilateral agreement protocol, not the integration count.** Milo's strongest Midnight-specific proposition is: **both parties act against the same privately agreed terms, and approval is bound to the exact submitted delivery, under independently enforceable role and transition rules**. Midnight should determine whether those actions are valid; Convex must not become a second source of contract authority.

The current design is substantially aligned with that proposition. Its dominant weakness is execution evidence, not a shortage of ecosystem components. A conventional signed-receipt/payment workflow is the honest product counterfactual: customer discovery must establish that independently verifiable shared rules and privacy from public observers justify wallet, proving, recovery and fee complexity. Do not assert demand merely because the cryptography is useful.

The September 7 evidence turn used the configured **Firecrawl MCP** for site mapping, developer/web search, page scraping and linked PDF/rubric extraction, with direct public-registry metadata and published-source inspection for exact package claims. Some Firecrawl bodies were September 6–7 cached snapshots; the matrix and AKINDO overview were explicitly refreshed. Kapa is documented but **was not configured or queried here**. The prior organizer API/Maven/repository-pin receipts remain dated September 6 unless explicitly updated below. No compiler, target network, Android device or EffectStream application was executed. This is a broad, targeted source audit, not an exhaustive inspection of every organization repository, historical blog, transitive package or video. Search snippets suggest questions; exact exports, source bodies and eventual execution decide compatibility.

The [blueprint](01-blueprint.md) remains canonical for protocol/privacy/packages; the [roadmap](02-roadmap.md) for readiness and release gates; the [building guide](03-building-guide.md) for execution discipline; [UI](04-ui-design.md) and [UX](05-ux-design.md) for task/consent presentation; the [backend handoff](06-backend-design.md) for jobs, files and observations; and the [video guide](07-video-design.md) for truthful media. This audit records evidence and priorities, not a parallel protocol or readiness ledger.

## 2. How Midnight is already at the core

| Layer / customer job | Planned Midnight contribution | Boundary that must remain explicit |
| --- | --- | --- |
| Agree confidential work | Salted, typed terms commitment; both parties receive the same canonical opening | Commitments do not encrypt Convex records or make the platform/payment processor blind |
| Buyer reserves / merchant accepts | Separate secret-derived role commitments and in-circuit terms, amount-bound, phase and revision checks | App login and a wallet address are not an order capability. The buyer's self-declared limit is not funds or employer-approved spending authority |
| Deliver exactly identified work | Merchant commits the immutable three-file manifest identity | Application logic checks bytes, type, count and digests. Compact does not download images or assess quality |
| Approve or dispute | Buyer approval binds the submitted commitment; eligible dispute and precommitted operator resolution follow the contract | A human decides quality and the permitted full outcome. No model or support account acquires that authority |
| Handle inaction | Public-input block-time expiry/escalation predicates and race rejection | A funded, capable caller must submit; wall-clock UI countdowns and crons do not mutate the chain |
| Recover interrupted work | Actor-local private state, retained openings and transaction identities; independent public observations | Losing an actor capability is not fixed by email login, Convex restore or a permanent archive |
| Observe and pay | Verify the admitted contract/artifacts and actual transaction outcome before downstream effects | Proof success, broadcast, indexer projection and Stripe capture are distinct facts. Midnight does not force fiat settlement |

The actual integration path is the [six-provider tuple and fourteen operations](01-blueprint.md#37-midnight-integration-coverage-contract): actor-local private state → current public context → matching ZK artifacts → trusted proving → wallet balancing → submission and observed outcome. Generate types from the compiled contract; do not create a generic backend signer that collapses these boundaries.

**Bilateral wording correction for implementation:** a merchant offer and buyer reservation are not yet mutual acceptance of the work. `ACCEPTED` is the first state in which the merchant has also committed through its role action. Explain that the external hold can precede acceptance, show merchant-decline/cancellation consequences, and prove the hold's safe reconciliation. No extra merchant-attestation service is required merely to rename this stage honestly.

**Strengthen existing records rather than adding infrastructure:**

- Scope actor-local state to network, actor/wallet context, order and canonical contract address after admission; predeployment nonce state must migrate/bind explicitly rather than masquerade as an address. Test wrong-network/actor and clean-profile restore.
- Make the existing admission record carry source/compiler/artifact and verifier-key fingerprints plus the verified maintenance policy. A deployed or compiling contract is not necessarily the reviewed immutable contract. Do not invent a maintenance-disable API.
- Make existing operation/observation records retain transaction identity, expected address/revision, actual outcome, observed block/position where supported, endpoint, freshness and artifact fingerprint. An ambiguous broadcast retains its identity/opening; it does not silently retry as a new successful order action.
- Use independently random role secrets and domain-separated commitments, not `ownPublicKey()` as wallet authentication: the [security guide][security] identifies the latter as prover-controlled. A remote prover that receives the witness is an explicit trust recipient, not a harmless transport.
- Turn the existing B-07 inspection into a falsifiable disclosure report across ledger/indexer, URLs, logs, receipts and captured media. Absolute deadlines, action timing and linked commitments can still correlate activity. `disclose()` acknowledges potential publication; it is not encryption or an arbitrary selective-proof API [disclosure].

## 3. Add, reuse, replace or defer: net ROI

Here **net ROI is qualitative engineering judgment**: useful customer/protocol evidence minus integration work, dependency/runtime/service surface, privacy/custody exposure, operational cost and maintenance. No percentage saving, benchmark or financial return has been measured.

| Candidate | Source-backed fit and cost | Decision / marginal ROI now | Evidence that changes the decision |
| --- | --- | --- | --- |
| Native Compact + generated Midnight.js providers | Directly enforces Milo's bilateral roles, commitments and transitions; already the selected responsibility | **Implement/reuse: high positive.** Replace mock/application-authoritative transitions with actual generated circuit calls, not the backend itself | Compile, fixed vectors, real local proof/submission/observation, wrong-role/terms and race rejection |
| Admission, private-state scoping and operation receipts | Makes existing trust boundaries independently inspectable; fits current order/observation records | **Strengthen: high positive.** No extra API/database service | Rejected forged deployment, maintenance attempt, stale/fallible transaction and interrupted restore |
| Official local-dev and testkit | Reproducible real network evidence and fault scenarios instead of mock-only progress | **Use in isolated development cohort: high positive.** Docker/local node/indexer/prover are test infrastructure, not a second product backend | Fresh setup, exact images/digests, funding, reset and successful adverse-case run |
| Kapa / Midnight Expert | Current-source discovery and compiler-oriented development help; Expert is a Claude Code plugin suite | **Development-only reuse: positive when available.** Neither belongs in Milo's runtime, permission model or package count | Client compatibility, reviewed/pinned source and actual compile/test evidence; never accept generated advice as proof [expert] |
| RPS sample | Useful end-to-end wiring and commitment/phase examples; old compiler/SDK cohort, gameplay-specific enrollment/reveal | **Reuse concepts/tests, not the application: positive narrowly, negative as a fork.** Public move reveal and missing timeout/payment/dispute paths do not fit private commercial terms | Independently authored Milo contract, current-cohort vectors, rejection/liveness cases and retained upstream notices [rps] |
| EffectStream full engine / Convex replacement | Real multi-chain synchronization, projection and batching; current template adds Fastify, database and long-lived sync/batcher surfaces | **Defer replacement: negative for the present single-chain workflow.** It does not supply Milo's Privy membership, protected files, Stripe reconciliation or reactive authorization policy | A demonstrated multi-chain/observation requirement; equivalent auth/file/payment tests; measured total operations and an approved free deployment fit [effect-template] |
| EffectStream observer-only experiment | Official guide documents a hosted-indexer reader with Bun/PGLite and no local node/prover; published `node-sdk@0.104.0` has the documented entry functions | **Conditional later, smaller than the full template.** Still adds a persistent derived-state service and database; no replacement authority | First demonstrate a bounded-observer gap, then test Milo's generated decoder, ordering, replay, durable restart/cursors, source freshness, privacy, service allowance and total operating cost [effect-reader][effect-package] |
| Kuira Android SDK | Published native local proving and embedded wallet/passkey identity; alpha APIs and a separate Android/recovery/identity channel | **Defer from web MVP; meaningful later mobile experiment.** Not an automatic Privy or browser-wallet replacement | Exact cohort emulator/device proof, account binding, PRF/assetlinks failure, sync/funding, clean restore and no secret upload [kuira] |
| DUST sponsorship | Native separation of action authority and fee payer can reduce token-onboarding burden | **First optional upcoming phase after the funded baseline and B-09**, under B-10; before archive/decoration. Not enabled, mandatory for core readiness, free capacity, or proved conversion benefit | Admitted payload/expiry, tamper/replay/ambiguity, depletion, actual per-action funding and explicit consent; preserve blocked/recoverable state with no hidden user-paid fallback [sponsor] |
| Zswap / offer files | Native shielded token offers and atomic swaps are real protocol concepts; blog connects offer discovery with EffectStream | **Defer as a separate settlement design.** Asset-for-asset atomicity does not prove delivery of off-chain creative work or replace Stripe fiat semantics | Actual supported asset/network/wallet cohort, refund/dispute/custody/legal design and customer need; test complete settlement lifecycle, not only matched balances [zswap][ecosystem-blog] |
| Purpose-limited selective-proof receipts / issued business authority | Could prove an agreed predicate without opening the entire terms bundle; an issuer-backed limit would be stronger than a buyer's self-declared number | **Promising core expansion, not v1 capability.** Requires new claim/issuer/verifier, consent, freshness/replay and recovery design | A real recipient/job, versioned commitment/proof schema and executed verifier canary; do not promise field-level disclosure from today's bundle commitment |
| OpenZeppelin Compact authority modules | Potential reviewed patterns, but a library cannot remove issuer/role/recovery design or guarantee an audited composition | **Evaluate narrowly, not mandatory.** Avoid generic roles/trees/nullifiers for only three fixed parties | Exact current release/license/cohort, smaller auditable implementation and negative tests; no security claim from branding |
| 0G review, Pi, Cascade, heavy 3D and launch renderer | Respectively advisory inference, coding harness, public archive and presentation—not bilateral protocol correctness | **Retain deferred gates.** No new package/service now; core evidence has greater marginal value | Existing free-budget/privacy/quality, B-08 or post-MVP media gates; no substitution for Compact, workflow or payment evidence |

### Findings that prevent misleading reuse

**RPS:** the inspected contract has waiting/committed/finished gameplay, commitments and later public reveals; no stake/payout, dispute, timeout or cancellation mechanism. Withholding a reveal can stall play. Its README uses “settlement” for recording the winner, not a payment. Do not inherit that language or lifecycle for Milo. The source's root MIT and package-level Apache declarations require file-level provenance review before copying; neither license settles competition originality.

**EffectStream:** distinguish the September 6 V2-template inspection from the September 7 official minimal-reader evidence. The template joins public EVM ownership and deliberately disclosed Midnight properties, not atomic cross-chain execution. The smaller reader uses a hosted Midnight indexer, Bun and PGLite; it needs no local node/prover or wallet merely to read. Exact `node-sdk@0.104.0` source exposes `runNode`, `midnightContract` and `pglite`; its 13 declared dependencies include 12 EffectStream packages plus **Effection**. Its exports are Bun-conditioned, not a browser/Convex replacement. One direct declaration is not one resolved package or zero operations [effect-reader][effect-package].

The reader's simple decoder is positional, cannot express structs/vectors/enums and may fail before later fields; use the documented generated-decoder alternative only after verifying Milo's actual layout. Do not change the protocol or disclose extra values to fit an indexer. `pglite()` defaults to `memory://`; persist a data directory and prove restart/replay, rather than copying a latest-only in-memory example. Confirmation delay affects payment freshness. Keep decoded-state logs allowlisted. The minimal `0.104.0` cohort and historical template `0.200.x` cohort are separate candidates, not interchangeable upgrade numbers.

**Kuira:** `dapp-ui:0.1.0-alpha05` is one direct Gradle declaration exposing a multi-module graph, not a one-dependency system. The public repository warns against production use; SDK source remains in a private repository while Kotlin sources/binaries are published through Maven. Local proving uses native code, not the connector WebView. The [published security page][kuira-security] documents optional biometric-gated recovery-phrase export; losing passkey, backup and an unexported phrase can still lose the wallet. Wallet restoration does not restore Milo order capabilities or Convex files. That page also identifies proving-key distribution and unlocked-session risks. Signed artifacts/source availability do not prove reproducible native builds, an audit, or Milo compatibility. Follow the working published security page: the previously assumed `docs/SECURITY.md` URL returned 404.

### September 7 before/after dependency decisions

| Before / claim under review | Evidence-backed specification after this turn | Marginal ROI and limit |
| --- | --- | --- |
| Use umbrella `midnight-js/protocol` without another direct declaration | Exact `midnight-js@4.1.1` export map and root `.d.mts` contain no protocol export. Declare `midnight-js-protocol@4.1.1` when importing its supported subpaths [umbrella-package][protocol-package] | **High correctness value**, even though a direct declaration may increase. Fix an unsupported import, not the counter |
| Install core SDK subpackages separately by habit | Umbrella `/contracts`, `/network-id`, `/types`, `/utils` are actual exports; choose them when the workspace uses several, rather than declaring both styles | **Potentially fewer direct declarations**; underlying packages remain transitive. No measured byte/install reduction |
| One wallet barrel means compatible interchangeable namespaces | Both dashed and no-dash `1.2.0` barrels publish exports, but re-export differently scoped families; testkit `4.1.1` still depends on dashed `1.1.0` [wallet-dashed][wallet-current][testkit-package] | Isolate testkit/headless tools; no scope rename, global override or cross-version live object sharing. Resolve peer/runtime identity before selecting a different cohort |
| Install every auth/wallet/payment-related peer | Convex Auth0/Clerk, Privy other-chain and Browser Use x402 peers are optional in the exact selected metadata | Omit unneeded direct integrations for custom JWT/auth-only/API-key paths; audit resolved graph before claiming savings |
| Avoid all experimental versions, or always choose highest tag | Permit exact experimental candidates with export/peer/runtime/license/privacy evidence, an equivalent failure suite and explicit rollback | Experimentation is allowed; source availability or a newer version is not proof of lower cost or safety |
| Preview/Preprod rows explain all network disagreement | Existing blueprint already separated them. Refreshed matrix retains those rows; August report still claims `2.1.0-beta.1` for Preprod/Mainnet [network-blog] | Correct the earlier conversational overstatement. Specific announcement/matrix discrepancy and live endpoint test remain open |
| Automatic delayed capture could prevent expired holds | Stripe may capture before expiry without Milo approval; retain explicit manual capture and actual `capture_before` [stripe-hold] | **High semantic value**; approved/unpaid incidents remain possible, visible and independently reconciled |

The ten selected product/QA releases were re-fetched by exact version with license/peer metadata on September 7; they remain source-available candidates, not an installed compatibility set. React DOM `19.2.8` requires React `^19.2.8`, stricter than the router's `>=19.2.7`. Keep the pair. Convex native custom-JWT supports ES256 and audience checking; keep the application ID and token-refresh evidence rather than adding an unnecessary server auth SDK [convex-jwt]. The blueprint remains the only full package matrix.

**ROI measurement contract:** each optional candidate names a customer job, unchanged safety requirements, baseline/candidate environment and owner. Record direct declarations by cohort, unique resolved versions, browser bytes, services, build/test effort, proof/confirmation latency, failed/recovered actions, support minutes and cost per completed order. First prove equivalent required behavior; then compare net benefit after recurring operations and maintenance. With no baseline application or customer measurements, all ROI here is directional judgment. Not every state or add-on can honestly have positive ROI; delete/defer scope rather than assert a universal benefit.

## 4. Red and yellow hackathon audit

Severity: 🔴 **RED** blocks the affected eligibility, technical or release claim; 🟡 **YELLOW** requires bounded evidence or a scope decision. Documentation fixes below do not change any runtime coverage counter.

**RED** blocks a truthful readiness, safety or submission claim. **YELLOW** is a material product/ROI risk needing evidence; it does not mean the technology is impossible or Milo's concept is invalid. No score is inferred from documentation.

| Status / Milo task | Problem or drift | Required correction / next evidence |
| --- | --- | --- |
| **RED — M-01–M-03: real local execution remains open** | The original Milo contract now compiles with full artifacts and meaningful role/terms tests; no transaction proof/submission/observation or admission/maintenance evidence exists | Preserve the [compiler receipt](PROTOCOL_VERIFICATION.md), then prove the real local pipeline; do not close M-01–M-03 or claim submission acceptance from compilation |
| **RED — M-04/M-09: integration and QA** | Six provider slots and fourteen operation specifications are not fourteen passing operations | Independent actors; wrong-role/terms/digest, replay/races, deadline boundaries and ambiguous-submit recovery with exact stage-of-failure evidence |
| **RED — schedule and scoring** | Attachments, linked PDF, detailed rubric and live platform disagree | Obtain written organizer confirmation; keep safe development moving, but make no eligibility or score guarantee |
| **RED — M-05/B-09: identity and recovery** | App authentication does not prove actor authority, wallet compatibility or restoration | One named Privy/wallet/network/prover profile; account/network invalidation and clean-profile restore; keep unsupported consumer paths blocked |
| **RED — M-07/B-06: payment** | “Escrow,” guaranteed payout or chain settlement would overstate the external Stripe/operator model | Separate observed approval and capture; show decline, hold expiry, capture/void race and approved-but-unpaid handling |
| **RED — admission/maintenance** | A malicious or mutable deployment could contradict the advertised immutable agreement | Inspect admitted verifier/artifact/maintenance configuration before reserve; reject unapproved updates and cloned/noncanonical admission |
| **RED — M-06: file availability** | A commitment proves identity, not future access or an adequate retention policy | Verify downloaded bytes; approve retention/export/deletion and restore policy before real orders. Say “exact files reviewed,” not guaranteed permanent hosting |
| **RED — M-12: submission package** | Planning references do not establish a reproducible public submission, license, repository label, deck or executed demo | Add actual README/setup, appropriate Apache-2.0 coverage and notices, verify public visibility/`midnightntwrk` requirement, release SHA and human submission |
| **YELLOW — bilateral wording** | Reservation/payment hold can be mistaken for merchant acceptance | Label the merchant offer and buyer reservation accurately; `ACCEPTED` is mutual work commitment; test buyer comprehension and decline recovery |
| **YELLOW — public privacy evidence** | Salted commitments still reveal timing, deadlines and possible correlations; hosted parties see their permitted data | Public-observer/recipient trace and real leak-negative tests; add any optional inference recipient to the disclosure inventory before activation |
| **YELLOW — seven contexts/twenty cases** | Breadth could disguise one unvalidated three-image/no-revision capability | Implement UC-01, then demonstrate UC-13 reuse. Interview for normal revision/source-file/duration needs before broadening or claiming market coverage |
| **YELLOW — free tier and commercial economics** | Free frontend hosting does not fund proof capacity, DUST, support, disputes, private storage or inference | Record recurring allowances and active-order reserve; measure support/cost per completed order; no paid fallback or no-token promise without evidence |
| **YELLOW — M-10/M-13/M-14 and agent work** | Visual polish, archive, mobile, multi-chain and agents can displace functional engineering/QA | Keep only specifications and stop conditions until the core works; technical walkthrough before launch film or ecosystem feature tour |

### The attached judging material, checked against current sources

The directly fetched [organizer API][program-api] currently lists **Engineering 40, QA 15, Product 15, UX 15, Communication 10, Business 5**. The [linked detailed rubric][rubric] instead allocates **Product 20, Backend 20, Frontend 15, QA 15, Communication 15, Business 15**. Its five 0–5 items per domain have a raw maximum of 25 with no stated normalization to 20 or 15. These are not interchangeable categories; do not fabricate a conversion or optimize against an assumed combined score.

The September 6 API receipt recorded an active-wave deadline of **2026-09-16 15:00 UTC = September 17 00:00 JST**; it is not a new live countdown. The refreshed September 7 overview lists Aug 27–Sep 16, Sep 27–Oct 17 and Oct 27–Nov 16 build periods and explicitly says the Official Rules prevail. The PDF snapshot retrieved through Firecrawl still lists a September 2 Wave-1 end and conflicting overall dates/originality wording. The overview allows materially new Midnight work on existing code; the earlier PDF review also identified net-new-from-August-5 language. Retain source dates, exact timezone and precedence uncertainty; written organizer clarification remains necessary. Do not resolve it by normalizing dates or assuming the API supersedes the PDF.

Both the [live overview][program] and supplied material prioritize meaningful Midnight functionality and a successfully compiling Compact contract, not maximum integration count. The overview lists EffectStream and Kuira as resources, not mandatory dependencies. Compact is a separate TypeScript-inspired language; “contracts written in TypeScript” in introductory material is shorthand, not an implementation instruction. Newly developed Midnight-related evaluation code must meet the applicable Apache-2.0 requirement; do not relicense third-party code merely by adding a root license.

## 5. Next code, dependencies and services

| Order / existing tasks | Build next | Dependency/service decision | Evidence before advancing |
| --- | --- | --- | --- |
| 1 — M-01–M-03 | Own minimal Compact order, role/terms encodings, generated adapters and negative vectors | Preserve the blueprint's matrix-compatible protocol cohort; exact lockfile, source/license receipts and reproducible local tooling. No sample-project mass install | Compiler success, artifacts/fingerprints, domain/encoding round trips; do not call source-reading a compatibility test |
| 2 — M-04/M-05/M-09 | Admitted deploy/reserve/accept/submit/approve plus branch-specific cancel/dispute/timeout cases; isolated actor stores and immutable operation identity | Supported local-dev node/indexer/prover and testkit in an isolated development cohort; real browser wallet path next | Real prove/submit/observe, role denial, maintenance/admission, interrupted restart and recovery; preserve all MID-P/MID-T identifiers |
| 3 — M-06–M-08/B-03/B-06 | One UC-01 interface with authenticated files, one app sign-in and separately observed sandbox payment | Existing selected web/Convex/Privy/Stripe packages only as the slice needs them; no second API/database, generic agent framework or custody service | End-to-end merchant/buyer tasks, privacy trace, actual test-adapter failures, readable pending/rejected states |
| 4 — B-09/B-11 and UC-13; optional B-10 afterward | Prove reuse and wallet comprehension; retain bounded sponsorship as the first eligible optional next phase | Existing free-tier/asset/account-budget canaries first; no mainnet funding, paid plans or automatic top-up | Same machinery supports UC-13; measured proof/fee/onboarding/recovery behavior; no silent alternative recipient or payer; core completion does not require sponsorship |
| 5 — explicitly gated extensions | Select one evidenced need: mobile local proving, observation scale, purpose-limited receipt, or revised capability profile | Separate scoped experiment/ADR; compare against keeping current design before adding/replacing anything | Measured benefit, current source/cohort/license, privacy/authority model, full enabled costs and rollback preserving active orders |

Do not activate 0G/Pi, EffectStream, Kuira, Cascade or a new settlement rail merely because this audit names them. Free local/testnet evidence is not a deployment SLA or real-money approval. If a capability cannot run within verified resources, record the block rather than quietly purchasing capacity or weakening its test. Readiness advances only with the roadmap's existing evidence, not this checkpoint.

## 6. Source receipts and unresolved evidence

Historical repository pins below identify source inspected **6 September 2026**. The updated entries and before/after decisions identify **September 7** evidence; some retrieved documentation/PDF bodies remain September 6 cached snapshots. No listed version is an installed dependency, executed API or security endorsement. Exact npm endpoints expose `dist.integrity` and export/dependency metadata; retain tarball/lockfile integrity when implementation begins.

| Source | Dated/pinned observation | What it establishes, not a canary claim |
| --- | --- | --- |
| [Official support matrix][matrix] | Refreshed September 7: compiler `0.31.1`, runtime `0.16.0`, Midnight.js/testkit `4.1.1`, connector `4.0.1`, Wallet SDK `1.2.0`; Preview **midnight-node** `1.0.1`/indexer `4.3.5`; Preprod/Mainnet **midnight-node** `1.0.2`/indexer `4.3.3-hotfix`; prover `8.1.0` | Reconfirms the existing network rows, not target-endpoint execution. These are network-binary versions, **not** Node.js (`24.20.0` LTS is the engineering runtime; the local disposable lane uses `midnight-node 1.0.0`). August `2.1.0-beta.1` announcement mismatch remains |
| [Umbrella][umbrella-package], [protocol][protocol-package], [wallet families][wallet-current] and [testkit][testkit-package] | September 7 exact metadata; umbrella root and both wallet root declarations inspected from public tarballs without execution | Corrects unsupported umbrella `/protocol`; scoped wallet families and testkit mismatch are not erased by barrels |
| [Minimal EffectStream reader][effect-reader] and [package][effect-package] | September 7: exact `0.104.0`, `(MIT OR Apache-2.0)`, Bun export condition; `src/mod.ts` and `src/single-file.ts` inspected; 13 declared dependency edges | Confirms source API and default in-memory storage, not runtime success or whole-graph counts; separate from V2 template below |
| [Midnight local-dev source][local-dev] | `902561ddc27a4b096f19835ab1528f38ace515f1`; Apache-2.0 | Candidate reproducible local infrastructure, not infrastructure booted here |
| [RPS source][rps] | `8361ab95fedf659c3216c80e85634566a2e90b0b`; README compiler `0.30.0`, language `0.22`, source Midnight.js `4.0.4`, proof image `8.0.3` | Older, separate cohort; root MIT/package Apache declarations require review before reuse |
| [EffectStream source][effect-template] | `ea04ff7c16dab5118d4bdfeec6e7455c89981827`, `v-next`; root `0.200.5`, selected template package cohort `0.200.1`; Apache-2.0 | Current Bun/Effection template, not historical Deno assumptions; counts/requirements depend on the selected subset |
| [Kuira source/docs][kuira] and [Maven metadata][kuira-maven] | `9acb407ca2b8c95fe8a37999ece85b94a219d0bd`; published `0.1.0-alpha05`; Apache-2.0 | Documented Android/native alpha; published source artifacts are not a public reproducible SDK build repository |
| [Midnight docs migration][expert] | June 25 article; Kapa remote knowledge service and Midnight Expert Claude Code plugins | Development-tool separation, not runtime/security functionality or a claim those tools ran here |
| [June ecosystem report][ecosystem-blog] and [Zswap concept][zswap] | Offer-file/atomic-settlement narrative checked against native offer/input/output model | Real research direction; conceptual and marketing statements do not prove creative-delivery atomicity, fiat parity or a supported production cohort |

**Still open:** organizer schedule/weight/originality clarification; compilation and all actual provider/operation results; exact target-network version drift; maintenance locking; consumer wallet/prover/recovery; Privy bridge; per-order deployment/proof cost; private-file retention; account allowances and sponsorship capacity; customer need and economics; every proposed extension's execution benchmark. Update the canonical decision only when its named evidence changes.

[security]: https://docs.midnight.network/guides/security-best-practices
[disclosure]: https://docs.midnight.network/compact/reference/explicit-disclosure
[expert]: https://docs.midnight.network/blog/migrating-to-kapa-and-midnight-expert
[matrix]: https://docs.midnight.network/relnotes/support-matrix
[local-dev]: https://github.com/midnightntwrk/midnight-local-dev/tree/902561ddc27a4b096f19835ab1528f38ace515f1
[rps]: https://github.com/mashharuki/midnight-rps-sample-app/tree/8361ab95fedf659c3216c80e85634566a2e90b0b
[effect-template]: https://github.com/effectstream/effectstream/tree/ea04ff7c16dab5118d4bdfeec6e7455c89981827/templates/evm-midnight-v2
[kuira]: https://github.com/kuiralabs/kuira-sdk-android/tree/9acb407ca2b8c95fe8a37999ece85b94a219d0bd
[kuira-maven]: https://repo1.maven.org/maven2/io/github/kuiralabs/dapp-ui/maven-metadata.xml
[sponsor]: https://midnight.network/blog/dust-sponsorship-on-midnight
[zswap]: https://docs.midnight.network/concepts/how-midnight-works/zswap
[ecosystem-blog]: https://midnight.network/blog/electric-capital-report
[program-api]: https://api.akindo.io/public/wave-hacks/jaMZjqPOBsLXvjdG
[program]: https://app.akindo.io/wave-hacks/jaMZjqPOBsLXvjdG?tab=overview
[rules]: https://drive.google.com/file/d/1YKXtsw5nghcEBEW0BFrLn-U34AfH_MF4/view
[rubric]: https://docs.google.com/document/d/1-dDTqWa2CcfnSEvgXq83La2M8zAxi4jtVtKpMJRm3Oo/edit
[effect-reader]: https://docs.midnight.network/guides/index-state-with-effectstream
[effect-package]: https://registry.npmjs.org/@effectstream/node-sdk/0.104.0
[umbrella-package]: https://registry.npmjs.org/@midnight-ntwrk/midnight-js/4.1.1
[protocol-package]: https://registry.npmjs.org/@midnight-ntwrk/midnight-js-protocol/4.1.1
[wallet-dashed]: https://registry.npmjs.org/@midnight-ntwrk/wallet-sdk/1.2.0
[wallet-current]: https://registry.npmjs.org/@midnightntwrk/wallet-sdk/1.2.0
[testkit-package]: https://registry.npmjs.org/@midnight-ntwrk/testkit-js/4.1.1
[kuira-security]: https://kuiralabs.github.io/kuira-sdk-android/security/
[network-blog]: https://midnight.network/blog/state-of-the-network-august-2026
[stripe-hold]: https://docs.stripe.com/payments/place-a-hold-on-a-payment-method
[convex-jwt]: https://docs.convex.dev/auth/advanced/custom-jwt
