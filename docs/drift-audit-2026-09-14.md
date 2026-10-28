# Trust-anchored drift audit — 14 September 2026

> **Audit document.** Method: original concept documentation is the source of trust; code and running UI are evidence. Every finding cites a source document and line, or is marked `UNSPECIFIED`. Baseline: commit `b5b4662` (clean tree; the platform publish path supports branches only, so the baseline is recorded by SHA instead of a `baseline/pre-refactor-2026-09-14` tag).
> Scope audited: the synthetic UI (`apps/web`), the domain simulator (`packages/domain`), and the Convex schema/backend role surface. Compact circuits, native services and integration runtime were covered by their existing receipts, not re-audited.

## 1. Source-of-trust manifest

| ID | Doc | Path | Date | Rank | Status |
|---|---|---|---|---|---|
| S1 | Blueprint (concept + constitution) | `01-blueprint.md` | rev. 7 Sep 2026 | 1–2 | authoritative |
| S2 | UI design specification | `04-ui-design.md` | 7 Sep 2026 | 3 | authoritative for routes, composition, tokens, copy |
| S3 | UX service specification | `05-ux-design.md` | R0, 7 Sep 2026 | 3 | authoritative for journeys, consent, handoffs |
| S4 | Data schema / contracts | `convex/schema.ts`, `packages/contract/src/order.compact` | — | 4 | binding shape |
| S5 | Progress manifest (phasing authority) | `PROGRESS_MANIFEST.md` | live | context | what the prototype intentionally defers |

Code (rank 5) and the running UI (rank 6) were treated as evidence. Assumptions were given zero authority.

## 2. Canonical Intent Ledger (extract)

~120 normative rows were extracted with line cites. Key load-bearing rows:

| # | Intent | Source |
|---|---|---|
| B3 | One person may hold multiple memberships; every order action uses the correct independently authorized role; navigation shows only permitted tasks | 05:40 |
| B4 | Never offer "switch to merchant" as a privilege-escalation control | 05:40 |
| D1 | `image-pack-v1`: one merchant, one fixed price, exactly three final images, one buyer, one currency, no split payouts | 01:44 |
| E2/E6 | Order state machine and 11 invariants (terminal APPROVED/CANCELLED, no auto-approval, no role replacement after reservation, …) | 01:562–615 |
| F1/F11 | Payment is an independent state machine; "APPROVED with capture pending/failed is not 'Paid'" | 01:668–676; 05:152 |
| H1/H6 | Consequences before consent; no preselected checkbox or vague "Continue" | 04:34, 04:357 |
| I1 | Single route inventory; `/app/offers`, `/app/start`, `/ops/reconciliation` superseded | 04:68–91; 01:1241 |
| J1/J2 | Allowed/prohibited privacy copy ("trustless escrow" etc. banned) | 01:179–181 |
| J5 | Prefer "Payment hold authorized; not captured" to a single green "Success" | 05:197 |
| J9 | Persistent "Synthetic sample · no wallet, payment or transaction" label on every sample surface incl. receipt | 04:148 |
| T1 | Tokens: documented palette/scale only; named CSS variables, not arbitrary per-component values; status always icon + text; disabled-state contrast checks mandatory | 04:49–58 |
| T2 | Type scale: body 16, labels 14, titles 28–40, hero 40–72; "do not shrink critical copy to make a mockup fit" | 04:56 |
| A11y | `prefers-reduced-motion`; mobile navigation is a normal accessible menu; focus never removed for polish; no hover-only information | 01:1215; 04:97, 04:58, 04:489 |

### Document-internal contradictions found

| # | Conflict | Cites | Resolution |
|---|---|---|---|
| CON-1 | CTA labels: blueprint names "Explore the demo"/"Join the merchant pilot"; UI spec mandates "Explore a sample order"/"Discuss a merchant pilot" | 01:1195 vs 04:205 | Resolved by delegation: the blueprint assigns page composition to the UI spec (01 contents; 04 §1). Code now follows 04. |
| CON-2 | Blueprint says the hero subhead "states what is private and who receives the work"; the UI-mandated subhead does not literally | 01:1195 vs 04:98 | Escalated (editorial, doc-vs-doc) — code follows 04 verbatim |
| CON-4 | "Defined review/dispute window" is invariant while 24h/12h durations are hypotheses | 01:44 | No code impact; durations remain fixture data |

### Template rules with zero rank-1–4 authority (not enforced)

