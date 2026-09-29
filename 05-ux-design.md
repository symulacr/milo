# Milo — UX journeys, consent and service design

> **R0 service specification · 7 September 2026 · not tested behavior.**
> This document defines what people need to understand and how work passes between them. It does not certify usability, legal compliance, accessibility, market demand or live-payment readiness.

## Contents

1. [Ownership and experience contract](#1-ownership-and-experience-contract)
2. [People, entry points and service responsibilities](#2-people-entry-points-and-service-responsibilities)
3. [Discovery to an invited order](#3-discovery-to-an-invited-order)
4. [Preparation and deliberate commitment](#4-preparation-and-deliberate-commitment)
5. [Work, review and resolution](#5-work-review-and-resolution)
6. [Interruption, recovery and support](#6-interruption-recovery-and-support)
7. [Content, access and inclusive interaction](#7-content-access-and-inclusive-interaction)
8. [Measurement without surveillance](#8-measurement-without-surveillance)
9. [Scenario coverage and review](#9-scenario-coverage-and-review)
10. [Unresolved service decisions and maintenance](#10-unresolved-service-decisions-and-maintenance)

## 1. Ownership and experience contract

The [blueprint](01-blueprint.md) owns protocol states, authority, privacy, packages and budgets. The [UI specification](04-ui-design.md) owns routes, tokens, page anatomy, source receipts and visual interactions. The [roadmap](02-roadmap.md) owns all readiness/gate results. The [building guide](03-building-guide.md) owns engineering and human/agent change control. Read the affected section, not every document before every task.

The [backend handoff](06-backend-design.md) maps these service expectations to canonical records, authorization, observation, files and operational recovery. It does not create an additional account, private-state backup service or source of chain/payment truth.

This guide owns **cross-page intent, participant handoffs, consent, service failure and comprehension**. It does not create a second state machine. Use the canonical [order protocol](01-blueprint.md#42-state-machine) and [payment model](01-blueprint.md#51-two-independent-state-machines) independently. A local step, visited image or completed animation never changes either authority.

Success is a person commissioning agreed creative work, knowing who sees the brief, reviewing the exact submitted files, and understanding the consequences of approval or dispute. The [seven service contexts](01-blueprint.md#14-seven-service-contexts) reuse the same three-image capability profile and lifecycle; template coverage is not evidence of market fit. The buyer, merchant and precommitted operator remain distinct actors even if one person tests all roles with isolated fixtures. Milo is not an autonomous purchasing assistant, open marketplace or general chat product.

## 2. People, entry points and service responsibilities

| Person | Entry and job | What Milo must establish | What it must not assume |
| --- | --- | --- | --- |
| Prospective merchant | Landing/sample → pilot enquiry | Fixed-service fit, invitation process, setup/support expectations | Enquiry means accepted merchant or ability to collect live money |
| Invited buyer | Protected quote link | Merchant/scope, membership, amount/rights/deadlines, recovery and payment conditions | Knowing the URL or passing OTP grants circuit authority |
| Invited merchant | Merchant queue/quote form | Screened account, agreed operator, quote and actor-owned capability preparation | A display name proves legal identity or a reusable master secret is appropriate |
| Dispute operator | Authorized exception queue | Precommitted role, evidence access, bounded full resolution and support responsibility | Admin login can forge capabilities, recover lost secrets or edit chain phase |
| Returning participant | Order/deep link/account | Current identity, membership, context and observed outcome | An old session, tab or cached green badge is fresh authorization |
| Maintainer/agent | Scoped implementation or incident task | Approved environment, exact revision, synthetic fixtures and evidence | Code-writing access authorizes spending, production access or public disclosure |

These are service roles, not a new role-management product. One person may legitimately hold multiple app memberships, but every order action uses the correct independently authorized role. Navigation shows only permitted tasks; the backend and circuit independently enforce authority. Never offer “switch to merchant” as a privilege-escalation control.

The blueprint separately defines `disputeOperator`, `financeOperator` and `archivePublisher` authority. A person's support/finance job does not supply the committed dispute capability or archive signer. The UI may share a shell, not permission; explicit dual-role assignments remain auditable.

Before a merchant issues a usable quote, the supported process must supply the merchant/operator commitments, invite binding, deadlines and recovery readiness required by the blueprint. An unfinished operator setup cannot be papered over with a placeholder account. The operator's availability and evidence-review responsibility must be agreed before purchase, not discovered after a dispute.

### 2.1 Service fit before an invitation

Use the [canonical case matrix](01-blueprint.md#15-twenty-case-fit-matrix), not a second industry catalogue. The merchant chooses an applicable context and proposes a bounded offer. Confirm expected outputs, usage rights, routine revision needs, delivery/review duration and operator availability before issuing it. Explain excluded source files, video, partial acceptance and long-duration payment needs; decline an incompatible job rather than describe a three-image preview as a complete production service.

For agency subcontracting, name the agency as buyer and the freelancer as merchant. A client relationship does not grant that client access to this order, authorize sharing its confidential inputs, or make the agency's client approval a valid buyer capability. Any separate client order has its own agreement and authorization. Do not add an agency role switch or automatic cross-order approval.

## 3. Discovery to an invited order

### 3.1 The public promise

Use **Private agreements. Clear approvals.** Explain the shared commissioning workflow and the initial three-image capability, recipient boundaries and external payment responsibility before technical terminology. Public pages answer “What can I do here?”, “Is it for me?”, “What does private mean?” and “What is available today?” The [interactive sample](04-ui-design.md#44-interactive-landing-demo--the-product-inside-the-page) makes those answers tangible without an account.

The sample's success state is explanatory, never evidence that a real approval or payment occurred. It must not create a draft commercial order, store a user's uploaded brief or demand a wallet. Close and resume the landing without losing reading position. When a visitor chooses the pilot CTA, carry at most the public entry context—not simulated order identifiers as if they were real records.

Visitors may explore any of the seven synthetic contexts in the same sample shell. This demonstrates relevance, not enabled service coverage. Show the selected profile's exact limits and the actual availability label. Invited buyers arrive at their quote directly; do not force a second context choice, account or seven-way onboarding flow. A materially revised draft needs fresh consent; a newer template never changes an admitted agreement.

### 3.2 Pilot enquiry and expectations

Collect only a contact channel and concise service-fit information needed to respond. Avoid confidential creative briefs at this stage. Explain who receives the enquiry, intended use/retention, whether a response is promised, and that acceptance is not automatic. Use an honest contact link until a protected, abuse-controlled enquiry path exists; do not add a CRM or marketing automation stack for the MVP.

The product owner reviews service fit, merchant identity/arrangements and operator capacity before issuing an invitation. No public signup funnel silently activates live payments. Prices, refunds, legal terms and merchant-of-record/payment-account responsibilities require the existing release decisions; UI copy cannot settle them.

### 3.3 Invitation, sign-in and access

An invitation identifies intended access but is not a contract secret. Use a safe return destination; reject arbitrary redirect URLs. Privy handles its actual email challenge. Milo handles membership after verified Convex authentication. Unknown, expired, revoked or wrong-account access produces a non-disclosing explanation with sign-out/change-account or support guidance.

Do not automatically create another identity because a person mistyped an email. Resend and retry controls follow the provider's actual rate limits/timing. Avoid promising universal cross-device OTP or invitation behavior until tested. Once authorized, land directly on the quote/order and restore reading context; never force the marketing tour on an invited buyer.

The invitation leads to one frozen quote: merchant, scope, three-image output, rights, amount/currency, recipients, deadlines and resolution policy. A changed draft requires fresh consent; a newer template or successful OTP never alters an admitted order. Privy remains the only Milo sign-in—wallet permission and actor capability are contextual action prerequisites, not another account.

## 4. Preparation and deliberate commitment

### 4.1 Service handoff

```text
Merchant + operator        Buyer / actor-local device      Backend + authorities
-------------------        --------------------------      ---------------------
Prepare quote/roles   --->  Read scope and consequences     Verify membership
                           Prepare supported connection    No card hold yet
                           Verify own recovery kit          No secrets uploaded
                           Deliberately authorize hold ---> Hosted payment provider
                           Return and inspect status  <--- Reconcile bound payment
                           Confirm reservation intent ---> Admit/observe real chain
Observe valid order <------------------------------------- Separate phase/hold status
Accept permitted work --->  See actual acceptance            No timer-based progress
```

The diagram compresses the [canonical sequences](01-blueprint.md#35-s0--general-sequence-the-whole-order); it does not reorder or replace deployment, admission, proof or recovery gates. Each participant supplies only their own secret to their own proving path.

### 4.2 Consent moments

| Moment | Information immediately available | Positive action | Invalidated by |
| --- | --- | --- | --- |
| Prepare device | Supported wallet/network, prover recipient, fee policy and why permission is needed | Connect named supported wallet | Identity/account/network/prover changes or revoked permission |
| Verify recovery | What the kit includes/excludes, local scope, restore check and loss consequence | Create and verify actor-owned kit | Different actor/order/context or failed isolation/restore verification |
| Authorize hold | Merchant, frozen total/currency/rights, hold/capture/cancellation policy and return path | Continue to hosted payment authorization | Changed quote, unresolved old payment attempt or failed prerequisites |
| Reserve/accept | Exact bound order, terms, role, actual usable hold, costs/disclosure and deadline | Explicit phase-permitted confirmation | Stale observation, changed context/revision, expired hold or unsupported capability |
| Approve delivery | Exact immutable files/manifest, amount, recipient, finality and conditional later capture | Approve delivery | Integrity failure, changed revision/context, stale authority or unavailable role |
| Resolve dispute | Full approval or full cancellation consequence and applicable payment policy | Authorized operator confirmation | Missing evidence/authority, deadline or revision change |

Consent is neither a reusable checkbox nor an opaque token granting future discretionary spending. Do not batch unrelated permissions under “Continue.” Equally, do not demand repetitive confirmation for harmless navigation. Preserve a reviewed intent only while its material context is unchanged; consequential submission still requires fresh checks.

### 4.3 Setup and return behavior

The next blocker derives from the existing coordinator's readiness, not an independent wizard database. Keep scope visible throughout. A supported connection may be reused; an order capability is scoped. If predeployment recovery staging cannot be proved, block the hold rather than improvise a backup that cannot be restored.

Before redirecting to hosted Checkout, explain the temporary provider visit and how to return. On return, inspect the bound Session/PaymentIntent through the backend and show actual status. “Success” in a URL is not success in the UI. A closed tab or cancel redirect may still leave a hold; reconcile before retry. Recheck wallet, network and recovery readiness and request a new deliberate reservation action rather than auto-signing after redirect.

Present the canonical order phase and independent payment observation side by side; no local screen state combines them into “complete.” If an outcome is unknown, retain the operation identifier, explain that observation is pending and prevent a duplicate consequential request until reconciliation yields a safe next action.

## 5. Work, review and resolution

### 5.0 Canonical-phase service coverage

This is coverage of the authoritative [order protocol](01-blueprint.md#42-state-machine), not a second lifecycle. In every phase, display actor, deadline, observation freshness and the separate payment result/unknown state.

| Observed phase | Service handoff and safe form/task |
| --- | --- |
| `DEPLOYED` | Buyer sees that admission/reservation is unfinished; no merchant work or funded-order claim. |
| `RESERVED` | Merchant verifies the usable hold and accepts only when permitted. |
| `ACCEPTED` | Merchant prepares the bounded three-image delivery; buyer can inspect status and the agreed dispute route. |
| `SUBMITTED` | Buyer locally verifies immutable files and manifest digest, then approves or disputes; no replacement delivery. |
| `DISPUTED` | Precommitted operator reviews allowed evidence and can make only the disclosed full-resolution action. |
| `APPROVED` | Approval is observed while capture remains independently pending, captured, failed or unknown. |
| `CANCELLED` | Terminal cancellation is observed while void/refund/provider incidents remain independently visible. |

Timeout, stale indexer data and callbacks from another actor, account or tab are observation conditions, not transitions. Preserve the request identifier, discard stale callback effects after identity/wallet/network/order-context change, and re-observe before offering the next action.

### 5.1 Merchant acceptance and delivery

The merchant queue prioritizes the next valid task and deadline. Milo's acceptance workflow checks both a valid observed reservation and a separately verified usable hold with adequate remaining time. This is application policy: the circuit cannot see Stripe and a capability holder may call it outside Milo. Flag inconsistent observations rather than imply unpaid acceptance is cryptographically impossible. The buyer sees waiting/accepted only after the appropriate observation. Explain missed-acceptance and delivery deadlines through the real cancellation/timeout path, not a client countdown mutating state.

The merchant prepares the exact agreed delivery: three supported image files in `image-pack-v1`, regardless of context. Upload progress is distinct from a submitted delivery. Validate size/type/bytes and preview the immutable manifest before final submission. Partial upload failures can be repaired before submission; v1 does not silently replace a submitted image or offer revision rounds. Clearly distinguish a draft file selection from the finalized delivery version.

### 5.2 Buyer review

The buyer can inspect all images, scope and usage rights without signing. Keyboard controls and full-size/download alternatives supplement thumbnails. Digest matching establishes correspondence to the manifest, not artistic quality, safe content or copyright. A missing or mismatched file blocks ordinary approval and exposes the actual permitted dispute/support path.

Approval is deliberate; no auto-approval for image views, downloads, scroll depth or inactivity. Before confirming, show the consequential summary and preserve a visible dispute alternative. After submission, keep the exact stage and existing operation identity until observation resolves it. A rejection or ambiguous result must not restart a second transaction automatically.

The [verification/visibility explanation](04-ui-design.md#84-what-was-verified-and-who-can-see-it) answers what Midnight established and what it did not. Ask the buyer to distinguish identified files from good work, a valid approval from successful payment, and confidentiality from public observers from secrecy against every recipient. Seeing a verification panel does not mean the buyer understands it; test comprehension before the relevant rollout.

### 5.3 Dispute, cancellation and closure

The app explains the pre-agreed resolution policy and collects only authorized evidence. It is not a chat platform, AI adjudicator or partial-settlement editor. Distinguish raising a dispute from supporting a case, and reconciling a payment from resolving contract authority. The operator may perform only the committed full-resolution actions, while applicable timeouts remain separate.

`APPROVED` with capture pending/failed is not “Paid.” `CANCELLED` with void/refund pending is not “Money returned.” A passed authorization deadline is not independently observed provider expiry. The [UI payment panel](04-ui-design.md#73-payment-authorization-approaching-expiry) carries these conditions without pretending both systems are atomic. Never rush buyer approval to rescue a hold or silently create a replacement payment.

v1 permits no same-order replacement authorization. A safely resolved cancelled/failed attempt can lead to a genuinely new agreed quote, never an in-place payment or order rewrite. Approved/unpaid remains a finance/support exception. Refunds/chargebacks are separately authorized external provider incidents, not an automatic Milo refund feature; show actual observed amounts/status and preserve order history.

The receipt separates the confirmed order, submitted delivery identity and actual payment outcome. A private receipt is not the optional public synthetic evidence archive. A terminal order is not reopened by another payment authorization or a local “retry.” If a new order is the valid commercial remedy, make the new scope/consent explicit rather than recycling the old record.

### 5.4 Optional advisory review assistance

The [review-assistance boundary](01-blueprint.md#38-review-assistance-and-agent-operated-prototypes) and [model routing policy](01-blueprint.md#611-review-model-selection-and-routing) are canonical. One configured `reviewService`/`reviewLoop` supports three narrowly timed, optional roles: merchant preflight before immutable submission; buyer recommendation before the buyer personally approves or disputes; and a dispute-operator case brief before the authorized human resolves. It never becomes a conversational product, adjudicator, signer, payment actor or new order authority.

The invocation screen must disclose **before** external data leaves Milo: the requested scope; named model and provider; whether the profile is Private/TeeML or Verified/TeeTLS (not equivalent privacy claims); exact content leaving; purpose; and known retention/deletion limitations. Consent is per material context and is invalidated by a changed revision, file digest, provider/model or scope. Deterministic validation, authorization and digest inspection remain app-side; no secret, witness, key, recovery material, payment credential or real-order signature enters a model request.

Declining or skipping assistance leaves every human flow fully operable. A returned suggestion is expressly nonauthoritative and visually distinct from observed chain state, payment observations and verified file matching. On unavailable service, budget cap, timeout, injection signal, malformed response, stale revision or digest mismatch, do not display a conclusion as current: retain the human review/resolve controls, explain the condition and require a fresh eligible invocation if the participant chooses it.

The buyer still inspects the files and personally chooses approval or dispute; the operator still applies only the committed full-resolution action. No advice can call a Midnight operation, authorize a payment capture, or create an automatic payment, and no human may rely on it as independent adjudication when the same operator/provider supplied it.

Keep an authorized, minimal invocation record sufficient to explain which
configuration and revision informed a suggestion, without copying protected
content into support, analytics or the public receipt. It remains application
evidence, not a new source of contract or payment truth.

Use the [candidate routing receipt](01-blueprint.md#611-review-model-selection-and-routing), not a second model catalogue here. Derive displayed provider/model/trust labels from the admitted job policy; a missing qualified route returns the participant to human review, never to an undisclosed recipient.

## 6. Interruption, recovery and support

Recovery language remains three-part: wallet recovery restores the selected wallet; actor-capability recovery restores that actor's encrypted order-scoped Midnight private state; Convex application restore concerns authorized app records/files. They have different mechanisms and failure modes; neither a Privy session nor support can turn one into another. An authorized participant who lost only the action capability may have a read-only/status path, not invented cancellation or role-transfer authority.

| Interruption | Preserved/cleared state | Return and responsibility |
| --- | --- | --- |
| Navigation/reload before action | Save only permitted draft metadata; keep secrets in the actor-local provider | Read existing draft/status, then reconfirm consequential intent |
| Tab closes during proof or submission | Preserve safe operation/transaction identifiers; invalidate stale in-memory builders | Observe existing outcome before retry; closed browser is not cancellation |
| Session expires or identity changes | Clear protected view/unlocked context; retain only correctly scoped recoverable storage | Reauthenticate and reauthorize; never flash prior actor's data |
| Wallet/network changes | Invalidate readiness and pending local context | Explain affected order capability and supported reconnection; no automatic paid/prover fallback |
| Lost kit or new device | App membership and circuit authority remain separate | Authorized read-only/support route where allowed; email recovery cannot recreate the secret |
| Stale indexer/provider outage | Keep known source/freshness and ambiguous-operation identity | Fail closed on dependent actions; operator reconciles rather than fabricating success |
| Dispute/support delay | Actual phase, deadlines and agreed owner remain visible | Show the real timeout/cancellation eligibility; support response is not guaranteed merely by a UI label |

Cross-device handoff may use the existing non-secret order link, but never put credentials, capabilities or backup passwords in URLs/QR codes. Restoring a kit stays local and scoped; distinguish restore preview/validation from overwriting a live store. Browser storage cleared by the user is a real loss scenario, not a hidden server-sync feature.

Default notifications are in-app status derived from the chosen backend. A closed browser receives none. Before real use, either prove a named reminder/escalation channel with delivery/consent/retention rules and count its dependencies, or explicitly scope the pilot to a documented manual operating process. Do not quietly reuse an OTP service for order mail or introduce a notification platform. Delivery failure is visible to the responsible operator; a reminder never extends a contract deadline.

Support sees an allowlisted diagnostic record with source/freshness, safe IDs and error classification, not raw briefs, tokens, backup payloads or proof inputs. Show what will be shared. Access to protected evidence is authorized and auditable; a support tool cannot impersonate a buyer to finish an action. Emergencies follow the existing incident process, not an undocumented “force complete.”

## 7. Content, access and inclusive interaction

Every task region answers **what happened, what happens next, who acts, by when, and what the consequence is**. Prefer “Payment hold authorized; not captured” to a single green “Success.” Explain technical facts at the consent boundary and make detailed evidence expandable, not absent.

Use actual timestamps with timezone plus optional relative time. Announce stage changes without moving focus. Error summaries link to affected fields, retain safe input and explain whether a hold/submission may exist. Do not put irreversible consequences solely in a tooltip or toast.

Public sample, sign-in, quote, orders, receipt, merchant queue/form, operator cases, account/recovery, policies and access/error routes all follow the [page inventory](04-ui-design.md#3-navigation-and-page-inventory). No new independent wizard or duplicate account portal is needed. For each route, test loading, empty, denied, stale, error, success and interrupted return **where applicable**, with an explicit reason when a state is not applicable.

Use the blueprint's [inclusive interaction and performance criteria](01-blueprint.md#85-usability-acceptance-contract): keyboard, screen reader, paste/autofill, zoom/reflow, reduced motion, narrow screens and actual wallet prompt review. Long names, long scope text and larger amounts must wrap without hiding actions. Start with one documented language/locale profile; currency/timezone formatting follows actual data, not a hard-coded symbol. Translation or another locale needs reviewed legal/consent copy, not just translated buttons.

## 8. Measurement without surveillance

Keep the [roadmap's commercial metrics](02-roadmap.md#72-metrics-that-change-decisions) canonical. Public demo completion measures understanding/interest, not a real order, payment, revenue or activation. Record the denominator, date/build, consent basis and sample size. Report people needing assistance and misunderstanding, not only the best successful clip.

Start with moderated observation and manual aggregate counts. If instrumented later, allowlist coarse events such as `sample_opened`, `sample_step_viewed`, `pilot_enquiry_submitted` and `consent_test_completed`; they are proposed names, not an analytics API. Do not collect raw DOM, free text, order IDs, emails, wallet addresses, exact private prices, capability state or replay recordings by default. Do not connect anonymous demo activity to authenticated order activity without an explicit reviewed purpose and consent basis.

Public event ingestion would need abuse controls, payload validation and retention; it is not permission to expose a general Convex mutation. No analytics SDK, session-replay service or experimentation platform is selected. For an early copy comparison, change one framing variable and keep service/readiness disclosures fixed. Optimize qualified pilot conversations and safe task completion, not coerced clicks.

## 9. Scenario coverage and review

This matrix assigns **UX evidence**, not another implementation-readiness ledger. The roadmap records pass/fail/not-run and the exact revision. Exercise the canonical provider/operation tests separately; a sample demo cannot stand in for them.

| Scenario | Observed UX assertion | Existing acceptance owner |
| --- | --- | --- |
| Public sample and CTA | Correct sample label, accessible modal/page history, no privileged calls, honest destination | M-10 and B-11; UI/QA owners |
| Context switching and offer fit | Seven samples share one flow; changing context resets illustrated progress without focus/history traps; unsupported jobs are not admitted | M-10/B-11; product/UI/QA owners |
| Frozen template and agency boundary | An invitation preserves agreed scope/version; another context or client relationship cannot transfer membership, consent or capability | B-03/B-05/B-07; backend/protocol owners |
| Invite and wrong-account entry | No content disclosure; safe return after real auth/membership check | B-03/B-11; backend/UX owners |
| Buyer and merchant preparation | Named wallet/prover/cost; own scoped capability/recovery before consequential use | B-09; integration owner |
| Checkout return/back/interruption | Bound provider status rather than URL inference; no duplicate hold/reservation | B-06/B-09; payment/integration owners |
| Merchant accepts or declines | Valid reservation/hold shown; actual permitted cancellation path | M-04/M-07/M-08; protocol/payment/UI owners |
| Delivery partial failure and submission | Draft versus immutable version clear; exact file integrity and authorized access | B-04/B-05; backend/QA owners |
| Buyer approval, rejection and ambiguity | Intent/confirmation separated; observed order and payment status remain independent | B-05/B-06/B-09; protocol/payment owners |
| Cancellation and dispute outcomes | All canonical terminal routes display independent void/refund/reconciliation | B-05/B-06; protocol/payment/operator owners |
| Expiry, stale evidence and unavailable actor | No timer-driven phase, hidden reauthorization or impossible action; responsible next actor | B-05/B-06/B-11; operator/UX owners |
| Advisory review configurations | Consent disclosure, skip path, stale/injection/budget failure and human-only final authority are understood | B-07/B-11; privacy/UX/QA owners |
| Restore, lost capability, two tabs/devices | No cross-context state leak; usable read-only route or exact blocker | B-09/B-11; integration/UX owners |
| Private receipt and public archive boundary | Private download does not leak into a synthetic public bundle | B-07; B-08 only if enabled; security owner |
| Account revocation, support and sign-out | Protected subscriptions/actions revoked; support cannot impersonate or recover secret | B-03/B-09; backend/security owners |
| Access, performance and comprehension | Named devices/build, assistive-tech/human-wallet evidence, misunderstandings documented | B-11; UX/QA owners |

Use the blueprint's participant counts and comprehension thresholds rather than inventing a second usability gate. Capture safe before/after screens and short recordings only after an interface exists. Constructed mockups remain labeled as design proposals. Any incorrect understanding of amount, recipient, visibility, approval or payment blocks the affected consent flow until revised and retested.

Target UC-01 first and UC-13 second for the [shared-flow evidence](02-roadmap.md#44-context-coverage-and-reuse-evidence). Reuse the same assertions and record differences in context, expectations and misunderstandings, not a new suite per industry. A seven-option selector or twenty fit-matrix rows are not twenty observed customer journeys. Track ordinary revision demand and job-duration mismatch as product findings; do not optimize these away by pressuring approval or silently dropping recovery.

## 10. Unresolved service decisions and maintenance

Before the relevant rollout, the product/operator owners must settle invitation delivery/expiry rules, operator availability and escalation, supported locale/device/proving profile, reminder method, policy/retention wording and the exact authorization-expiry commercial remedy. Backend/integration owners must prove the recovery, file and authority mechanisms. These are not silently solved by a page inventory. Record decisions in the existing blueprint open-gate and roadmap evidence registers, with owner, deadline, required proof and safe blocked behavior.

Sponsorship is not a current service promise or recovery shortcut. It is an optional future experiment only after the funded baseline and B-09 wallet/capability lifecycle evidence; B-10 then requires explicit intent, expiry, capacity and ambiguity evidence. Until then, show the actual fee-path requirement or block the action—never silently substitute user payment.

Keep marketing invitations conditional on actual readiness. R3 test evidence is not R4 live approval. A consumer no-install/no-token claim needs its separate proven path; a developer-assisted wallet flow must be described as such. Fixed scope is a deliberate MVP choice, not an assertion that alternatives are technically impossible.

Prototype deployment follows the [free-tier spending boundary](01-blueprint.md#610-free-tier-deployment-and-spending-boundary): Cloudflare Pages Free, Convex Free, Privy Developer only within its eligible-free threshold, Stripe sandbox, and Midnight local/testnet only after asset/quota gates. There is no paid fallback, including Vercel Pro or R2. Browser Use advertises ten free agent tasks/month, but its account entitlement and gate remain unverified; if free capacity cannot fund the requirement, cloud QA is blocked and manual/fixture evidence cannot pretend to pass it. Promotional credits do not satisfy the policy. A model whose free allowance is unverified blocks live inference under the no-spend rule.

Surface a quota or eligibility block as an operational limitation, not a prompt
to add billing or transfer a participant to another provider.

When humans or agents change a journey, review its incoming link, outgoing handoff, abandoned/ambiguous path, data recipients and responsible actor. Update canonical policy first, then UI text and this guide, then the tests and roadmap evidence. Reuse current capabilities when they meet the invariant; allow a bounded experiment when they do not. No additional dependency or abstraction is justified solely by the desire to keep this document looking complete.
