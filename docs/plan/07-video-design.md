# Milo — post-MVP launch-video design

> **R0 production specification · 7 September 2026.** This is an actionable
> plan for a future launch video, not a claim that Milo or its integrations are
> implemented, verified, deployed, usable by customers, or ready to market.

## Contents

1. [Purpose and decision](#1-purpose-authority-and-decision)
2. [Product truth](#2-product-truth-that-the-film-may-communicate)
3. [Evidence gate and manifest](#3-evidence-gate-and-a-single-production-manifest)
4. [Audience, hook and CTA](#4-audience-hook-and-cta)
5. [Visual system and wireframes](#5-visual-system-and-screen-treatment)
6. [52-second master](#6-milo-approval-film--52-second-master)
7. [15-second teaser](#7-milo-approval-teaser--15-second-vertical-cut)
8. [Script, captions and media](#8-script-captions-audio-and-safe-media)
9. [Production stages](#9-production-stages-and-sign-off)
10. [Free local workflow](#10-selected-free-local-hyperframes-workflow)
11. [Acceptance and remaining decisions](#11-acceptance-criteria-and-open-questions)

## 1. Purpose, authority and decision

Produce a concise, evidence-led Milo launch film after the real MVP is ready.
Its job is to help buyers and independent creative providers understand a
shared order journey across service contexts: agree scope, submit a delivery,
decide deliberately, and retain a clear approval record. Start distribution
with launch teams; do not mistake the first audience for the product boundary.

The film is a marketing artifact. It does not add an application capability,
change an order state, verify artistic quality, settle a payment, or prove that
no authorized party can access a brief.

| Authority | Owns | Video must follow |
| --- | --- | --- |
| [01 blueprint](01-blueprint.md) | Product boundary, protocol, privacy, dependencies | Private/public/application state separation and selected architecture |
| [02 roadmap](02-roadmap.md) | Sequencing and release evidence | Build/readiness gates and truthful release labels |
| [03 building guide](03-building-guide.md) | Engineering and commercialization judgment | Claim discipline and evidence ownership |
| [04 UI design](04-ui-design.md) | Routes, tokens, screen composition and visual provenance | Warm-paper system, static-first landing and sealed-card motif |
| [05 UX design](05-ux-design.md) | Journeys, consent, recovery and service design | Buyer/merchant handoffs and recovery visibility |
| [06 backend design](06-backend-design.md) | Execution, observations, files and operations | No invented state, payment result or backend capability |

**Selected direction:** create a 52-second **Milo approval film** as the
horizontal master and a separately composed 15-second **Milo approval teaser**
for vertical placements. Build only after final scripting and captures are
approved by a real-MVP evidence packet. Use local HyperFrames CLI `0.8.30` in a
separate marketing project, with no paid or hosted rendering workflow selected.

## 2. Product truth that the film may communicate

Milo is an invite-only, merchant-led private commissioning workflow. The
[seven service contexts](01-blueprint.md#14-seven-service-contexts) share one
initial capability profile: one buyer, one merchant, one fixed-price three-image
delivery, bounded approval or cancellation, confidential agreed terms, and
external payment processing. Context breadth is not demonstrated availability.

The film may say:

- **Private agreements. Clear approvals.**
- The buyer sees scope, recipient and deadline before agreement.
- Terms are checked without being published on the ledger.
- The merchant receives a bounded brief and submits an identified delivery.
- The buyer reviews the delivery and records an approval or follows a bounded
  alternative route.
- Approval and external payment status are separate facts.
- An interrupted action returns the participant to a valid next step.

The film must not say or imply:

- that nobody—including Milo, the authorized merchant or a proving service—can
  ever receive private data;
- guaranteed, instant, irreversible, escrowed or automatic payment;
- trustless or objective verification of subjective creative quality;
- a universal wallet, marketplace, anonymous service, AI creative generator,
  token investment product or autonomous purchasing agent;
- a completed security audit, certification, customer outcome, partner approval
  or availability beyond the recorded release label.

## 3. Evidence gate and a single production manifest

The proposed storyboard is useful now. **Final scripting, product capture,
assembly and public release must wait** for the approved evidence packet below.
Use one small `production-manifest.yaml` rather than two drifting CSV ledgers.
It has three lists: `claims`, `assets`, and `evidence`.

Production starts post-MVP, after the [R3 controlled-pilot-candidate evidence](02-roadmap.md#31-name-the-level-actually-achieved), not after a clickable mockup. This still means test-mode/developer-preview claims unless R4 separately permits live use. A submission's raw technical walkthrough has its own rubric requirements; this polished optional film does not replace it or delay the protocol critical path. No actual captures exist under this specification.

### 3.1 Evidence required before final script and capture

1. Release commit SHA, lockfile fingerprint, build identifier and capture date.
2. Supported environment, network and wallet profile.
3. Passing Compact compilation, proof generation and local-network order flow.
4. Buyer and merchant happy paths using approved synthetic fixtures.
5. Observed order state and separately observed test-payment outcome.
6. Interrupted-action recovery and one invalid/blocked-action recording.
7. Accessibility review covering caption readability, focus, contrast, reflow
   and reduced-motion behavior.
8. Explicit Preview status: verified, local/developer-only, or blocked, with
   the exact qualifier selected for the end card.
9. Written rights/approval for every person, name, logo, product image, voice,
   music, screen recording and third-party component visible in the output.

If the real protocol/QA evidence is not ready, retain the storyboard as design
work but do not create footage that resembles a working product. A concept reel
is possible later only with an always-visible "Concept" label and no product
claims.

### 3.2 `production-manifest.yaml` minimum shape

```yaml
release:
  commit: ""
  lockfile_sha256: ""
  capture_environment: ""
  service_version: "image-pack-v1"
  demonstrated_case_ids: []
claims:
  - wording: "Terms are not published on the ledger."
    evidence_id: ""
    approved_by: ""
assets:
  - id: ""
    source: ""
    license_or_release: ""
    sha256: ""
evidence:
  - id: ""
    release_sha: ""
    capture_date: ""
    redaction_reviewed_by: ""
```

Each claim used in a frame, caption, narration line, thumbnail, metadata
description or CTA must have an evidence ID and approval. Each source image,
font, voice, track, logo and capture needs an asset/evidence entry. This one
file prevents duplicate claim/asset registers while keeping their different
reviews traceable.

`demonstrated_case_ids` references the blueprint's canonical matrix and the
roadmap's actual evidence. A public sample, illustrative montage or reused
asset does not add a demonstrated case. Each case claim needs matching
release-pinned flow evidence; do not copy a second readiness catalogue here.

For any advisory-review footage, record the [canonical configuration](01-blueprint.md#38-review-assistance-and-agent-operated-prototypes), consent evidence and one source label: **human-assisted order**, **synthetic live-testnet agent actors** (isolated test signers; no real user funds or private data), or **scripted fixture demonstration**. Keep that label visible whenever the distinction affects the claim. A real testnet transition may follow a scripted proposal: record chain-live evidence separately from inference-live evidence. Only an actual recorded model call supports a live-inference claim. A shared provider can perform live inference but does not establish independent adjudication; its suggestion is neither approval nor payment evidence.

Do not show an invocation unless its consent disclosure, redaction review and
current model/provider record are in the manifest. Prefer a boundary graphic to
filming sensitive content merely to demonstrate a model-assisted step.

### 3.3 Claim wording choices

| Verified evidence | Allowed wording | Never shorten to |
| --- | --- | --- |
| Private-term Compact check | "Agree terms privately" | "No one can see your terms" |
| Order receipt observed | "Know what was approved" | "Never dispute work again" |
| Test-payment reconciliation | "Payment status stays separate" | "Payment is guaranteed" |
| Recovery captured | "Return to the next valid step" | "Nothing can go wrong" |
| Preview gate passed | "Explore the verified preview" | "Ready for everyone" |

## 4. Audience, hook and CTA

**Primary audience:** small launch teams commissioning a product-image pack and
independent creative providers delivering it. The broader framing includes all
seven contexts, but the film follows one evidenced order deeply rather than
claiming seven ready-made vertical products. Their shared problem is scattered
agreement, files, approval and payment coordination—not a desire for another
wallet or protocol dashboard.

**Core hook:** *Creative work deserves a clear yes.*

**Value proposition:** *Private agreements. Clear approvals.*

Choose exactly one final CTA after the evidence gate. The end card must include
its corresponding availability qualifier in readable text; do not mix rows.

| Release condition | CTA | Required on-card qualifier |
| --- | --- | --- |
| Invite-only pilot actually open | **Request a pilot invitation** | Invite-only pilot |
| Verified test-mode product footage available | **Watch the product walkthrough** | Developer preview · synthetic test order |
| Public interactive sample available | **Explore a sample order** | Synthetic sample · no wallet, payment or transaction |
| Product not yet market-ready | **Read the product brief** | Concept / under development |

Do not use "Start free," "Join thousands," "Get paid instantly," "secure your
payment," "no wallet needed," "private by default," or "trustless approval"
without separately established, plain-language evidence for the full claim.

An end-card graphic is not a clickable application control. Pair the exported video with a real accessible link on the hosting page or in its description, matching the selected CTA and approved destination. Do not link to an ephemeral private sandbox, a private quote or an unapproved signup promise. On Milo's landing, retain **Explore a sample order** as the primary action and keep the optional film secondary.

## 5. Visual system and screen treatment

Use the UI specification's paper surface, dark ink, one restrained violet
action and editorial typography. The original visual device is a **sealed order
card** opening into three delivery images. It represents a bounded private
agreement; it does not depict universal secrecy or payment finality.

Use actual product pixels only where product behavior is claimed. Use original
constructed graphics for transitions, generic fragmented-workflow context,
privacy-boundary explanation and the end card. If a constructed frame could be
mistaken for a product screen, label it **Illustration**.

Avoid coin imagery, token tickers, chain maps, fake activity feeds, terminal
screens, decorative random WebGL, forced autoplay, tiny text and visual effects
that conceal consent consequences. The landing must remain useful without video,
JavaScript animation or WebGL; video is optional supporting evidence.

### 5.1 Shot asset and layout direction

| Asset / shot | Layout direction | Required treatment |
| --- | --- | --- |
| Seal intro | Centered card at 56–64% frame width on paper; title upper-left | One quiet split/reveal; 2-second readable dwell |
| Fragmented workflow | Three equal, deliberately generic panels collapse toward card | No copied third-party app UI or real messages |
| Landing/sample modal | Real capture inside a 16:9 browser crop; paper matte around it | Synthetic sample; preserve actual interactive hierarchy |
| Terms review | Crop to scope, recipient, deadline and consent consequence | Redact private values; no wallet/address/browser chrome |
| Privacy boundary | Full-frame original two-column card: "Not published" / "Authorized records" | State limit plainly; no opaque-data fantasy diagram |
| Merchant delivery | Three 4:3 synthetic image tiles in a calm grid | Show identified delivery; no unlicensed customer work |
| Buyer review / receipt | Focused screen capture, then receipt at 70% frame width | Keep approval and payment status visually separate |
| Recovery | Single screen state with the valid next action highlighted | Never simulate success after an interruption |
| End card | Mark, selected CTA, availability qualifier and optional URL | One action; no QR unless later tested and approved |

### 5.2 Original wireframe A — sample-modal framing

```text
┌─────────────────────────────────────────────────────────────────────┐
│ DIMMED LANDING CONTEXT — visible, not interactive                    │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ SAMPLE ORDER · no wallet, payment or transaction     Close × │   │
│  │ Scope → Delivery → Approval                                 │   │
│  │ [selected synthetic image]       Scope and rights           │   │
│  │ [image 1] [image 2] [image 3]     Shared/public explanation  │   │
│  │ Previous                       [See how approval works]    │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

This is a framing proposal, not a replacement UI or evidence the sample exists. Follow the [actual modal design](04-ui-design.md#44-interactive-landing-demo--the-product-inside-the-page) when it is built; background controls remain inert. Film captures must not change the product's behavior merely to match this composition.

### 5.3 Original wireframe B — end CTA frame

```text
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│                         [ sealed Milo card ]                        │
│                                                                     │
│                  Private agreements. Clear approvals.               │
│                                                                     │
│                  [ Explore a sample order ]                         │
│         Synthetic sample · no wallet, payment or transaction         │
│                                                                     │
│                     milo.example / approved URL                     │
└─────────────────────────────────────────────────────────────────────┘
```

Replace the shown CTA, qualifier and URL only through the selected release row.
This frame is constructed graphics, not evidence of a released endpoint.

## 6. Milo approval film — 52-second master

**Format name:** `milo-approval-film-52s-16x9`
**Proposed canvas:** 1920 × 1080, 30 fps, 52 seconds. These are production
decisions, not a claim of any distributor requirement. Keep essential copy
inside a conservative 10% edge safe zone until final channel checks.

| Time | Picture | On-screen copy | Narration / sound | Evidence class |
| --- | --- | --- | --- | --- |
| 0:00–0:04 | Seal enters on paper. | **Creative work deserves a clear yes.** | "Creative work deserves a clear yes." Soft paper/seal sound. | Original graphic |
| 0:04–0:09 | Seven-context artwork mosaic folds into one order card. | Different commissions. One agreement. | "Different commissions. One private agreement." | Illustration, visibly labelled concept examples |
| 0:09–0:15 | One release-pinned order workspace. | Private agreements. Clear approvals. | "Milo brings scope, delivery and approval into one private commissioning workspace." | Real synthetic test-order capture, not the public sample |
| 0:15–0:21 | Terms review before consent. | See scope before you agree. | "See the work, recipient, rights and deadlines before agreeing to the exact terms." | Release capture |
| 0:21–0:29 | Actual changed-terms rejection and public/private explanation. | Changed terms rejected. Private terms stay off the ledger. | "Midnight checks the agreement without publishing private terms. Changed terms are rejected." | Same-release circuit rejection capture plus boundary graphic |
| 0:29–0:34 | Merchant submits three synthetic images. | A bounded brief. An identified delivery. | "The merchant submits three images, bound to an identified delivery." | Release capture |
| 0:34–0:40 | Buyer reviews and opens approval summary. | Review the delivery. Decide deliberately. | "Review the exact files and usage rights, then choose approval or dispute." | Release capture |
| 0:40–0:45 | Approval record; payment remains separate. | Approval recorded. Payment status separate. | "Approval is recorded. Payment stays separate and can still fail." | Release capture |
| 0:45–0:49 | Interrupted order returns to next step. | Interrupted? Return to the next valid step. | "Interrupted? Return to the next valid step." | Release capture |
| 0:49–0:52 | End CTA composition. | Selected CTA + qualifier. | Selected CTA; optional music resolves. | Original graphic |

The recovery beat is required for truthful service framing. If timing must be
cut, reduce the opening illustration before deleting recovery or consent detail.

The mosaic is a breadth cue, not seven tiny paragraphs to read in five seconds.
Use recognisable original artwork and one caption; make the full family list
available as page text. Labels remain visible for any unevidenced context.
The detailed flow uses UC-01 or UC-13 only after its evidence exists. The
negative-control insert uses a separate synthetic test fixture from that same
release; it must not imply the user's normal order was silently modified.
If the rejection/boundary beat is unreadable, shorten the montage and retime
the master rather than fabricate a badge. The longer technical walkthrough
supplies raw contract, byte-integrity and payment evidence independently.

If an advisory panel appears, show its “Advisory — not verified” state and the
human's separate decision, or omit it. Never cut a suggestion into evidence of
quality, a model-approved dispute, automatic payment, or an autonomous
real-order signature.

## 7. Milo approval teaser — 15-second vertical cut

**Format name:** `milo-approval-teaser-15s-9x16`
**Proposed canvas:** 1080 × 1920, 30 fps, 15 seconds. Compose this independently;
do not crop the horizontal master. Hold captions above the lower-quarter UI
zone, then verify channel overlays at publication.

| Time | Picture | Text / voiced line |
| --- | --- | --- |
| 0:00–0:03 | Seal opens. | "Creative work deserves a clear yes." |
| 0:03–0:07 | Terms then three-image delivery. | "Agree the scope privately. Review the delivery clearly." |
| 0:07–0:11 | Approval summary and receipt. | "Know what was approved." |
| 0:11–0:15 | End card. | Selected CTA plus exact availability qualifier. |

The teaser omits payment and recovery rather than oversimplifying them. It is a
proposition teaser, not a complete product demonstration.

## 8. Script, captions, audio and safe media

The master target is roughly 90–105 spoken words at an unhurried pace. Write
the final script after evidence approval and time scenes to the approved audio,
not to this draft.

> Creative work deserves a clear yes. Different commissions. One private
> agreement. Milo brings scope, delivery and approval into one private
> commissioning workspace. See the work, recipient, rights and deadlines
> before agreeing to the exact terms. Midnight checks the agreement without
> publishing private terms. Changed terms are rejected. The merchant submits
> three images, bound to an identified delivery. Review the exact files and
> usage rights, then choose approval or dispute. Approval is recorded. Payment
> stays separate and can still fail. Interrupted? Return to the next valid
> step. [Selected CTA].

- Captions are mandatory with narration. Use sentence/phrase captions, clear
  contrast backing and no color-only meaning. Create a reviewed caption export
  and an open-caption social version after a channel is chosen.
- The film must work muted. If narration is not approved or clear, publish the
  silent/captioned version rather than synthetic voice.
- A human narrator needs a recorded performance/reuse release. A generated
  voice needs provider-rights, disclosure-policy and brand approvals; local
  generation capability alone does not grant commercial rights.
- Music is optional. Use only an approved instrumental with a retained license,
  source hash, territory/media terms, attribution requirement and cue sheet.
  Mix beneath narration or omit it.
- Use synthetic businesses, creative images, prices and dates. Any real person's likeness or voice needs explicit reuse approval. Show only reviewed synthetic commercial terms/amounts when necessary to understand consent; exclude real private terms, personal/account data, wallet material, API keys, cookies, provider IDs, browser notifications, query strings, logs and recovery material. Inspect every frame, not just the poster.

## 9. Production stages and sign-off

1. **Static storyboard:** approve the two wireframes, selected CTA row, shot
   list, truth boundaries and representative copy as design—not footage.
2. **Evidence and capture:** satisfy §3; capture a release-pinned synthetic
   environment and redact each source before it enters the video project.
3. **Assemble:** combine frozen captures and original graphics using the
   approved script, captions and audio decision.
4. **Check and render:** use the selected local CLI workflow below; inspect
   structural checks, render logs and the intended encoded outputs.
5. **Frame/privacy review:** review every frame at 100% scale against the
   production manifest; approve claims, caption meaning, license/release rights,
   redaction, CTA qualifier and public metadata before distribution.

One product/truth owner and one privacy/rights owner must sign the same manifest
before public release. This is two distinct review responsibilities, not a
second duplicate inventory.

## 10. Selected free local HyperFrames workflow

### 10.1 Scope and dependency boundary

Reuse one scene set for the master and vertical teaser: context montage, order
card, terms/verification insert, delivery review, receipt, recovery and CTA.
Share reviewed tokens, synthetic assets and claim wording with the UI design,
not authenticated React components, runtime imports or provider trees. Freeze
local exports/captures and their hashes before assembly. A different audience
can change an approved opening asset or caption without seven renderer projects;
each exported variant still needs its own claim, timing and privacy review.

Use the **CLI rendering path**, not a producer/server API: planning candidates are `hyperframes@0.8.30` and separately declared `gsap@3.15.0` for the authored timeline. Put them in an isolated `marketing/video/milo-approval-film/` project with its own manifest/lockfile and no app import or workspace-hoisting dependence. Node must satisfy `>=22`; reusing the blueprint's reviewed Node tooling avoids another runtime installation if it passes the canary. Count FFmpeg/FFprobe, the browser binary, fonts and their actual versions/builds separately. None is an app runtime dependency, but all belong in the full enabled-tooling inventory.

The post-MVP renderer remains separately counted from the prototype. Film hosting may use only the [canonical free-tier deployment decision](01-blueprint.md#610-free-tier-deployment-and-spending-boundary) after its asset/quota gate; no paid hosting, rendering or delivery fallback is approved. A locally rendered file and a free eligible host are separate decisions, neither proof that the product is live.

Do not rely on promotional credits or an unverified model allowance to release
or demonstrate an integration; use a labeled synthetic fixture until the
canonical no-spend gate permits a live configuration.

GSAP is available without a paid plan under its own [standard license][gsap-license], not MIT/Apache. Its restriction on competing visual animation builders matters: this project authors a film, not a customer animation editor. Preserve notices, verify the exact package license and review the distribution method before vendoring source. No paid plugins, generated voices or template assets are required.

Do not install `@hyperframes/producer` by default. It is unnecessary for the
selected CLI workflow. If a later isolated marketing project needs its program-
matic API, it may add `@hyperframes/producer@0.8.30` after a focused design,
security, licensing and operational review. That exception belongs only to the
marketing project; it is not an application dependency or browser-automation
feature for Milo.

Do not use HyperFrames Cloud, hosted generation, avatars, TTS services, MCP or
an external rendering server for this selected workflow. The source project is
open-source, but optional hosted/avatar/voice/generated-media services can have
separate terms or costs. Local rendering avoids their selected use; it does not
establish their price, availability or suitability.

### 10.2 Current package/source evidence

Evidence retrieved **6 September 2026**:

| Item | Exact finding | Source |
| --- | --- | --- |
| `www.hyperframes.dev` relationship | The direct public page names HyperFrames, identifies author as HeyGen in search metadata, contains a link to `github.com/heygen-com/hyperframes`, and its loaded HTML contains HeyGen/repository references. This is direct supporting evidence that it is a HeyGen HyperFrames surface. | [www site][hf-www], [repository][hf-repo] |
| Documentation | `hyperframes.heygen.com` identifies HyperFrames/HeyGen and points to the same repository. | [Quickstart][hf-quickstart] |
| Source revision | GitHub `main` was `7a2a6917367e6dd7ce22f4c321c4a852dcf58dfd`, dated 2026-09-06T05:18:16Z. | [commit][hf-commit] |
| License | Repository `LICENSE` is Apache License 2.0, copyright 2026 HeyGen, Inc. | [license][hf-license] |
| Selected CLI | npm latest metadata returned `hyperframes@0.8.30`, Apache-2.0, `engines.node: >=22`. | [CLI manifest][hf-cli-npm] |
| CLI renderer cohort | CLI metadata includes `@puppeteer/browsers ^3.2.1`, `puppeteer-core ^25.8.0`, `sharp ^0.35.0`, Hono/node server, esbuild, fontkit and PostCSS. Keep this cohort out of Milo's application workspace. | [CLI manifest][hf-cli-npm] |
| Producer, not selected | npm latest metadata returned `@hyperframes/producer@0.8.30`, `engines.node: >=22`; its package manifest has no `license` field. Its dependencies include `puppeteer ^25.2.1`, `puppeteer-core ^25.2.1`, Hono, PostCSS, `wawoff2`, HyperFrames packages and fonts. | [producer manifest][hf-producer-npm], [license][hf-license] |
| Local rendering | Documentation describes frame-by-frame seek-driven rendering using Puppeteer/bundled Chromium and system FFmpeg. | [rendering][hf-rendering] |
| Authored timeline | npm latest returned `gsap@3.15.0`, no declared runtime dependencies and a standard no-charge license, not a permissive open-source grant. | [GSAP manifest][gsap-package], [license][gsap-license] |

The public `https://hyperframes.dev/` endpoint was observed redirecting to
`https://www.hyperframes.dev/`. The direct `www` page above is the evidence used
here; no unrelated `hyperframes.video` domain is treated as official.

### 10.3 Exact-version operational recipe after review

Do not run these commands in Milo today. Even `--help` through `npx` can download and execute package code; it is not a no-install safety check. After source/install-hook review and §3 approval, inspect the exact release in the isolated production environment:

```sh
npx --yes hyperframes@0.8.30 --version
npx --yes hyperframes@0.8.30 doctor --help
npx --yes hyperframes@0.8.30 check --help
npx --yes hyperframes@0.8.30 render --help
```

Then use the help output recorded from that exact version to confirm the
composition path and output flags. The current official CLI docs identify
`doctor` for environment diagnostics, `check` for structural checking, and
`render` for output creation; they document `--output` for rendering and state
that the installed CLI is the authority for accepted flags. This avoids an
unpinned `npx` recipe or guessed future flags.

The expected project-level operations, only after their exact help output is
attached to the release, are therefore conceptually:

```sh
cd marketing/video/milo-approval-film
npx --yes hyperframes@0.8.30 doctor
npx --yes hyperframes@0.8.30 check .
npx --yes hyperframes@0.8.30 render --output renders/milo-approval-film.mp4
```

The last command's path/options remain an illustrative, version-pinned starting
point, not an assertion that it has been run or will fit a future project.

For repeatable production, install the reviewed exact dependencies into the isolated project and commit its lockfile; run that local CLI binary, not repeated ephemeral installs resolving new transitives. Record/disable the installed CLI's automatic-update behavior using its verified documented controls, and reject an unexpected version change. Freeze all input media, fonts and animation code locally, including the GSAP asset copied from the pinned package with its hash/notices. No unversioned CDN requests at render time. Local output can vary with browser/font/codec versions; compare renders before claiming reproducibility. Docker mode is a separate optional pinned render-environment decision, not required for this selected local workflow or installed by this documentation task.

### 10.4 Verified seekable composition contract

Use the [HTML schema reference][hf-schema] and [GSAP guide][hf-gsap] with the installed release, not a copied demo's CDN script. The concrete authoring contract is:

| Element | Required authoring decision | Check before full render |
| --- | --- | --- |
| Root | Real CSS-sized box; `data-composition-id`, top-level `data-start="0"`, authored width/height and explicit duration | Actual canvas matches 1920×1080/52s or 1080×1920/15s; metadata alone does not size a DOM box |
| Timed scene | Stable ID, `class="clip"`, start, duration and track index per current schema | No unintended gaps/overlaps; captions and CTA remain visible for the intended read time |
| Animation | Paused GSAP timeline registered in `window.__timelines` under the matching composition ID; absolute-time visual-property animation | Seek forwards/backwards repeatedly to the same state; no live scrolling, current clock, unseeded randomness or pointer input |
| Duration | Explicit root duration and deliberately matching full-length timeline/media coverage | Read the encoded duration and final frames; do not assume a 0.4s intro timeline yields a 52s film |
| Media | Frozen local captures and original graphics, manifest hashes and rights | No logged-in app URL, external request, uncontrolled media playback or invented state |
| Output | Target frame rate, format and dimensions through the actual installed CLI's supported controls | 30fps target, correct aspect ratio, no truncated captions/CTA, validated decode and audio sync |

The published GSAP guide links duration to the timeline, while the HTML schema says an explicit root duration is the render length. Keep both consistent and test the pinned CLI rather than concealing this documentation nuance or guessing precedence. Do not animate layout/visibility or script media playback. Inspect beat snapshots and the complete output; no skeleton here is advertised as a rendered or validated film.

## 11. Acceptance criteria and open questions

Release only when both named formats play through, captions and CTA qualify the
actual release, all visible claims map to the single manifest, and the final
frame/privacy review records no sensitive, unlicensed or misleading material.

The remaining decisions are distribution channels, localization, legal
jurisdiction, approved narrator/music policy, final availability URL, and the
actual accepted CLI help output in the isolated production environment. Resolve
them before final scripting/capture, not through visual polish.

No package/skill installation, renderer execution, hosted generation, product capture or video production has occurred. This specification is committed planning work, not runtime evidence.

## Sources

All sources were retrieved or queried on **6 September 2026**; this document's evidence-boundary clarification was revised on **7 September 2026**.

[hf-www]: https://www.hyperframes.dev/
[hf-quickstart]: https://hyperframes.heygen.com/quickstart
[hf-rendering]: https://hyperframes.heygen.com/guides/rendering
[hf-gsap]: https://hyperframes.heygen.com/guides/gsap-animation
[hf-cli-docs]: https://hyperframes.heygen.com/packages/cli
[hf-vs-remotion]: https://hyperframes.heygen.com/guides/hyperframes-vs-remotion
[hf-repo]: https://github.com/heygen-com/hyperframes
[hf-commit]: https://github.com/heygen-com/hyperframes/commit/7a2a6917367e6dd7ce22f4c321c4a852dcf58dfd
[hf-license]: https://github.com/heygen-com/hyperframes/blob/7a2a6917367e6dd7ce22f4c321c4a852dcf58dfd/LICENSE
[hf-cli-npm]: https://registry.npmjs.org/hyperframes/0.8.30
[hf-producer-npm]: https://registry.npmjs.org/@hyperframes/producer/0.8.30
[hf-schema]: https://hyperframes.heygen.com/reference/html-schema
[gsap-package]: https://registry.npmjs.org/gsap/3.15.0
[gsap-license]: https://gsap.com/community/standard-license/