Numbered-heading prohibition (**contradicted** — docs mandate numbered preparation steps, 04:250–262, 01:1199); toggleable sidebar with ⌘B; icon-only-by-default; hero-removal discretion (**contradicted**, hero copy is mandated, 04:98); i18n string externalization (docs require one documented locale only, 05:203); net-negative LOC gate (docs set byte/performance budgets instead, 01:1209–1214); role-typed public signup and seller/buyer "switch context" (**contradicted** — invite-only, capability-scoped, 01:302, 05:40, 05:60).

## 3. Drift register and reconciliation

Severity: blocker/high/medium/low. Status: fixed in this pass or escalated.

| # | Drift | Evidence (before) | Source | Severity | Status |
|---|---|---|---|---|---|
| D-01 | Reduced-motion guard lost the specificity war; image zoom/button transitions played under `prefers-reduced-motion: reduce` | styles.css:781–789 vs workspace.css:408–412 | 01:1215; 04:466–475 | high | **Fixed** (`!important` guard) |
| D-02 | Mobile navigation deleted ≤760px with no replacement menu | styles.css:496–497 | 04:97 | high | **Fixed** (links stay reachable and wrap) |
| D-03 | Payment panel: green "Sample captured" success badge; expired-hold copy off-script; failed mapped to warning | components/order.tsx | 05:197; 04:325; 05:152 | high | **Fixed** ("Payment hold authorized; not captured.", "Payment hold expired; payment unresolved.", failed→danger, captured→neutral) |
| D-04 | No `--danger` token; no danger badge variant | styles.css, workspace.css | 04:52 | medium | **Fixed** |
| D-05 | Status badges carried text only, color-only tone; order progress was color-only | components/ui.tsx, order.tsx | 04:51–52 | medium | **Fixed** (icon+text glyphs; `aria-current="step"` + ✓ on reached steps) |
| D-06 | Persistent documented sample label missing; receipt had none | shells/WorkspaceShell.tsx | 04:148 | high | **Fixed** ("Synthetic sample · no wallet, payment or transaction" in the shell banner on all workspace routes incl. receipt) |
| D-07 | Hero subhead paraphrased (dropped "creative work privately"/"clear") | index.html:22 | 04:98 | high | **Fixed** verbatim |
| D-08 | Hero object not visibly labeled "Sample order." | index.html:24–25 | 04:98 | medium | **Fixed** (visible `.sample-tag`) |
| D-09 | CTA labels off-script ("Explore the sample", "For creative studios") | PublicShell, InfoPage, index.html | 04:205 (CON-1) | medium | **Fixed** ("Explore a sample order", "Discuss a merchant pilot") |
| D-10 | File-check vocabulary ≠ documented four states | order.tsx, OrderView.tsx, model.tsx, assets.ts | 04:335 | medium | **Fixed** ("Checking file… / Matches submitted manifest / Cannot verify / File unavailable") |
| D-11 | Evidence panel raw dt labels; missing documented plain-language sections | components/order.tsx | 04:369 | medium | **Fixed** ("What was verified?" / "Who can see this?") |
| D-12 | Approval dialog title off-wireframe; no explicit back action | OrderDialog.tsx | 04:341–357 | medium | **Fixed** ("Approve this delivery?" + "Back to review") |
| D-13 | Two labels for one receipt export ("Download receipt ↓" / "Export record ↓") | Receipt.tsx, order.tsx | 04:365 + one-label-per-concept | medium | **Fixed** ("Download receipt ↓" everywhere; real-flow label "Download my private receipt" noted for when real receipts exist) |
| D-14 | "Prepare the order" ≠ documented action phrase | QuoteView.tsx | 04:246, 04:81 | low | **Fixed** ("Prepare this order") |
| D-15 | "Check before retrying" ≠ documented pending-outcome phrase | order.tsx | 04:321 | low | **Fixed** ("Outcome being checked") |
| D-16 | Deadline transition lacked documented copy | packages/domain/prototype.ts:517 | 04:319 | low | **Fixed** ("Deadline reached; awaiting the applicable action.") |
| D-17 | Sign-in page claimed Privy "planned but not connected" while a live Privy diagnostic ships | info-content.ts | 01:3 (readiness honesty) | medium | **Fixed** (honest current state) |
| D-18 | Meaningful UI text below the documented floor (badges 9px, captions 9–10px, footer 9px, dt 10px, …, ~30 declarations) | styles.css, workspace.css | 04:56, 04:50 | high | **Fixed** (floor `var(--text-micro)` = 12px; only a decorative disclosure glyph remains at 10px; residual 12-vs-14 label question escalated, E-11) |
| D-19 | Disabled buttons via blanket `opacity: 0.5` (~2:1 contrast) | styles.css:62–65 | 04:52 | medium | **Fixed** (explicit muted colors) |
| D-20 | Programmatic route focus had `outline: none` | styles.css:96–98 | 04:58 | low | **Fixed** (`:not(:focus-visible)` guard) |
| D-21 | Collapsed-sidebar links named only by hover `title` | WorkspaceShell.tsx | 04:489, 04:60 | medium | **Fixed** (`aria-label` on all nav links; redundant `title`s removed) |
| D-22 | Timeline was divs with a non-hidden decorative dot | order.tsx | 04:452 | low | **Fixed** (`ul`/`li`, `aria-hidden` dot) |
| D-23 | `--radius-frame` unused while hero frame used magic 20px; `--font-mono` unauthorized and unused; literal `#f6f3ee` duplicated `--paper` | styles.css | 04:53–55 | low | **Fixed** |
| D-24 | Receipt page was a terminal dead end | Receipt.tsx | 04:89; 04 §1 rule 5 | low | **Fixed** ("Back to the order") |
| D-25 | `.privacy-inner h2` 42px exceeded the 28–40 title band; mobile hero below 40px floor | styles.css:402, :506, :360 | 04:56 | low | **Fixed** |
| D-26 | Section-heading 42px…(folded into D-25) | — | — | — | — |
| D-27 | `/demo` renders the workspace OrderView, not the documented 4-step guided sample flow with landing-modal variant; six state-fixture scenarios ≠ documented SC-01–SC-07 sample contexts | App.tsx:35; model.tsx | 04:146–186, 04:152 | high | **Escalated** (E-1) — documented target feature, phasing decision |
| D-28 | `/connections` route absent from the spec inventory | App.tsx:83 | 04:68–91 (silent) | medium | **Escalated** (E-2) — add to rank-3 inventory or mark dev-only |
| D-29 | Sign-in lives on the diagnostics page; documented order-entry "Continue to your order" flow absent | PrivyConnection.tsx:55 | 04:217 | high | **Escalated** (E-3) — placement decision |
| D-30 | `/pilot` has no honest contact/enquiry link | info-content.ts | 04:107; 05:64 | medium | **Escalated** (E-4) — a real contact channel cannot be invented |
| D-31 | Role gates offer one-click perspective switch | gates.tsx | 05:40 | mitigated | **Reconciled, not drift** — the synthetic prototype explicitly allows one person to test all roles (05:27) and frames every switch as non-authenticating; 05:40's prohibition targets the real product. Kept with honest framing. |
| D-32 | Dual public chrome registry (static index.html + PublicShell) kept in sync by comment | index.html, PublicShell.tsx | 04:91 (partial) | low | **Escalated** (E-5); parity test `public-chrome.test.tsx` is the current control |
| D-33 | `/m/north-studio` orphan (no inbound link) | App.tsx:32 | 04:79 (discovery UNSPECIFIED) | low | **Escalated** (E-6) |
| D-34 | `BoundOrder` admits only `sample-001` | gates.tsx | 04:70 (prototype-sanctioned) | low | **Escalated** (E-7) — acceptable for the sample; real deep-link resume is product work |
| D-35 | ~50 hardcoded non-token hex values bypass the governed palette | styles.css, workspace.css | 04:53 | high | **Partially fixed** (danger/paper/form-error tokenized); **remainder escalated** (E-9) — naming the extended semantic palette is a design decision, not a mechanical fix |
| D-36 | Landing omits documented FAQ, merchant-value and closing CTA sections | index.html | 04:101–105 | medium | **Escalated** (E-10) — PROGRESS_MANIFEST phasing; reconcile, don't auto-build |
| D-37 | Em-dash "— not X" negation tic (~8×) | various | UNSPECIFIED | informational | **Escalated** (E-12); kept where load-bearing for consent distinctions |
| D-38 | Redundant `title` tooltips restating visible labels | WorkspaceShell.tsx | UNSPECIFIED (dedupe convention) | low | **Fixed** (with D-21) |
| D-39 | Sidebar toggle 32×32px target | workspace.css | UNSPECIFIED (WCAG 24px was met; template convention 44px) | low | **Fixed** (40px; no doc target size exists) |

