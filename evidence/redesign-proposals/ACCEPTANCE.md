# Milo full-app redesign — acceptance pack (no implementation yet)

**Figma file:** https://www.figma.com/design/C8Xuqj4RAAsEI7PLe7dpQj/Milo-full-app-redesign-frame-pick  
**Cover `1:2`:** ⚠ **DO NOT LOCK** (advisor revised) — bones stay; pink / mint / wax / dark-admin rejected  
**Showreel stage:** `SHOWREEL · Milo 15s` (node `2:10`) — keep as motion sketch only until comps match the light document app  

## Advisor verdict (Grok visual)

**Keep:** Schibsted Grotesk; ultramarine `#1423b8` as brand field; light app (`#f2f4f7` ground, white sheets, ink `#0a0a0a`); yellow as ≤4px printed mark / hold edge; semantic chips (approved green `#247b50`, dispute red); square sheets; phase / revision / payment / role as furniture.

**Reject from motion pack as AFTER locks:** pink `#e9479f`; mint buttons; wax seals / ink splatter (`02`, `04`, `08`); dark admin chrome (`06`); yellow as button or input; using `.taste-skill/app-*` folds as AFTER (those are BEFORE).

**Escalate:** one seal-bar system for publish / reserve / dispute / proof / receipt; one real phase bar (Draft→…→Approved; Disputed/Cancelled end it); payment as words under the bar; marketing↔app chrome split (blue field vs gray document).

## Direction lock (revised — not ready to accept)

| Field | Revised proposal |
| --- | --- |
| Direction | Printed-annual **structure** + light document app (not poster-over-app) |
| Palette | Ultramarine / black / paper / ink; yellow mark only; no pink; green = chip/dot only |
| Type | Schibsted only; sentence case; act eyebrows all-caps 11px |
| Motion | Seal bar draw 240ms; phase fill; proof drawer 420px; reduced-motion = end state |
| Cover | **Do not** reply `ACCEPT cover 1:2` until AFTER comps are regenerated |

Reply when ready: **REGEN AFTER comps under seal-bar system** or **ACCEPT bones only (no frame lock)**.

## Before → After image table

| ID | Surface | BEFORE | AFTER proposal | Advisor status |
| --- | --- | --- | --- | --- |
| P01 | Landing hero | `reel-verified/01-…` | `milo-motion-01-hero-seal.jpg` | revise CTA verb → Sign in; keep headline |
| P01b | Phase story | `01b-…` | `milo-motion-03-phase-bar.jpg` | **reject** as AFTER (false durations + pink) |
| P02 | Sign-in | `02-…` | `milo-motion-08-signin.jpg` | **reject** (magic-link theater) |
| P03 | OTP | `03-…` | needs-comp (same sheet as P02) | needs-comp |
| P04 | Linked | `04-…` | `.taste-skill/app-account/…` | **not AFTER** (is BEFORE) |
| P05 | Connections | `05-…` | needs-comp | needs-comp |
| P06 | New quote | `06-…` | `.taste-skill/app-newquote/…` | **not AFTER** (is BEFORE) |
| M07 | Publish | `07-…` | `milo-motion-04-modal-seal.jpg` | **reject** wax seal; rebuild seal-bar sheet |
| M08 | Reserve | `08-…` | needs-comp (same sheet as M07) | needs-comp |
| P09 | Orders | `09-…` | `.taste-skill/app-orders/…` | **not AFTER** (is BEFORE) |
| P10 | Operator | `10-…` | needs-comp (role word only) | needs-comp |
| P11 | Order + proof | `11-…` | `milo-motion-06-order-flow.jpg` | **reject** dark admin |
| M12 | Dispute | `12-…` | needs-comp (red seal bar) | needs-comp |
| P13 | Receipt | `13-…` | needs-comp (green seal bar) | needs-comp |
| P14 | Privacy | capture | needs-comp | needs-comp |
| P15 | Terms | capture | needs-comp | needs-comp |
| P16 | 404 | capture | `milo-motion-05-404.jpg` | revise copy (no milo.com resources line) |
| CTA | Press | — | `milo-motion-02-cta-ink.jpg` | **reject** as AFTER |
| REEL | Showreel | — | `milo-showreel-15s.mp4` | sketch only until comps match |

## Acceptance checklist (all ten required on each AFTER)

1. Real nouns: phases + payment words + role words  
2. Wordmark `milo` + star  
3. Schibsted only; sentence case except act eyebrow  
4. One field color from ultramarine / black / `#f2f4f7`  
5. Yellow ≤4px mark or hold edge — never button/input/page  
6. Green = `#247b50` chip or 6px dot  
7. Signed-in app on `#f2f4f7` + white sheet + white header  
8. Modals share one square sheet + seal bar + eyebrow + consequence + fact rows  
9. 404 / privacy / terms share wordmark + seal or yellow underline + preprod line  
10. BEFORE and AFTER same viewport and state  

## Motion brief (Grok) — system to implement after lock

Source: motion advisor. Seven motifs:

| Motif | Timing | Trigger |
| --- | --- | --- |
| Mask rise | 640ms `rise`, +80ms/line | First paint / route enter |
| Ink press | 90ms down → 180ms up; 420ms ink burst | Primary pointer |
| Seal bloom | 480ms green disk + 280ms ring; once | Real success only |
| Phase stagger | 220ms/seg +70ms; fill 360ms `hold` | How-it-works / stage change |
| Sheet unseal | 380ms paper rise; 240ms header rule | Modal / proof drawer |
| Field cut | 0ms bg swap; content +40ms | Route change |
| Hash tick | 200ms ×3 +40ms after seal+760ms | Receipt / proof |

Easings: `rise` `cubic-bezier(0.22,1,0.36,1)` · `ink` `(0.16,1,0.3,1)` · `press` `(0.2,0,0,1)` · `leave` `(0.4,0,1,1)` · `hold` linear.

Showreel beats on Figma `2:10`: `beat/title-rise` → `beat/cta-press` → `beat/seal-bloom` → `beat/phase-stagger` (0–15s). MP4: `milo-showreel-15s.mp4`.

### Advisor conflicts — RESOLVED (inspo pass 1C)

| Topic | Resolution |
| --- | --- |
| Cover `1:2` | **Do not lock.** Accept **bones only**. |
| Pink `#e9479f` | **Reject.** Current phase = 4px yellow leading edge; dispute = red seal bar. |
| Green | `#247b50` chip/dot only; no `#1fc27a` bloom disk; no landing seal bloom |
| Three.js / WebGPU / Spline / Lottie | **No.** CSS + one scroll-driven phase rule + View Transitions |
| Hero | Registration sheet on ultramarine; Sign in (not Launch); yellow = hold mark only |
| Motion JPGs 02/04/06/08 | Reject as AFTER; reshoot under seal-bar / registration sheet |

Details: `INSPO-1C-MOTION-TECH.md`, `INSPO-1B-PRODUCT-UX.md`.

## Implementation gate

**Bones accepted by research** (`INSPO-PASS2-SYNTHESIS.md`).  
**Shipped in-repo (pass 2):** black CTAs (no mint); black footer (no pink); Privacy in main nav; hero claim + Sign in; skip targets `tabindex=-1`; order-row inset focus + aria-label; white focus on brand field.  
**Still open:** registration-sheet AFTER comps; dialog `alertdialog` semantics; payment-as-words caption; seal-bar modal unify.  
**Still refused:** Three.js / WebGPU / Spline / Lottie; lock cover `1:2`.
