# Milo — UI design and experience specification

> **Design specification · 7 September 2026 · target requirements; a synthetic UI prototype implements a subset.**
> The wireframes below are original, low-fidelity proposals, not screenshots, tested flows, conversion evidence or an award claim. All sample orders, businesses, prices and artwork used during implementation must be synthetic or explicitly licensed.

**Private agreements. Clear approvals.** Make private creative commissions feel like working with a confident studio: clear agreement, beautiful work, deliberate approval and understandable payment status. The three-image product pack is the first showcase, not the product's permanent category. The product is not an AI chat client, token dashboard or open marketplace.

## Contents

1. [Authority, scope and experience principles](#1-authority-scope-and-experience-principles)
2. [Visual direction and design tokens](#2-visual-direction-and-design-tokens)
3. [Navigation and page inventory](#3-navigation-and-page-inventory)
4. [Landing page and marketable story](#4-landing-page-and-marketable-story)
5. [One account and contextual onboarding](#5-one-account-and-contextual-onboarding)
6. [Quote and order preparation](#6-quote-and-order-preparation)
7. [Order workspace and state presentation](#7-order-workspace-and-state-presentation)
8. [Delivery, approval and receipts](#8-delivery-approval-and-receipts)
9. [Merchant, operator and account surfaces](#9-merchant-operator-and-account-surfaces)
10. [Failure and interruption design](#10-failure-and-interruption-design)
11. [Components and implementation ownership](#11-components-and-implementation-ownership)
12. [Motion, Three.js and responsive behavior](#12-motion-threejs-and-responsive-behavior)
13. [Free-source selection and provenance](#13-free-source-selection-and-provenance)
14. [Review process and acceptance evidence](#14-review-process-and-acceptance-evidence)

## 1. Authority, scope and experience principles

The [blueprint](01-blueprint.md) owns the product, protocol, privacy boundaries, package versions and performance budgets. The [roadmap](02-roadmap.md) owns readiness and sequencing. The [building guide](03-building-guide.md) owns engineering practice. This document owns proposed routes, page composition, interaction detail and UI-source selection; the [UX service specification](05-ux-design.md) owns cross-page journeys, handoffs, consent and comprehension. A design mockup never overrides a circuit precondition or creates a new backend capability.

The MVP is invite-only and merchant-led. The [seven service contexts](01-blueprint.md#14-seven-service-contexts) share `image-pack-v1`: one fixed-price order, one delivery of exactly three final images, bounded full-approval/full-cancellation dispute resolution, and a separate payment provider. No subscriptions, bidding, split payouts, real-time chat, inline delivery replacement, revision rounds, AI purchasing or arbitrary selective disclosure are added by these screens. Customer demand, pricing and commercial viability still need the roadmap's pilot evidence.

Five experience rules:

1. **One account, one task.** Privy is the only Milo sign-in. Wallet permission, local recovery and action confirmation are contextual prerequisites, not additional accounts.
2. **Consequences before consent.** Show scope, recipient, amount, rights, disclosure and deadlines before a hold or signature. Never put material information only in a tooltip.
3. **Visible truth, quiet machinery.** Lead with the next task and responsible actor; retain network, proof recipient, environment and fees where they affect consent. Technical identifiers belong in expandable evidence, not the main heading.
4. **A useful page before a visual effect.** The landing proposition, sample work and CTA survive JavaScript/graphics failure. The authenticated app may require JavaScript; do not claim otherwise.
5. **Recovery is a first-class screen.** Returning to a pending order is normal. Preserve scope, reconcile effects and offer a valid next action instead of prompting the user to start again.

## 2. Visual direction and design tokens

### 2.1 The creative-studio system

Use warm paper, dark ink and a restrained violet action color. The memorable object is a **sealed order card that opens into three delivery images**. The seal means terms are not published on the ledger; it must never imply that Milo, the authorized merchant or the selected proving service cannot see data they actually receive.

Public pages have editorial scale and generous space. Private pages use the same palette, type and card geometry at a calmer density. Do not combine nine libraries' defaults, multiple sidebar systems or competing button styles. Awwwards' [evaluation criteria][awwwards] inform craft, not a certification or a requirement to maximize animation.

| Token family | Initial design proposal | Use and constraint |
| --- | --- | --- |
| Surfaces | Paper `#F6F3EE`; panel `#FFFEFB`; ink panel `#20201F` | Light workspace by default; dark sections reserved for the public narrative. A second theme is not an MVP requirement |
| Text | Primary `#20201F`; secondary `#5C5A57` | Secondary is still meaningful text, not low-contrast decoration; test final foreground/background pairs |
| Action | Violet `#5434D7`; white label | One primary action per task region. Do not encode approval, payment and verification solely with violet or green |
| Status | Success `#216647`; warning `#79510A`; danger `#A72B32` | Always paired with icon and text; final contrast and disabled-state checks remain mandatory |
| Spacing | 4, 8, 12, 16, 24, 32, 48, 64, 96 CSS px | Compact rhythm inside cards; larger rhythm between sections. Use named CSS variables, not arbitrary per-component values |
| Corners | 8 px controls; 16 px panels; 24 px showcase frame | Pills only for compact labels, not paragraphs or every container |
| Typography | System sans for UI/body; system serif display accent | No font service/package needed initially. Self-host a display font only after checking its exact license, weights, size and fallback metrics |
| Type scale | Body 16 px; labels 14 px; page titles 28–40 px; hero 40–72 px | Use fluid CSS with bounded line lengths; do not shrink critical copy to make a mockup fit |
| Layout | Public maximum width about 1200 px; reading measure 60–70 characters | Workspace may use a wider preview area; informational pages remain readable on large monitors |
| Focus | Clear offset outline, distinct from hover and selected state | Must remain visible on paper, images and dark sections; never remove it for visual polish |

These are starting values, not verified contrast/performance results. Use native CSS variables and CSS modules, not a token runtime. Keep no more than primary, secondary, quiet and danger button variants. Use original small inline SVG icons with accessible names where needed; avoid adding a whole icon package for three glyphs.

### 2.2 Hierarchy and content framing

Each application page answers, in order: **Where am I? What is the state? Who acts next? By when? What happens if I act or do nothing?** Secondary metadata follows. Preserve a stable heading/summary while files and observations load. Human timestamps include timezone; relative time is supplementary.

Use real work as the visual centerpiece. Sample pack imagery should share lighting, crop and product identity; do not use unrelated portfolio tiles. Never borrow a UI library's logos, testimonials, product shots, preview videos or marketing statistics as Milo evidence.

## 3. Navigation and page inventory

These routes specify the target inventory. The synthetic prototype implements sample-only views; [progress](PROGRESS_MANIFEST.md) separates those from real authenticated endpoints. `:quoteId`, `:orderId` and `:caseId` are identifiers, **not access credentials**. Server-side membership and independent circuit authorization remain mandatory. A deep link resumes the named record after sign-in without embedding OTPs, JWTs, capabilities, backup passwords or signing material in the URL.

| Surface / proposed route | Audience and main task | Primary action / key boundary |
| --- | --- | --- |
| `/` | Visitor understands the offer and privacy boundary | Explore the sample order; secondary merchant-pilot enquiry |
| `/demo` | Visitor explores an interactive synthetic order | Route-backed landing modal or standalone page; inspect terms/images and advance labeled sample states, never create a hold or chain transaction |
| `/how-it-works` | Visitor evaluates process and responsibilities | Explore sample; plain-language explanation of wallet, recovery, payment and support |
| `/privacy` and `/terms` | Visitor/participant checks policy | Actual reviewed policies, recipients and retention; not generic generated legal promises |
| `/pilot` | Merchant requests an invitation | Minimal enquiry; no open seller marketplace, guaranteed acceptance or pretend live checkout |
| `/m/:merchantSlug` | Visitor sees one invited merchant's public service | View public service information; confidential quote requires access |
| `/sign-in` | Invited buyer/merchant/operator enters Milo | Email OTP with validated return destination; no wallet login tab |
| `/quotes/:quoteId` | Authorized buyer reviews an agreed quote | Prepare this order; setup is an in-context panel, not another account portal |
| `/orders` | Buyer sees their work and pending actions | Open an existing order; no global cross-merchant discovery |
| `/orders/:orderId` | Authorized participant acts or checks progress | Phase-specific task, delivery, timeline and separate payment status |
| `/orders/:orderId/receipt` | Authorized participant exports/inspects evidence | Private receipt download; separate public synthetic evidence flow only where enabled |
| `/merchant/orders` | Invited merchant triages work | Accept, prepare delivery, submit or respond to a dispute as permitted |
| `/merchant/quotes/new` | Merchant creates the supported quote | Review fixed service/roles/terms before issuing; no arbitrary product builder |
| `/operator/cases` and `/operator/cases/:caseId` | Authorized operator handles exceptions | Reconcile or resolve under the precommitted role/policy; no impersonation |
| `/account` | Same signed-in person manages access and devices | Session controls, local wallet connection and recovery guidance; no role transfer by editing email |
| Not found / access denied / unavailable | Anyone reaches an invalid or unavailable destination | Safe return/retry; do not leak whether a private order exists |

Setup, full-size delivery viewing, approval confirmation and technical evidence are panels/dialogs of the relevant order—not additional independent data workflows. Use the existing router for navigation; avoid a second route registry or a global onboarding store duplicating backend state. An operator may share the shell, but server-authorized role navigation is not a claim that every member has operator rights.

## 4. Landing page and marketable story

### 4.1 Composition and exact content intent

1. **Header:** small Milo wordmark; How it works, Privacy, Sign in; one clear sample CTA. Mobile navigation is a normal accessible menu, not a full-screen animated maze.
2. **Hero:** “Private agreements. Clear approvals.” Subhead: “Agree creative work privately, review the exact delivery, and keep a clear record of what you approved.” Adjacent sample seal/delivery object, immediately labeled “Sample order.”
3. **Proof of usefulness:** one sample three-image pack with the agreed scope beside it; a labelled context chooser reveals the same workflow with other synthetic briefs and artwork. Default to SC-01 rather than a seven-product comparison grid. Explain who supplies the creative work. No unsupported “AI generated by Milo” implication.
4. **Three-step process:** agree the scope → review the delivery → approve deliberately. Explain that a payment hold and later capture are separate from the Midnight approval.
5. **Privacy split:** what is shared with the merchant/Milo, what the proof path sees, and what becomes public. Link the fuller explanation; do not promise anonymity or operator-blind encryption.
6. **Product walkthrough:** an original labeled mockup until implementation; replace it with safe real product media only after the flow actually works. No fake customer count, success feed or “live” badge.
7. **Merchant value:** fewer ambiguous approvals, clearly bounded work and an exportable record. State these as product goals until pilot evidence exists. Do not promise guaranteed payment or dispute elimination.
8. **FAQ:** required software, who pays execution costs, what “private” means, recovery limits, deadlines, supported devices and cancellation. Unresolved consumer setup is disclosed before an invitation becomes payment consent.
9. **Closing CTA and footer:** sample order first, merchant pilot second; policies, support and attribution where required. No urgency countdown, fabricated scarcity or newsletter wall.

Before pilot readiness, `/pilot` is a minimal contact/enquiry mechanism using the selected backend only if implemented; do not add a CRM, mailing provider or checkout subscription just for this page. State how enquiries are handled and retained. A static honest contact link is an acceptable first release.

### 4.2 Desktop wireframe — hierarchy, not finished artwork

```text
┌──────────────────────────────────────────────────────────────────┐
│ milo                 How it works   Privacy   Sign in   [Demo]    │
├──────────────────────────────────────────────────────────────────┤
│ CREATIVE WORK, CLEARLY AGREED       ┌──────────────────────────┐   │
│                                   │ SAMPLE ORDER             │   │
│ Private agreements.               │ Sealed scope card        │   │
│ Clear approvals.                  │      ↘ 3 delivery images │   │
│                                   │ original artwork only    │   │
│ One concise explanation.          └──────────────────────────┘   │
│ [Explore a sample order]  Merchant pilot                         │
│ Sample only · no wallet or payment required                      │
├──────────────────────────────────────────────────────────────────┤
│ Scope we agreed     [image 1] [image 2] [image 3]                  │
│ Agree ───────────── Review ───────────── Approve                  │
├──────────────────────────────────────────────────────────────────┤
│ Shared privately               Published on Midnight             │
│ Recipients and limitations     Commitments/status, not the brief │
├──────────────────────────────────────────────────────────────────┤
│ Real walkthrough when ready · FAQ · clear closing action         │
└──────────────────────────────────────────────────────────────────┘
```

### 4.3 Source-backed variants and decision

**Selected foundation:** adapt the free ThreeUI Community [Complete Shelf][shelf-page] composition through its [pinned author-owned HTML source][shelf-source], replacing the bookshelf/content with the sealed order and sample work. Preserve its eligible semantic/layout source where useful, not the entire demo runtime or remote assets. The blueprint's renderer-migration gate remains in force. The source is a full HTML/DOM/CSS/older-Three renderer, not a drop-in Milo page; no iframe or full-template package installation is selected.

| Variant | Intended result | Decision boundary |
| --- | --- | --- |
| A — editorial static/CSS | Beautiful first frame, original order card, image stack, restrained hover/reveal | Default release path. Achieves the hierarchy without WebGL or a new animation dependency |
| B — one procedural Three.js hero | An original low-complexity sealed card rotates slightly and opens toward a delivery arrangement | Optional measured enhancement after A. One renderer, local assets, no personal data, same DOM headline/CTA and static fallback |
| C — subtle background/effect study | A reviewed free ThreeUI background or minimal CSS field behind a noninteractive public section | Only if it improves legibility/identity within the same resource budget; never an additional simultaneous scene |

Do not combine a WebGL background, orb, particle cursor, marquee, parallax wall and scroll-jacking hero. Select one signature effect. “Copy-ready” means source is available; it does not mean compatible with Milo's React/Bun/CSS setup or free of licensing/migration work. If B fails, A is the intentionally designed product—not a blank placeholder.

### 4.4 Interactive landing demo — the product inside the page

**Selected experience:** “Explore a sample order” opens an accessible, nearly full-width product window over the landing page. The visitor can choose a service context, inspect scope, open the three sample images, compare private/shared/public facts, and explore an approval explanation. It is one interactive product sample with seven small synthetic datasets, not seven apps, a live order or an embedded external app. A persistent **Synthetic sample · no wallet, payment or transaction** label remains visible in every step, including the closing receipt. Before implementation, label any standalone illustration “Design concept,” not “Try the working app.”

Use the same public `/demo` route for a normal link and the enhanced modal. With a known in-app background location, render it over the landing; direct navigation, reload, new tab and unavailable background state render the same content as a standalone page. Do not depend on router framework mode or add a routing package. Close returns focus/scroll to the opener; pop history only for a known app-created modal entry, otherwise navigate to a safe public route. Browser Back/Forward must work without trapping visitors or returning them to an unintended external page.

Use a native select labelled **Sample context**, populated from SC-01–SC-07 in the canonical catalogue, not seven cramped tabs. A public link may carry `?context=SC-05`; accept only known synthetic context IDs and default unknown input to SC-01. Never place real scope, customer identifiers or protected order context in this URL. Selecting a new example replaces the query in the current sample history entry rather than building a Back-button trap; preserve the known landing background entry.

Context changes reset the sample step, selected image, expanded evidence and illustrated payment outcome together. Keep focus on the selector and announce the new example; do not carry an old receipt or approval into different terms. Each dataset includes a stable case ID, template revision, fictional merchant, scope/rights, three licensed images with alt text, and explicit example-only state. These are build-time fixtures, not a runtime service registry or real order creation. A broken dataset falls back to the static explanation without an invented success.

| Step | Visitor action and composition | Boundary and next action |
| --- | --- | --- |
| Understand | Inspect one synthetic merchant's fixed three-image quote, rights and deadlines | “Explore the delivery”; no email gate, file upload, free-text brief or editable live price |
| Inspect | Select each thumbnail, zoom through explicit controls, read sample scope beside it | “See how approval works”; samples are not protected customer assets |
| Understand approval | Expand consequences and the shared/public disclosure explanation | “Show sample outcome”; do not label a simulation button “Pay” or trigger a wallet prompt |
| Inspect outcome | Display example approval and payment panels independently; an optional “Payment pending example” toggle shows why the distinction matters | “Discuss a merchant pilot” and a quiet “Replay sample”; no fake successful transaction ID or paid receipt |

The step index and selected image are ordinary ephemeral React state. Reuse presentational order components where genuinely shared, but pass an explicit synthetic view model and no mutation callbacks. Do not duplicate a contract/payment simulator, use a live API with `demo=true`, mount authenticated providers, or ship wallet/proof/payment imports just to make the public tour work. A type boundary helps prevent mistakes; verify the network/import boundary as well. The sample must issue no Privy challenge, Convex order mutation, Stripe request or Midnight operation. Any future analytics must follow the [minimal UX measurement policy](05-ux-design.md#8-measurement-without-surveillance).

```text
LANDING remains visible, dimmed and noninteractive
┌─────────────────────────────────────────────────────────────────┐
│ milo · Sample workspace                 Open as page    Close × │
│ SYNTHETIC SAMPLE · no wallet, payment or transaction             │
│ Sample context [Commerce imagery                         ▾]    │
├────────────────────────────────────────┬────────────────────────┤
│ 1 Scope   2 Delivery   3 Approval       │ THREE-IMAGE PACK       │
│                                        │ Synthetic Studio       │
│ [large selected sample image]          │ Scope and usage rights │
│                                        │                        │
│ [image 1] [image 2] [image 3]           │ What stays private?    │
│ Image description · accessible zoom    │ What is shared?        │
├────────────────────────────────────────┴────────────────────────┤
│ Previous                         [See how approval works]       │
└─────────────────────────────────────────────────────────────────┘
Narrow screen: full-height dialog; task → image → summary → action.
All content scrolls; Close remains reachable without obscuring it.
```

Follow the [WAI modal-dialog pattern][dialog-pattern] through the selected Radix primitive: meaningful title, appropriate initial focus, contained tab sequence, inert background, Escape/visible close, and focus return. Preserve the landing scroll position and release scroll lock on every close/unmount/error path. Keep a single dialog layer: in-demo image expansion and approval explanation replace a content panel instead of opening nested dialogs. Close the sample before navigating to sign-in or pilot enquiry. New step headings receive deliberate focus; routine status text does not steal it. At 320 CSS px and 200% zoom, the experience remains usable with the virtual keyboard and reduced motion. The standalone page needs no modal focus trap.

The wireframe shows the initial commerce example. Every context retains the same hierarchy, controls, file limits and consent explanation. Show capability limits and sample availability beside the example; do not label an entire industry “supported” because its dataset renders.

### 4.5 Image, SVG, canvas and effect direction

Use one coherent, original sample pack: a fictional unbranded ceramic object on warm paper, with front, detail and contextual crops. Source actual photography/renders with documented rights; do not imply Milo generated the commissioned work. Specify intrinsic image dimensions, meaningful alt text, responsive derivatives and full-size controls. Never use template preview media as the deliverable. Do not bake body copy, amounts or controls into an image.

| Medium | Purpose | Performance and accessibility limit |
| --- | --- | --- |
| DOM + CSS | Readable proposition, quote, buttons, modal, timeline and card opening | Default complete experience; usable before graphics load; no scroll interception |
| Original inline SVG | Seal, three-file motif, small directional diagram or decorative line | Mark decoration appropriately; provide text for meaningful diagrams; sanitize/review source and strip scripts/external references |
| Licensed raster images | The product pack and later real, sanitized product evidence | Stable aspect ratios; lazy-load offscreen assets; do not lazy-load the essential hero image |
| Canvas 2D | Optional procedural paper/noise study when CSS is demonstrably insufficient | Decorative only, no semantic text or interaction, bounded resolution and frame work; not an additional permanent effect |
| Three.js/WebGL | Optional single card scene from §4.3 | Same existing renderer/cohort gate; pause the scene while the modal is open and on hidden/offscreen tabs; static fallback on loss/failure |

Choose composition A first, then compare one optional effect against it on the same device, content and build. Add neither a Three wrapper nor a shader/particle library by default. Depth, spacing, responsive imagery and a well-paced product reveal provide the intended “wow” without requiring a GPU scene. Mirror the currently selected image in the simple card illustration only if that linkage remains decorative and inexpensive; never make canvas selection the only way to explore the demo.

### 4.6 CTA hierarchy and conversion-quality review

For public discovery, the primary CTA is **Explore a sample order**. Its promise is specific and immediately fulfilled. After the sample, offer **Discuss a merchant pilot**; on `/pilot`, explain the invite-only fixed-service scope and what happens after enquiry. For an invited participant entering through a quote, skip the marketing detour and use **Continue to your quote**. Do not replace the real task with a newsletter, forced demo or sales modal.

No fake urgency, guaranteed-payment claim, award badge or unmeasured customer statistic. Before R4, public copy must not offer live buying or imply production-ready payments; readiness determines the CTA promise. CTA quality means the correct people understand the next step and its constraints, not merely more clicks. Use the [UX journey and comprehension checks](05-ux-design.md#9-scenario-coverage-and-review) and the roadmap's commercial metrics before claiming conversion improvements.

Demo acceptance adds Back/Forward/deep-link/reload behavior, opener removal, repeated mount/unmount, keyboard and screen-reader navigation, modal-to-page transitions, missing images, graphics failure, offline/static fallback, and inspection showing no privileged requests. Record both ordinary and reduced-motion paths on desktop and narrow screens after implementation. A mocked tour never closes a wallet, payment or protocol gate.

The [optional launch film](07-video-design.md) is supporting material after MVP verification, not an autoplay replacement for the interactive sample. Use a lightweight poster and accessible play control with captions/transcript; no video fetch before deliberate play by default. Keep the main sample CTA usable if media fails. Reuse approved branding/assets, not the renderer or its animation dependencies in the app.

## 5. One account and contextual onboarding

### 5.1 Sign-in and membership

Use the selected Privy email OTP flow. Label it “Continue to your order,” retain a safe return route, allow paste/autofill and provide clear resend/error timing from actual provider state. Avoid separate Sign up / Sign in / Wallet tabs for the same task. Do not replace Privy's challenge UI with a copied visual-only auth form.

After OTP, wait for Convex authentication and membership. An authenticated but uninvited user sees a useful access explanation, not a brief flash of someone else's content. Expired/revoked invitations do not create partial membership. Returning sessions reuse verified access; identity changes clear protected views and unlocked capability state.

The invitation and frozen quote establish intended app access and terms; neither is a wallet login or an order capability. Keep the quote readable to an authorized member without a wallet, and reveal action prerequisites only when that participant chooses a consequential action. The one Privy sign-in remains the only Milo login.

### 5.2 Progressive prerequisites

The [single-account coordinator](01-blueprint.md#342-wallet-integration-and-identity-lifecycle) derives the next required action. It does not own new credentials or replace SDK storage. Its technical readiness fields map to human tasks:

| Verified readiness | User-facing presentation | Must not imply |
| --- | --- | --- |
| `appAccess` | You can view this quote/order | Login owns a wallet or grants every order role |
| `chainConnection` + `proofPath` | Prepare this device; named wallet, network and proof recipient | Every wallet/device works, or wallet-mediated proving is necessarily on-device |
| `orderCapability` | Prepare or unlock this order's recovery kit | Email reset or wallet seed alone recreates application state |
| `feePath` | Execution costs covered for this action, or explicit developer-funded requirement | Free forever, sponsor capacity reservation, hidden paid fallback |

Show the next blocker, not five disconnected onboarding wizards. Wallet selection and permission occur only after the user chooses to prepare an order. Reading remains possible without a wallet. A supported connection can be reused, but network/account context and consequential consent must be freshly checked.

Name recovery boundaries precisely: wallet recovery restores access to the selected wallet; actor-capability recovery restores that actor's encrypted, order-scoped Midnight state; Convex application restore concerns authorized application records/files. None substitutes for another, and support or a second Milo login cannot recreate a lost capability.

Do not promise walletless onboarding: the reviewed Privy APIs do not establish a native Midnight signer. A future embedded-wallet choice must pass compatibility, custody, proving and recovery gates before the UI removes the software requirement.

## 6. Quote and order preparation

### 6.1 Quote anatomy

Display the merchant, selected service context, fixed scope, three-image output, usage rights, total/currency, delivery/review deadlines, resolution policy and privacy recipients. The invitation supplies its frozen context; buyers do not repeat an industry-selection funnel. Merchant drafts may select a supported context and use its brief prompts, but this is not a workflow/policy editor. Separate editable draft information from the frozen quote. If context, scope or terms change, invalidate the old confirmation and show what changed; do not silently preserve old consent or refresh an admitted order from a newer template.

Use “Prepare this order” before any payment action. An agreement summary stays visible beside desktop setup and immediately above the active mobile step. Recovery is **before the card hold**. The existing predeployment capability-staging problem remains an engineering blocker: an order nonce is not a contract address. Do not design a pretend one-click backup that writes into an unsupported provider scope.

### 6.2 Preparation wireframe

```text
┌─────────────────────────────────────────────────────────────────┐
│ ← Quote                 Prepare this order                       │
├──────────────────────────────┬──────────────────────────────────┤
│ AGREED WORK                  │ 1  Prepare this device            │
│ Merchant: synthetic studio   │    Wallet · network · prover      │
│ Three final product images   │    [Connect supported wallet]     │
│ Rights and scope summary     │    Why this is needed             │
│ Total: from this quote       │                                   │
│ Deadlines with timezone      │ 2  Verify recovery kit            │
│                              │    Not ready yet                   │
│ What is public / shared      │                                   │
│                              │ 3  Authorize payment hold          │
│ No hold has been placed      │    Available after 1 and 2         │
├──────────────────────────────┴──────────────────────────────────┤
│ Save and leave · read the quote anytime · no automatic payment   │
└─────────────────────────────────────────────────────────────────┘
```

Completed steps remain inspectable, but never use a clickable completed badge to bypass a changed context. When a wallet/account/network changes, explain which readiness became invalid and why. Reopening an order inspects the existing operation; it does not automatically rerun a pending confirmation.

### 6.3 Payment and reservation sequence

After a safe isolated recovery check succeeds, show the exact hold amount/merchant and authorization/capture/cancellation policy. The actual provider-reported authorization expiry becomes available after authorization; do not invent it before card confirmation. The [selected hosted Checkout path](01-blueprint.md#51-two-independent-state-machines) uses the existing server Stripe SDK and a normal redirect, not an embedded card form, another app account or a browser payment package. Milo must not receive raw card data. Explain the temporary visit to Stripe, return to the same order, and reconcile the bound Session/PaymentIntent before claiming a hold or absence of one.

Confirm the hold through the backend; then deliberately deploy/admit/reserve using the verified Midnight path. Explain these are separate operations. A hold with failed reservation shows hold/reconciliation status and a safe exit, not “Order placed.” Sponsor capacity and transaction expiry are rechecked at the actual action boundary.

Keep progress stage-based: preparing → proving → wallet confirmation **if requested** → submitted → observed outcome. Stage changes follow SDK/provider evidence, never a timer or an animated orb's state. Leaving the page does not imply cancellation of an already submitted transaction.

## 7. Order workspace and state presentation

### 7.1 Stable composition

Desktop: header with order/merchant; main work area; a compact summary/action column; timeline below. Mobile: header, current task and deadline, work content, summary, timeline. An optional sticky action region may not cover content, focus, dialogs or the software keyboard. No resizable trading panels or hidden horizontal carousels.

```text
┌──────────────────────────────────────────────────────────────────┐
│ ← Orders      Product-image pack                 Account         │
│ Waiting for your review · due [absolute time + timezone]         │
├─────────────────────────────────────────┬────────────────────────┤
│ DELIVERY — fixed version               │ YOUR NEXT STEP         │
│ [image 1]   [image 2]   [image 3]        │ Review all files       │
│ Open full size · file verification      │ [Review approval]      │
│                                         │ Raise a dispute        │
│ Scope and rights                        │                        │
│ Agreed terms remain accessible          │ PAYMENT                │
│                                         │ Hold authorized        │
│                                         │ Not captured           │
├─────────────────────────────────────────┴────────────────────────┤
│ Timeline: agreed → reserved → accepted → delivery submitted      │
│ Observation updated [time]       Technical evidence ▾           │
└──────────────────────────────────────────────────────────────────┘
```

### 7.2 Phase-to-task contract

The [protocol state machine](01-blueprint.md#42-state-machine) is authoritative. Labels below are presentation, not new ledger states. Availability also depends on membership, role, current revision, deadlines, integrity and fresh observation; the UI cannot grant an action merely because a row lists it. Every order form—invited quote, preparation, delivery, review, dispute and receipt—distinguishes chain and payment facts with their observation freshness. Before a contract or payment attempt exists, say so rather than invent a phase; after submission, represent an unknown outcome explicitly.

| Observed state | Buyer framing | Merchant/operator framing and exits |
| --- | --- | --- |
| App draft / no canonical order | Review and prepare the quote | Merchant may issue the supported quote; no funded-order badge |
| `DEPLOYED` | Finishing reservation; show actual hold separately | Not a valid commercial reservation yet; failed/abandoned bootstrap follows reconciliation/timeout policy |
| `RESERVED` | Waiting for merchant; cancellation only while still permitted | Intended merchant checks usable hold and accepts or declines before cutoff |
| `ACCEPTED` | Work in progress; agreed dispute path remains visible | Merchant prepares immutable delivery; either party may dispute under the protocol |
| `SUBMITTED` | Review exact delivery; approve or dispute before deadline | Merchant waits for review; no silent delivery replacement or merchant approval button |
| `DISPUTED` | Awaiting the pre-agreed resolution process | Operator reviews evidence and performs only the permitted full approval/cancellation; timeout remains distinct |
| `APPROVED` | Approval confirmed; show payment processing/success/failure independently | Reconciliation may request capture; approval alone is not a paid invoice |
| `CANCELLED` | Order cancelled; show hold release/refund status independently | Terminal order; pending bank/provider processing may remain |

When a deadline passes, show “Deadline reached; awaiting the applicable action” until an observed transaction changes phase. Do not locally flip the phase or automatically approve a delivery. A public timeout still requires a real funded caller/prover; in-app notices cannot reach a closed browser.

For a submitted wallet/provider request with no fresh observation, retain its operation identifier and show “Outcome being checked”; disable an unsafe duplicate rather than infer failure from a timeout. On account, wallet, network, order or tab-context change, invalidate the prior action generation and ignore late callbacks. A merchant or operator view must never complete a buyer action merely because both are open in the same browser.

### 7.3 Payment authorization approaching expiry

The payment panel retains the independently observed hold status, freshness and provider-reported `capture_before` with timezone. Show “Payment hold expires [time]” while usable and “Payment hold expired; payment unresolved” after provider confirmation. If the deadline has passed but status cannot be refreshed, show “Hold status needs checking,” not a locally inferred release or capture. The order phase remains separate.

Follow the [canonical expiry policy](01-blueprint.md#51-two-independent-state-machines): Milo's app blocks acceptance without a verified usable hold and adequate deadline margin; this is not circuit-enforced payment verification. Stop normal capture for a dispute approaching expiry and show the actual cancellation/dispute/finance-support path. Do not accelerate buyer approval to rescue a hold. v1 offers no same-order replacement authorization. Any later new quote is a separately consented order after resolving the old outcome; an already approved/unpaid order remains a finance exception, not a cancellable or reopened order.

## 8. Delivery, approval and receipts

### 8.1 Reviewing files

Display all three images with stable dimensions and descriptive alt text. Full-size viewing uses one accessible dialog with next/previous buttons, Escape, focus return, keyboard controls and a download alternative; no drag/pinch-only navigation. Respect the blueprint's accepted formats/size limits and locally validate the exact received bytes against the confirmed immutable manifest before ordinary approval.

Distinguish “Checking file,” “Matches submitted manifest,” “Cannot verify” and “File unavailable.” Digest matching does not certify quality, malware absence, copyright or human review. Do not mark the buyer's subjective inspection complete merely because thumbnails loaded. No auto-approval on download, scroll depth or image-view count.

### 8.2 Approval confirmation

```text
┌──────────────────────────────────────────────────┐
│ Approve this delivery?                            │
│                                                  │
│ Merchant        [verified order merchant]         │
│ Delivery        [immutable version / preview]     │
│ Amount          [exact quote amount + currency]   │
│                                                  │
│ After approval is confirmed on Midnight,          │
│ Milo checks the hold before requesting capture.  │
│ Capture can remain pending or fail separately.    │
│                                                  │
│ Public/shared facts and irreversible consequence  │
│ [Back to review]                                  │
│ [Approve delivery]                               │
└──────────────────────────────────────────────────┘
```

Use an explicit confirmation, no preselected checkbox, hidden dispute link, countdown pressure or vague “Continue.” The button expresses intent, not a promise that both systems will complete atomically. A wallet prompt, where required, remains a separate actual device interaction. Rejection preserves the order and does not dismiss the user's ability to inspect it.

The confirmation requests approval, not a direct payment-provider call. Only the reconciliation worker may request capture after observing the expected finalized `APPROVED` transition and rechecking the bound usable hold under the [payment policy](01-blueprint.md#52-reconciliation-not-distributed-transaction-theater). If those checks fail, preserve the actual approval state and show the payment exception; only provider confirmation establishes capture.

### 8.3 Receipt and public/private evidence

The receipt has separate sections for order approval, delivery identity and payment. Show source/freshness and outstanding reconciliation. Expand technical detail for network, canonical contract, stable transaction identifiers, artifact fingerprint and public fields. Explain what this proves and what remains dependent on the indexer, payment provider or human judgment.

Keep **Download my private receipt** distinct from any public synthetic verification bundle. Never export capability secrets, private terms openings or confidential file links into a public archive. Cascade, if enabled by its separate gate, archives reviewed synthetic public evidence; it does not make private files independently available or change order authority.

### 8.4 What was verified and who can see it

Reuse `EvidenceDetails` as two adjacent, plain-language sections: **What was verified?** and **Who can see this?** Keep the main review surface about the work. The real view uses named evidence, not a universal “Verified” seal or a local success boolean.

| Explanation | Real authority and visible limitation |
| --- | --- |
| Authorized order action | Compact verifies the committed role capability; this is not a legal-identity or current-session certification |
| Agreed terms unchanged | The action opens the original terms commitment; scope prose and usage rights are not certified true |
| Approval identifies this submission | Contract approval binds the submitted commitment; the application separately compares downloaded bytes with the manifest |
| Order observation | Show named network, contract/artifact identity, observed revision and freshness; pending/unknown is not finality |
| Payment status | Provider observation, separate from all contract checks; a confirmed approval can remain unpaid |
| Information visibility | Explain public commitments/timing, participant-shared scope/files, and actual platform/prover/payment recipients; do not offer arbitrary field-disclosure switches |

Real evidence can be pending, unavailable, rejected or observed. A missing/stale prerequisite blocks the corresponding action and links to recovery/support; the panel cannot override authorization. In the synthetic sample, use **Illustrated check — not executed**, never fake proof IDs or an observed-network badge. The technical walkthrough must show genuine wrong-terms/wrong-role rejection and distinguish circuit delivery-binding checks from application byte-mismatch detection.

### 8.5 Optional advisory review panels

The three authorized configurations share one `reviewService` and `reviewLoop`, as defined in the [review-assistance boundary](01-blueprint.md#38-review-assistance-and-agent-operated-prototypes); they are contextual panels, not three assistants or a chat product. Offer a merchant preflight before immutable delivery submission, a buyer recommendation before that buyer chooses approve/dispute, and a dispute-operator case brief before the authorized human resolves. Each panel states its exact role and leaves the existing human action visible.

Before any selected external model receives data, show an explicit disclosure/consent panel naming its scope, model and provider; the exact content, purpose, and retention/deletion limitations; and that Private/TeeML and Verified/TeeTLS are different privacy properties. Keep deterministic inspection in the application and never send capability secrets, keys, witnesses, recovery material, payment credentials or an authorization request to the model.

**Skip assistance** and **Continue without sharing** remain complete, equal-operability paths. Label every output “Advisory — not verified” and visually separate it from file-digest checks, observed chain state and provider-observed payment. Unavailable service, budget cap, timeout, suspected prompt injection, malformed output, stale revision or digest mismatch must discard/withhold the suggestion and show the applicable human path; none can approve, dispute, sign, submit, capture or pay automatically.

Show only the admitted task configuration from the [canonical routing policy](01-blueprint.md#611-review-model-selection-and-routing), not a general model-settings surface. Provider/model/trust labels come from the pinned job policy, never from a model-generated badge. Retain consent, invocation status and the safe reason for withheld output; a missing qualified route does not imply permission to switch recipients.

## 9. Merchant, operator and account surfaces

### 9.1 Merchant queue and quote creation

Group work by “Needs your action,” “Waiting” and “Exceptions.” Rows show service, counterpart display name only where authorized, next actor, deadline and separate hold/payment state. Default to actionable work, not transaction count. Sorting/filtering uses bounded backend queries; do not fetch every order into a new client-side database.

The supported quote form uses the fixed service model, not a general storefront builder. Review scope, usage rights, deadlines, intended merchant/buyer and precommitted operator before issuing. Issuing a quote does not place a payment hold. A shared quote link must still enforce invite/access policy.

Accept only after the independently verified usable hold and valid reservation are available. Upload preparation shows three explicit slots, format/size instructions, per-file progress and error recovery. Before final submission, review previews and the exact manifest; clearly state that v1 cannot replace a submitted delivery in place. Corrections use the agreed dispute/reorder path.

### 9.2 Operator workspace

Use the same visual system with clearer risk framing, not another branded product. Case list: unresolved state, deadline, freshness and owner. Case detail: agreed policy, authorized evidence, timeline, payment condition and permitted actions. Separate **reconcile external status** from **resolve dispute**; viewing support material does not grant a role capability.

The shell checks distinct `disputeOperator`, `financeOperator` and optional `archivePublisher` assignments from the [authority definitions](01-blueprint.md#343-operational-authority-assignments). Show only the permitted case evidence/actions. A dispute operator does not automatically see finance controls; a finance operator cannot sign a resolution; archive publication is not a support export. Explicitly assigned dual-role people retain separate action confirmations and audit records.

An operator resolution requires the correct committed authority, current revision and explicit full-approval/full-cancellation consequence. No arbitrary partial refund editor, phase dropdown, impersonate-user switch or admin “force approve” bypass. If evidence is missing or stale, say so and withhold unsupported conclusions.

### 9.3 Account, recovery and support

One account menu contains account identity, order access, local connection state, recovery guidance, support and sign out. Do not present an account balance, trading wallet or token-purchase dashboard. Changing wallet does not sign out of Milo; changing Privy subject does clear sensitive account context. An email edit cannot transfer contract authority.

A recovery screen explains exactly what the application kit covers and what it excludes. Restore is local, scoped, conflict-checked and tested in isolation. No seed phrase request in support, no upload-to-cloud backup shortcut, no promise that staff can recover a lost capability. Missing capability may leave authorized read-only access and phase-dependent exits; do not invent cancellation powers.

Support collection uses an allowlisted diagnostic record, not a raw request dump. Show users what will be shared. Private briefs, images, tokens and proof inputs do not enter annotation tools, screenshots or support exports by default.

## 10. Failure and interruption design

| Situation | Required screen behavior | Prohibited shortcut |
| --- | --- | --- |
| OTP expired / session lost | Clear explanation, supported resend/reauthentication, return to draft/status inspection | Automatically submit the pre-expiry intent |
| Unauthorized / unknown link | Safe access-denied/return path, no private record disclosure | Wallet possession as replacement for membership |
| Missing/unsupported wallet | Keep read-only quote; state tested software/device requirement and safe handoff | Claim all extensions or all mobile browsers work |
| User rejects permission/signing | Preserve draft and explain that the requested action did not complete | Repeated unsolicited prompts |
| Account/network changes mid-proof | Invalidate affected builders, ignore stale results, lock previous actor state | Reuse proof or capability across contexts |
| Recovery preparation fails | Keep payment unstarted; show the actual engineering/support limit | Mark backup complete to improve conversion |
| Sponsor unavailable | Explain unavailable capacity and safe retry/exit after reconciliation | Silent user-paid fees or different prover |
| Hold succeeds, reservation fails | Separate money/order panels and actual void/reconciliation progress | Show payment failure when a hold may exist |
| Submission outcome uncertain | Preserve operation/ledger identifiers; observe before retry | Duplicate send because a spinner timed out |
| Indexer stale/offline | Visible freshness/unavailable state; block actions needing fresh evidence | Treat cached green status as chain finality |
| Image missing/digest mismatch | Integrity warning, permitted dispute/support path | Ordinary approval based on unverified thumbnails |
| Capture fails after approval | Approval remains confirmed; payment exception and reconciliation | Undo the ledger approval locally or claim paid |
| Hold approaching expiry / expired | Visible provider deadline/status and actual cancellation/dispute/finance-support path; no same-order replacement in v1 | Pressure approval, renew payment or mutate the order phase |
| Advisory service unsafe/unavailable | Withhold nonauthoritative output and preserve human review with a visible reason | Retry invisibly, degrade to unlabelled advice or alter an order/payment action |
| Deadline crossed | Show actual phase, responsible next actor and timeout eligibility | Countdown reaching zero mutates chain state |
| Canvas/WebGL failure | Static hero and working DOM content/CTA | Error boundary replaces the whole landing page |
| Empty queue / first order | Explain the next available task and invite-only scope | Fake activity, sample rows indistinguishable from live records |

Every error says what happened, what did not happen, whether a hold/submission may exist, what was preserved and the next permitted action. Status changes use restrained live announcements and do not steal focus. Do not make a dismissible toast the sole record of a financial or privacy problem.

## 11. Components and implementation ownership

These are proposed local component names, not new packages or a generalized workflow engine. Extract shared code after real reuse appears; do not build a schema-driven form/route/state framework for this small MVP.

| Local component responsibility | Reuse first | Boundary |
| --- | --- | --- |
| `AppShell`, `PageHeader`, `OrderSummary` | React composition, existing router, CSS modules | Layout and navigation; never membership enforcement |
| `TaskPanel`, `StatusNotice`, `PaymentStatus` | Typed domain projection and native semantic markup | Keep order/payment states separate; no overloaded success boolean |
| `SetupSheet`, `ActionConfirmation`, `DeliveryViewer` | Already-selected Radix dialog primitives | Focus/keyboard behavior; callback requires fresh authorization/readiness |
| `QuoteForm`, `DeliveryUpload` | Native form/file controls, React form state, existing Zod boundary schemas | Convex validators/server policy still independently validate; no copied auth/payment forms |
| `OrderTimeline`, `EvidenceDetails` | Lists, headings, `details` where appropriate | Actual event provenance/freshness, no fabricated activity |
| Context selector and sample content | Native select plus small typed synthetic fixtures | Public presentation only; no backend query, policy interpreter or industry-specific shell |
| `HeroOrderScene` | Original CSS/static art; optional single Three.js module | Public-only lazy enhancement, isolated cleanup/error boundary |

Use Convex subscriptions as the application-data source, React state for ephemeral UI, existing router state for navigation, and the existing SDK/provider stores for authentication and private-state recovery. Do not add React Query, Redux/Zustand, a second backend, a second auth store, Framer Motion, Tailwind or a shadcn installation merely because a copied component imports them. Reimplementing Radix's focus trap to avoid a declared dependency is not simplification.

Share pure presentation props and tokens between the real order and synthetic sample, never their provider trees or action callbacks. Keep a discriminated sample/live view model; sample code cannot construct live mutation intents. Reuse does not mean bundling authenticated components behind a `demo` flag. The isolated film consumes approved static assets/captures, not the live application dependency graph.

Before adapting a source component, inventory its imports, hooks, helpers, CSS selectors, fonts, remote assets and license. Replace demo `cn`/variant helpers with the actual small local pattern only when their behavior is unnecessary; preserve behavior instead of mechanically deleting imports. If genuine retained behavior needs a new dependency, record and justify it in the blueprint budget before adoption. No deep imports into undocumented package internals or accidental reliance on hoisted transitives.

## 12. Motion, Three.js and responsive behavior

### 12.1 Motion grammar

Use the [canonical performance/accessibility budgets](01-blueprint.md#74-motion-performance-and-accessibility-budgets), not another numeric budget here. Native CSS is the default. Animate opacity and transform for orientation, panel entry and an actually observed result. A motion duration is not a network deadline.

| Moment | Motion intent | Static/reduced-motion equivalent |
| --- | --- | --- |
| Landing first view | Content is present immediately; optional restrained card reveal | Same composed first frame, no waiting |
| Open setup/details | Short origin-consistent panel reveal; preserve context | Immediate visible panel with correct focus |
| Route change | Gentle content replacement after actual navigation | Immediate route; announce heading and preserve deliberate navigation semantics |
| Validation failure | Inline field explanation and error summary | Same explanation; no essential shake/flash |
| Observed confirmation | Small check/icon transition plus exact status text | Static icon/text; never confetti for a submitted proof |
| Pending proof/payment | Quiet stage indicator tied to actual state | Text remains sufficient; no percentage or “thinking” claim |

### 12.2 Procedural hero implementation boundary

Build the static/CSS hero first. For the optional Three.js variant, use the blueprint's reviewed renderer candidate and one canvas. Prefer a small procedural rounded card, soft neutral lighting and original textures; avoid large model downloads, postprocessing stacks, physics, React Three Fiber/Drei or imported demo renderers unless a separate measured decision justifies them.

The DOM owns headline, sample labels, privacy explanation and CTA. The canvas is decorative, nonessential and excluded from the accessibility tree; controls remain ordinary DOM controls. It must not receive order data or intercept page scrolling. No required WebGPU flag, pointer lock or custom cursor.

Feature-detect the actual graphics path. Load after useful content and only for supported conditions; retain the poster/static composition on constrained devices, reduced motion, save-data where detectable, unavailable WebGL and context loss. Support actual resource cleanup: cancel animation frames, disconnect observers, dispose geometry/materials/textures and renderer, release event handlers, and pause offscreen/hidden work. Test repeat mount/unmount, resize, tab visibility and context loss; one successful desktop screenshot is insufficient.

### 12.3 Responsive and accessible composition

Use content-driven CSS breakpoints, not device-brand detection. Begin with a single-column quote/order and enlarge to a stable work/summary split when both remain readable. Test the blueprint's reflow/zoom requirements, mobile safe areas, long merchant names, large currency totals, translated-length copy and the software keyboard.

No hover-only information, drag-only input, autoplay audio, canvas text for essential content or hidden dispute path. Keyboard/screen-reader testing covers OTP, dialogs, files, setup, confirmation and errors. Real wallet prompts require separate human review. Automated axe checks and a cloud simulation do not establish extension accessibility or consumer signing support.

## 13. Free-source selection and provenance

### 13.1 Selection policy

Only free, explicitly permitted source is eligible. No paid template, Pro-only block, paid MCP/AI service or purchase is required for this design. Free access is not permission to redistribute; inspect the exact source and license, not a site badge or a third-party mirror. Preserve upstream notices and separately licensed assets. A public Apache-2.0 Milo repository does not relicense third-party code.

The blueprint owns versioned dependency decisions. Source-copy components are pinned by upstream revision/file digest and license record rather than an invented npm version. “Reference only” means use the documented interaction idea and create original Milo code—not copy source or distinctive assets through a license workaround.

| Source | Evidence and free-use boundary | Milo use / dependency decision |
| --- | --- | --- |
| [ThreeUI][threeui] | [Pinned MIT Community source][threeui-license], [asset exclusions][threeui-assets] and [Community/Pro terms][threeui-terms]; preview media and paid source are separate | Primary free landing composition. Adapt Complete Shelf; optional one reviewed procedural variant. Do not install the catalog package or retain its legacy renderer aliases |
| [OriginKit][originkit] | Its [integration page][originkit-integration] describes account/API-key-mediated retrieval; a CLI's MIT label does not license every delivered component. Per-item source/rights were not established | Reference only: [Dot Matrix][originkit-dot] is an optional visual study, not selected code. No authenticated CLI/MCP, new account, copied effect or claimed blanket commercial grant. Do not confuse OriginKit with Origin UI |
| [Thinking Orbs][orbs] | [Author source][orbs-source] and [release metadata][orbs-package]: MIT, React peer, no declared runtime dependencies; Canvas 2D rather than WebGL | Not selected for the MVP. An AI-thinking visual adds no order capability and must not imply proof, payment or hidden agent work. A future genuine assistant would need a separate product decision |
| [Transitions.dev][transitions] | [Pinned free CSS/source license][transitions-source] and [site terms][transitions-terms]; Pro recipes/CLI access are distinct | Select Menu Dropdown, Panel Reveal, Modal Open/Close and observed Success Check as appropriate. Preserve reduced motion/provenance; no framework, paid login or republished transition collection |
| [Beautiful UI][beautiful] | [Official MIT grant][beautiful-license] and [public implementation][beautiful-source]; inspect the exact item. The implementation includes self-animating demos, not ready-made data-driven order APIs | Adapt Approval Card and task/status composition into existing Radix/CSS components. Remove demonstration loops; real events drive state. Do not adopt Next/Tailwind/shadcn or incidental chart/icon dependencies |
| [21st.dev][twentyone] | [Platform terms][twentyone-terms] distinguish author code from proprietary catalog media/metadata and restrict automated collection | Discovery/reference only through permitted access; obtain eligible source from the original author. No catalog scraping, preview reuse, bulk CLI install or required paid platform |
| [Aceternity UI][aceternity] | Free component pages coexist with [Pro-oriented licence][aceternity-license] and [restrictive site terms][aceternity-terms]; examined registry data does not establish a blanket MIT grant | Reference Bento Grid/3D Card/Timeline ideas; copy only after an explicit item-level commercial/public-source grant. Default to original CSS Grid/card/list implementation, not Next.js/Tailwind/Motion adoption |
| [Component Gallery][gallery] | [About page][gallery-about] describes a pattern reference, not a single installable/licensed component set | Compare dialog, upload, alert and navigation behavior; follow original design-system rationale/license for any code. Do not pin a changing “95 systems” count or install every referenced system |
| [Agentation][agentation] | Official site permits free internal use; [registry release][agentation-package] and shipped [license][agentation-license] are PolyForm Shield, not MIT/Apache | Optional local developer feedback only. No customer-facing embed, no production bundle, no paid product/MCP requirement; see §14.2 |

### 13.2 Source receipt required before copying

**Observed source snapshot, not an installation list:** ThreeUI `1.2.0` maps to upstream `68802d5428071ada5c20db8094b1649e6bb770ed`; it includes two legacy Three aliases despite accepting the selected React major. Transitions source was inspected at `74e572345d809f981250938208bd991314c2e780`; Beautiful UI's public implementation at `05dab2d2b5f1f3e40029776e339a486d70491079`. Thinking Orbs `0.3.1` is reviewed but not selected; Agentation `3.0.2` is optional internal tooling. The [blueprint's renderer decision](01-blueprint.md#72-selected-free-landing-foundation) owns the target Three version. Current source availability is not a tested cross-library cohort.

For each adopted file record: original URL; exact upstream commit/source record and file digest; retrieval date; component name; license text and required notices; asset/font provenance; original imports; retained/removed dependencies; local destination; rationale; and verification results. Record new direct dependencies **and** additional transitive/runtime/service costs. A copy-paste source file is still maintained code.

Use one component per proven need. Do not run a source site's installer, skill pack, shell pipeline or agent instructions automatically. Read first, import only reviewed files and run the repo's own tests. Component previews demonstrate the source author's application—not Milo compatibility, accessibility or performance.

## 14. Review process and acceptance evidence

### 14.1 Build and review sequence

1. Agree the low-fidelity landing, quote/setup and delivery-confirmation wireframes against actual protocol/authority boundaries.
2. Build the semantic public/static composition and the shared shell/tokens; verify keyboard and narrow-screen behavior before adding effects.
3. Implement the real account/quote/readiness path and independent backend/circuit checks. Do not let a clickable mockup close B-09.
4. Implement merchant delivery, buyer review, receipt and operator exception paths with actual state assertions.
5. Add one licensed motion/hero enhancement only after the underlying task remains usable without it.
6. Capture matching desktop/mobile, reduced-motion and failure-state screenshots plus short safe flow recordings. Inspect for private data before sharing; label synthetic fixtures and build revision.
7. Run the roadmap's B-09/B-10/B-11 evidence and intended-user comprehension tests. Report assistance, misunderstanding and unsupported device paths—not only successful runs.

### 14.2 Free internal annotation workflow

Agentation is a **developer annotation tool**, not a buyer feature or a replacement for accessibility/behavior tests. Its [basic installation][agentation-install] supports local copy/paste feedback without an MCP server. The [registry release][agentation-package] has React/React DOM peers and no declared runtime dependencies, but the package still adds code and must be counted as optional development tooling. Zero declared dependencies is not zero bundle weight.

Use a separate development-only import/entry and an explicit build guard; assert that production output contains no toolbar, annotation storage, endpoints or sourcemaps exposing internal source paths. Do not rely on a hidden toolbar or merely moving the package to `devDependencies`. Keep it on isolated synthetic fixtures. Annotations may capture page text, selectors, styles and source context: inspect/redact before giving them to any hosted agent. No real brief, image, account, OTP, token or capability in feedback.

The official site's commercial-redistribution warning and the shipped PolyForm terms do not justify a blanket open-source/permissive claim. Keep the free internal workflow isolated; review terms explicitly before any wider redistribution. If unavailable, plain reviewed screenshots plus selector/expected/actual notes are sufficient—do not build a competing annotation platform.

### 14.3 Required review matrix

| Surface | Evidence before claiming it works |
| --- | --- |
| Landing/demo | Safe licensed assets, useful first frame, no wallet/auth SDK in public entry, supported graphics fallback, no invented commercial proof |
| OTP/access | Actual provider and Convex membership behavior, reauth/resume, access denial and identity-switch cleanup |
| Quote/setup | Correct frozen terms, readiness/recovery before hold, unsupported-wallet path, explicit fees/recipients and no second app login |
| Order/delivery | Independent state/freshness assertions, protected bytes/digests, immutable version, mobile reading and failed verification |
| Approval/payment | Exact consent; rejected/ambiguous submission; confirmed approval with pending/failed/successful capture independently represented; approaching/expired hold, stale observation and no same-order replacement |
| Merchant/operator | Role denial, deadline boundaries, immutable upload/submission, full-resolution limits and no admin bypass |
| Account/recovery | Two actors/orders/tabs, scoped restore conflict, no secret leak, valid lost-capability/read-only path |
| Visual polish | Shared tokens, contrast/focus/reflow, reduced motion, repeat mounts and no scene/resource leak, safe matching media |

The implementation handoff must include component provenance, exact build/dependency evidence, state assertions, unmet gates and safe media. No visual artifact, AI verdict or completed animation can replace a real wallet/proof/payment result. These documents remain R0 until the roadmap's executed evidence establishes otherwise.

### Sources

[awwwards]: https://www.awwwards.com/about-evaluation/
[threeui]: https://threeui.com/
[originkit]: https://www.originkit.dev/
[orbs]: https://orbs.jakubantalik.com/
[transitions]: https://transitions.dev/
[beautiful]: https://beautiful-ui-five.vercel.app/
[twentyone]: https://21st.dev/
[twentyone-terms]: https://21st.dev/terms
[aceternity]: https://ui.aceternity.com/components
[aceternity-license]: https://ui.aceternity.com/licence
[aceternity-terms]: https://ui.aceternity.com/terms
[gallery]: https://component.gallery/
[gallery-about]: https://component.gallery/about/
[agentation]: https://www.agentation.com/
[agentation-install]: https://www.agentation.com/install
[agentation-package]: https://registry.npmjs.org/agentation/3.0.2
[threeui-license]: https://github.com/MengTo/threeui/blob/68802d5428071ada5c20db8094b1649e6bb770ed/LICENSE
[threeui-assets]: https://github.com/MengTo/threeui/blob/68802d5428071ada5c20db8094b1649e6bb770ed/ASSET-LICENSES.md
[threeui-terms]: https://threeui.com/terms
[shelf-page]: https://threeui.com/hero/complete-shelf-landing-page
[shelf-source]: https://github.com/MengTo/threeui/blob/68802d5428071ada5c20db8094b1649e6bb770ed/public/landing-pages/complete-shelf-v2.html
[originkit-integration]: https://www.originkit.dev/integrations
[originkit-dot]: https://www.originkit.dev/components/dotmatrix
[orbs-source]: https://github.com/Jakubantalik/thinking-orbs
[orbs-package]: https://registry.npmjs.org/thinking-orbs/0.3.1
[transitions-source]: https://github.com/Jakubantalik/transitions.dev/blob/74e572345d809f981250938208bd991314c2e780/LICENSE
[transitions-terms]: https://transitions.dev/terms.html
[beautiful-license]: https://www.beautifului.dev/license
[beautiful-source]: https://github.com/TurboKach/ai-native-react-components/tree/05dab2d2b5f1f3e40029776e339a486d70491079
[agentation-license]: https://registry.npmjs.org/agentation/-/agentation-3.0.2.tgz
[dialog-pattern]: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