### Compliant areas verified (no drift — do not touch)

Schema enforces `image-pack-v1` invariants by construction (`outputCount: literal(3)`, `packQuantity: literal(1)`, `serviceVersion: literal(1)` — convex/schema.ts; 01:44). Per-scope memberships match the multi-membership role model (05:40). Zero marketing-honesty violations (04:207): no urgency, stats, or "live" claims. Zero prohibited privacy claims (01:181). No AI-tell buzzwords anywhere ("delve/seamless/elevate/unlock/empower/robust/leverage" = 0 hits). Quiet machinery holds: h1s are human phase labels, identifiers live in evidence (04:35). Approval checkbox unselected by default; no countdown or vague "Continue" (04:357). OrderDialog follows the mandated WAI dialog pattern (04:185). Timestamps carry timezone (05:199). Receipt export self-labels as non-chain evidence.

## 4. Before / after

| Metric | Before | After | Δ |
|---|---|---|---|
| Baseline commit | `b5b4662` | this branch | — |
| apps/web/src LOC (excl. tests) | 5,487 | 5,536 | +49 (Badge glyph map, Progress semantics, evidence sections, receipt return link, dialog back action) |
| CSS LOC | 2,102 | 2,111 | +9 (danger variant, sample-tag, disabled states; minus purged overrides) |
| Unit tests | 340 pass / 3 fail* | 360 pass / 0 fail | +20 green |
| Lint | 0 errors, 2 warnings | 0 errors, 0 warnings | clean |
| Typecheck (strict) | pass | pass | — |
| Build | pass | pass | — |
| App bundle (gz) | 1,605,961 B | ~1,606,300 B | +~0.3 KB (glyph map) |
| Public landing | static HTML + 6,913 B gz CSS | static HTML + 6,938 B gz CSS | +25 B |
| Meaningful text below 12px | ~30 declarations (down to 8px) | 0 | −100% |
| Status surfaces color-only | 2 (badges, progress) | 0 | −100% |
| Persistent sample label on sample surfaces | partial (missing on receipt) | all workspace routes | ✓ |
| AI-tells (buzzword catalogue) | 0 | 0 | — |
| Doc-cited drifts open | 39 | 0 fixed-able remain; 12 escalated | see §5 |

\* The 3 baseline failures were environmental, not product: `packages/contract` tests require generated compiler artifacts. Running the repo's own `bun run contract:compile` (compact 0.5.1, 14 circuits verified) made the suite fully green; artifacts are gitignored.

LOC note: the template's net-negative LOC gate has no doc authority (U-7); the docs' rule is reuse-driven extraction (04:444) plus byte budgets (01:1209–1214), which this change respects (+0.3 KB gz).

### Per-flow effect

| Role | Flow | Clicks Δ | Scroll Δ | Cognitive Δ | Source |
|---|---|---|---|---|---|
| Visitor | Landing → sample | 0 | 0 | lower (documented subhead/CTAs, labeled sample object) | 04:98, 04:205 |
| Buyer | Review delivery → approve | 0 | 0 | lower (documented check vocabulary, deliberate dialog with explicit back) | 04:335, 04:341 |
| Buyer | Payment comprehension | 0 | 0 | lower (honest hold/expiry sentences, no green "Success") | 05:197, 04:325 |
| Any | Receipt | −1 dead end | 0 | lower (safe return exists) | 04:89 |
| Screen-reader/keyboard | All workspace | 0 | 0 | lower (nav names without hover, current step announced, list semantics) | 04:489, 04:52 |
| Reduced-motion user | All | 0 | 0 | motion now actually off | 01:1215 |

## 5. Open items — DECISION NEEDED (no invention)

| # | Question | Status |
|---|---|---|
| E-1 | Build the documented 4-step `/demo` guided flow + landing modal + SC-01–SC-07 context selector (04:146–186)? Phasing call; current state-fixture scenarios serve a different axis | product decision |
| E-2 | `/connections`: add to the rank-3 route inventory (04:68–91) or mark dev-only? | docs decision |
| E-3 | Move sign-in to the documented order-entry surface with "Continue to your order" (04:217)? | product decision |
| E-4 | `/pilot` honest contact link (04:107; 05:64): which channel? Cannot invent an address | product input needed |
| E-5 | Static-landing vs PublicShell chrome duplication: sanction the parity-test mechanism in 04 §3 or restructure? | docs decision |
| E-6 | `/m/:merchantSlug` discovery path is UNSPECIFIED; orphan until then | docs decision |
| E-7 | `BoundOrder` single-record sample: fine for the prototype (04:70); real deep-link resume is roadmap work | confirm |
| E-9 | Extended semantic palette for ~50 legacy hex values needs a design owner (04:53 authorizes the mechanism, not new token names) | design task |
| E-10 | Landing FAQ / merchant-value / closing CTA sections (04:101–105) vs current phasing | product decision |
| E-11 | Micro text floor: 12px token vs the 14px label rule (04:56) — current compromise floors meaningful text at 12px | design decision |
| E-12 | Em-dash negation tic thinning | editorial, optional |
| E-13 | CON-2: reconcile blueprint §7.3 subhead description with 04:98 mandated copy | docs editorial |

## 6. Midnight integration note

This wave touched UI only; the Midnight boundary was audited, not modified. No circuit/proof/DUST vocabulary appears in user-facing headings or CTAs (04:35 holds); the receipt explicitly disclaims chain evidence (matches 01:3 honesty); admission/binding and per-scope role enforcement live server-side per 01:302. Coupling, latency and swap-ability are unchanged from baseline. A13-scope deep verification remains the integration suite's job (0/6 providers, 0/14 operations per PROGRESS_MANIFEST — unchanged by this pass).

## 7. Publication discipline

Per PROGRESS_MANIFEST ("Do not merge, release, spend funds, or admit live users automatically"), this work lands as a pull request for review — no auto-merge. The template's phase-11 "final commit + merge" is superseded by that repository policy.

## Addendum — 14 September 2026 (PM): owner-approved reconciliations

Owner direction: `01-blueprint.md` is read-only; code moves toward the docs, never the reverse. Approved and landed on the stacked branch (`hoplite/phokaia-345fb552--guided-demo`):

| Item | Resolution | Evidence |
|---|---|---|
| E-1 (`/demo` guided flow + SC-01–07) | **Built per 04 §4.4** — four steps, native Sample context select, `?context=` deep links (replace; unknown → SC-01), persistent label, documented CTAs, zoom control, independent outcome panels + pending toggle. Modal-over-landing variant is vacuous: the static landing holds no in-app background location (04:150). Import boundary test enforces no provider/simulator imports. | `routes/DemoPage.tsx`, `demo-fixtures.ts`, `demo-boundary.test.tsx`; browser walkthrough of all four steps |
| E-3 (sign-in placement/label) | **Partially resolved** — action labeled "Continue to your order" (04:217); `/sign-in` describes the live diagnostic honestly. True order-entry sign-in remains roadmap work (needs real invited orders). | `PrivyConnection.tsx`, `info-content.ts` |
| E-9 (palette consolidation) | **Resolved** — 22 extended semantic tokens; remaining literals are token definitions, shadows and one-off alphas (accepted). | `styles.css`, `workspace.css` |
| E-10 (landing blocks) | **Built per 04:103–105** — merchant value as product goals, seven-item FAQ, closing sample-first/pilot-second CTA. | `index.html`, `styles.css` |

Verification after the addendum: lint 0/0, strict typecheck pass, **370/370 unit tests**, build pass, demo flow + landing blocks browser-verified. Bundle delta ≈ +3 KB gz versus the audit baseline. Still open: E-2, E-4, E-5, E-6, E-7, E-11, E-12, E-13 (unchanged).

## Addendum 2 — 15 September 2026: remaining resolutions

| Item | Resolution |
|---|---|
| E-2 (`/connections` inventory status) | **Resolved code-side** — the page now self-describes as "a development diagnostic surface, not part of the documented order flow" (rank-3 inventory edit remains the owner's docs call). |
| E-7 (`BoundOrder` single-record) | **Confirmed** — sanctioned by 04:70 (prototype sample-only views); real deep-link resume is roadmap work. |
| E-11 (12px vs 14px micro floor) | **Resolved** — 12px micro floor kept for non-critical text; status/labels carry the documented treatments. |
| E-12 (em-dash tic) | **Thinned conservatively** — three weakest instances converted to plainer punctuation; load-bearing consent/privacy/authority distinctions kept verbatim. |
| E-13 (CON-2 subhead tension) | **Reconciled at page level** — the blueprint's §7.3 requirement ("states what is private and who receives the work") is satisfied by the 04:98 subhead plus the adjacent privacy-split block (04:101) covering recipients; blueprint untouched, no silent edit. |

Still open: **E-4** (pilot contact channel — needs owner input), E-5 (chrome duplication — parity test is the standing control; restructure optional), E-6 (`/m/` discovery path — UNSPECIFIED in the docs).

## Addendum 3 — 15 September 2026: second four-critic round (framing, regression, journeys, evidence)

Four fresh critics audited the merged work and the blueprint's interface framing (§7/§8). Headline: the monolith served every public route — a §7.4 blocker — and several consent/framing gaps remained. Resolutions below; all items cite the critic findings.

**Fixed in this pass**

| Critic finding | Resolution |
|---|---|
| Framing F1 (blocker): public `/demo` + info pages shipped the Privy/Convex monolith | **Build split** — separate `public-app` entry (~78 KB gz JS vs 5.4 MB); `PageTitle` decoupled from the workspace model; reachable-source boundary test; build-time bundle inventory |
| Framing F5: hero entrance 640–720ms with opacity-0 start | 120–220ms transform-only, complete first frame (04:466–468) |
| Framing F3 + Journeys F-6: no deadline/next-actor/consequence anywhere | Persistent order status line per phase (01:1259), incl. "an unanswered review opens a dispute, never auto-approval" |
| Framing F6 + Journeys F-3: approval confirmation lacked disclosure/consequence; rank conflict on label | Disclosure row + capture consequence + in-dialog dispute alternative; label follows rank-1 "Approve delivery and request payment capture" (01:1254 over 04:353 — **doc conflict logged, escalate for 04 alignment**) |
| Journeys F-1/F-2: recovery consent moment collapsed; phantom "Acknowledge the terms" | New `verify-recovery` domain action gating the hold; three-check setup sheet with current-blocker framing (04 §5.2/§6.2) |
| Journeys F-4: one-click operator resolution | Confirmation dialog (authority, terminal full decision, payment policy) |
| Journeys F-5: merchant accept framing; no decline | Role-aware RESERVED framing with hold status; `decline` wired |
| Journeys F-7: expired hold silent block; clock unwalkable | Explanation + permitted path; sample-clock advance control in sample controls |
| Journeys F-10/F-11/F-12/F-15: scope recipients/context; submit confirmation; queue task info; transient file-check failure | Scope rows added; submit confirmation dialog; queue rows show next actor/deadline/hold; persistent failure state (04:335) |
| Framing F2/F4: landing strip lacked scope/deadline; timeline tab-hidden | Scope + deadline in the sample strip; activity visible without tab |
| Regression F1: context switch stole focus from the selector | Suppressed (04:153) — selector keeps focus |
| Regression F2/F3/F4: dead hero query params; "tested wallet profile" overclaim; Lace vendor-identity copy + late injection | Plain `/demo` href; qualified claim (compatibility evidence pending); wallet names rendered as unauthenticated metadata + reload note |
| Regression F5: token consolidation changed 14 rendered colors undocumented | Recorded here: all moves stayed inside the documented families (04:47–58); the two text-color changes (badge #5a534b→#56504a, progress #666158→#56504a) both **darken** text (contrast improved, est. >6:1 on their surfaces); `#443c32` in `.image-expand` accepted as a one-off alpha context |
| Evidence: "13 escalated" (phantom E-8); "371 → 372"; stale 19/302 counts; README `/demo` | Corrected to 12 and 370 → 372; PROGRESS_MANIFEST + PROTOCOL_VERIFICATION counts refreshed/date-stamped; README updated. (2026-09-16 adjudication, DEBT-038: the "370 → 372" unit framing was itself the conflation — unit lane is 370 tests / 1,760 assertions / 24 files; 372 is the contract suite's assertion count, 20 tests) |

**Escalated (not silently fixed)**

| Item | Reason |
|---|---|
| Doc conflict: 01:1254 label vs 04:353 wireframe label | Rank-1 applied in code; 04 needs alignment (owner/docs) |
| Journeys F-8: staged progress and interruption journeys | Large; needs a designed pending-state model, not a patch |
| Journeys F-14: progress track for DISPUTED/CANCELLED | Halted-state presentation is ambiguous in the wireframe |
| p75 LCP/INP/CLS budgets (01:1213–1214) | No lab/field harness exists; budget now plausible for the public route but unmeasured |
| 320px workspace usability | Breakpoints stop at 480px; needs a lab pass |
| `/connections` in primary nav | E-2 residual; labeled dev-diagnostic (done), placement is the docs call |

## Addendum 4 — 15 September 2026: third critic round (contract topology, cognitive load, LOC, visual)

### Contract verdict (owner's "fewer transactions / parallel contracts" question)

| Request | Verdict | Cite |
|---|---|---|
| Merge deploy+reserve into one transaction | **Prohibited** — bootstrap discipline is load-bearing for admission | 01:276 |
| Merge any §4.2 transition pair | **Prohibited** — canonical graph with distinct callers/deadlines/invariants | 01:562–616 |
| Parallel contracts per order / shared mutable order map | **Prohibited** — "one deployment per order… no shared mutable order map"; registry only via the 01:274 architecture decision | 01:272 |
| Cross-contract calls | **UNSPECIFIED** — do not introduce; §6.9 forbids pattern accumulation | — |
| Protocol minimum | **5 transactions per completed order** (deploy, reserve, accept, submit, approve); +2 dispute path; timeouts permissionless-paid | 01:562–597 |
| Honest savings paths | (a) merge the two maintenance txs (install+lock) — decision needed, closes an upgrade-trusted window; (b) circuit consolidation (timeouts→1, disputes→1) restoring a 1-tx born-locked deploy — the 01:274 architecture decision, needs the F8 per-action measurements first; (c) DUST sponsorship — gated B-10, correctly dormant | 01:274, 01:1113 |

Applied now (authorized): sim deploy step annotated as staged/multi-transaction. Deferred: bootstrap harness literals (value only with the escalated decisions). Confirmed clean: O(1) state, no maps/logs, state-minimization already compliant; ~30.8 KB per-order ledger footprint recorded as input to the 01:274 decision.

### Condensation and maintainability (fixed)

| Finding | Resolution |
|---|---|
| Blank buttons: partial `actionLabels` missing `authorize` (and `verify`) | Total `Record<Action,string>` — missing labels now fail typecheck; the `verify` miss was caught this way |
| Progress track ran one step ahead of the phase | Explicit phase→step map; current step now agrees with the status line |
| Role-blind framing: buyer-voiced h1s for all roles; dead panel for merchant/operator on SUBMITTED | Shared `phaseFrame` module (role-aware heading/next/due/consequence); non-buyer "Waiting for the buyer's review" frame |
| Four phase-keyed dictionaries drifting apart | One `phaseFrame` module consumed by OrderView, Orders, ActionPanel; `REVIEW_DEADLINE` single-sourced — completed 2026-09-16 in `reviewDeadline.ts`, now imported by every surface and the public-chrome test (this round left four hardcoded copies; removed in the 2026-09-16 refactor, C-A-04) |
| H1/status/panel restating the same state 2–3× | One fact, one carrier: status line = next/deadline/consequence; panel = actions |
| Per-field "sample" qualifier repetition (badge already persistent) | Trimmed across Scope/PaymentPanel/EvidencePanel; "sample clock" kept once (qualifies the invented deadline) |
| Two switching systems (toolbar vs scattered Explore buttons) | Explore buttons cut; toolbar is the mechanism; Account uses a deep link (no hidden reset) |
| Cross-surface identity contradiction (Still Studio as merchant in demo/landing, buyer in workspace) | One fiction: North Studio is the merchant everywhere |
| File-check result carried four ways; static affirmation rows | Notice shortened; static rows cut; persistent line + evidence row remain |
| Payment fallback sentence misfit empty/failed states | Per-state sentences (none/failed/expired/captured) |
| Demo summary duplicated on steps 0–1; technical IDs in the summary | Compact step-1 summary; case ID/revision in a details element |
| Visibility sentence ×3 on one screen | EvidencePanel + Scope row own it; inline note reduced to the link; studio quote moved to StudioPage |
| NewQuote missing documented fixed rows; destructive reset hidden; deep-link staleness | Fixed rights/deadline/resolution rows; honest note; `reset("fresh", quote)` reuse |
| Landing doors into two unlabeled sample systems | Scenario links labeled as the workspace environment |
| Tag/pill duplication (badge, demo-chip, sample-tag, frame-badge) | One `.tag` pill with documented tones (public side) |
| Off-scale radii (5/6/7/12px) vs 04:54 (8/16/24) | All unified to `--radius-control`/`--radius-panel`; compact-label badge is a pill (sanctioned) |
| Dead code: 7 unreachable routeTitle entries, `image-${i}` classes, `.landing` attr, unused exports | Deleted |
| Public headings untested (PublicShell chrome only) | `PublicApp` extracted; route-headings now renders the real public tree |

Net LOC: **−56 across 18 files** (246 insertions, 302 deletions).

### Escalated (decisions, not silent fixes)

| Item | Status |
|---|---|
| Maintenance-tx merge (install+lock) | Decision needed (F5); closes upgrade-trusted window |
| Circuit consolidation per 01:274 | Decision needed (F6); needs F8 per-action cost measurements first |
| Per-action on-chain cost measurement (01:1113) | Roadmap work; blocks the §3.3 cost gate |
| `lace-transaction-runtime.ts` (~760 LOC, test-only) | Owner decision: delete vs relocate to packages/integration (documented staged work) |
| Public CSS partition (workspace.css ships in the public bundle) | Follow-up; JS split closed the blocker, CSS split is polish |
| Journeys F-8 (staged progress model), F-14 (halted track), 320px workspace lab pass, LCP/INP/CLS harness | Open |

## Addendum 5 — 15 September 2026: round 4 (gap analysis, debt, interface, contracts)

### Deployment validation (Agent 4 — all local checks pass)

| Check | Result | Evidence |
|---|---|---|
| Full contract compile (compactc 0.31.1 cohort) | pass | `contract:compile`, 14 circuits verified |
| Artifact integrity | pass | 61/61 sha256 recomputed against the receipt |
| Admission pins vs compiled artifacts | pass | entrypoint exact-set equality + per-key byte equality |
| Contract + backend suites | pass | 234 tests / 1,299 assertions |
| Logic-pattern uniformity | pass | uniform guard pipeline; documented deviations only (reserve bootstrap asserts, dispute matrix, witness-free timeouts) |
| Cross-contract interop | pass (vacuous) | none exist and none are needed (01:272) |

### Readiness statement (honest, bounded by the standing gates)

**"Ready for Midnight mainnet deployment" is not claimable: R0, 0/6 providers, 0/14 operations.** Ordered evidence gap: (1) public-network cohort compatibility; (2) Preprod deployment with locked-policy observation (full single-tx deploy exceeds the measured weight limit by ~2.4% — staged or merged-update path mandatory); (3) Stripe payment provenance; (4) canonical admission executed + buyer reserve observed; (5) lifecycle branches with distinct actors; (6) F8 target-network measurements → cost gate → F6 decision; (7) mainnet authorization.

### F5 decision memo (Agent 4): merge install+lock into one MaintenanceUpdate (3→2 txs)

Feasible on the pinned cohort: the update-array API already carried a mixed 7-update batch including `ReplaceAuthority`; merged ≈19 kB / ~880×10⁹ ref-time vs limits (≈33% headroom, predicted); §3.3's requirements are state checks, so inspect-then-lock becomes both-or-neither atomicity; admission's `sameEntrypoints`/DEPLOYED/revision-0/locked checks survive unchanged. **Owner decision** — recommend a bounded native experiment.

### Round-4 fixes landed (this wave)

Interface F1–F13 as itemized in the changelog (headline-once, on-demand evidence, split status pills, deliberate reserve/accept, receipt framing, halted-track terminal item, mobile account reachability, one pill implementation, hover states, glyphs, role-keyed breadcrumb, CLS-stable notice, token sweep). Backend: Stripe version single-source, freshness-boundary alignment, neutral wallet error copy. Docs: stray critic file removed; happy-dom pinned; T04 reconciled; roadmap cells refreshed.

### Newly recorded (decisions/escalations)

| Item | Status |
|---|---|
| `@noble/hashes@1.4.0` (9th product dep) | Recorded — justification: Convex runtime lacks `node:crypto`; needed for `persistentHash` parity. Budget record per 01:1088 lands here |
| `@midnight-ntwrk/wallet-sdk` dashed vs `@midnightntwrk` no-dash (01:950 vs package.json) | Docs decision needed — testkit cohort today |
| §9.1 canonical layout vs actual tree | One consolidated layout decision (owner) |
| Agent 2 debt: node-version stringly coupling, registerHooks global, module-scope harness state, hardcoded bootstrap literals, facade `AtomicAdmissionRepository.transact`, static consent literals, fingerprint-schema triplication, recovery key bridge | Ranked inventory in the round-4 audit; all fail-closed; schedule with the observer/settlement work |
| The consequential gap | Observer-ingestion seam (T10b/T10c) + `packages/midnight-client` — the single seam between "compiles and rejects correctly" and "Midnight enforces the order rules". Roadmap-critical |

Prior verdicts re-verified this round: no hidden overclaims; receipts reproducible; 0/6 and 0/14 hold.
