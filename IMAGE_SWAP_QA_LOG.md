# Milo image-swap QA & decision log

Session: SVG/synthetic → real photography replacement  
Date: 2026-02-20  
Status: T7 executed; T8–T10 decisions recorded

---

## Scope already shipped

- 21 product pack images (600×720) replaced with photoreal still-lifes
- Gap fills: `studio-cover.png`, `avatar-{buyer,merchant,operator}.png`, `closing-cta.png`
- Brand SVGs kept: `favicon.svg`, wordmark asterisk
- Hashes / alt text / artwork README updated
- Commits: `e8e85e8`, `ddce93f` (milo-main)

---

## T7 · Visual QA in browser

**Pick:** A — Playwright golden path  
**Env:** dev server `http://127.0.0.1:3000`, Playwright CLI, 1280×720 viewport  
**Routes:** `/`, `/demo`, `/orders`, `/m/north-studio`

### Asset probes (pre-browser)

| URL | Status |
|---|---|
| `/` | 200 |
| `/images/hero.png` | 200 |
| `/images/closing-cta.png` | 200 |
| `/images/avatar-buyer.png` | 200 |
| `/images/studio-cover.png` | 200 |
| `/demo` | 200 |
| `/m/north-studio` | 200 |

### Screenshots

Stored under `/home/eya/milo/.playwright-cli/` (Playwright default):

| File | Route |
|---|---|
| `page-2026-09-22T00-03-53-041Z.png` | `/` home |
| `page-2026-09-22T00-03-58-414Z.png` | `/demo` |
| `page-2026-09-22T00-04-04-160Z.png` | `/orders` |
| `page-2026-09-22T00-04-09-965Z.png` | `/m/north-studio` |

### Console

Clean on all four routes. Only Bun HMR + React DevTools info. No image 404s, no CSS errors.

### Route remarks

**`/` home — PASS**
- Hero product photo (olive ceramic vessel) reads as real still-life; polaroid stack + detail card + “m” seal work.
- Sample order caption and violet tag legible over photo.
- Wordmark SVG intact.

**`/demo` — PASS**
- Photoreal vessel in delivery preview; scope copy matches Still pack.
- Context selector (“Commerce imagery”) present.
- Persistent “Synthetic sample · no wallet…” banner retained (prototype honesty — correct).

**`/orders` — PASS**
- Order thumb is the photoreal hero; alt/label consistent.
- **Avatar photo works** — buyer avatar shows circular photo crop in sidebar (`Alex · Still Studio`).
- Page heading shows violet focus ring in capture (Playwright focus on title; not a product bug).

**`/m/north-studio` — PASS with remark D1**
- Studio cover loads (warm wall / window light visible).
- Composition: empty wall dominates the top of the 3:2 frame; at 720px viewport the shelf/vessels sit below the fold and the panel can read as “blank white” in a first-viewport shot.
- Text panel and CTA below cover are intact.

### Defects / remarks

| ID | Severity | Finding | Suggested fix (not applied) |
|---|---|---|---|
| **D1** | Low | Studio cover top third is empty wall; short viewports look sparse | `object-position: center bottom` on `.studio-cover`, or re-gen with subject higher |
| **D2** | Info | Closing CTA photo band is below the fold on `/` at 720px — not in first-viewport capture | Full-page screenshot or scroll-to-CTA pass |
| **D3** | **Fixed this pass** | CSS `url("/images/…")` broke Bun CSS resolve (`Could not resolve`) | Switched avatars to inline `backgroundImage`, CTA to `--cta-photo` CSS variable set in HTML |
| **D4** | Info | Violet outline on `PageTitle` in captures | Likely `:focus-visible` from automation; confirm manually if unwanted |

### Verdict

**Visual QA: PASS** with D1 (composition) and D2 (not captured). No broken images, no console errors. Gap-fill wiring is live.

---

## T8 · `product-frame` (landing CSS UI mock)

**Pick:** A — keep CSS mock (intentional static preview)

| Variant | Decision |
|---|---|
| A. Keep CSS mock | **Chosen** — honest “static preview”, no false live-app claim |
| B. Static UI screenshot | Rejected — looks dead, hard to maintain |
| C. Interactive embed | Rejected — heavy, contradicts static preview |

**Remarks:** No product-code change. Design concept stays CSS.

---

## T9 · `privacy-band` (flat ink)

**Pick:** A — keep flat `--ink` for now

| Variant | Decision |
|---|---|
| A. Keep flat ink | **Chosen** — calm, text legible |
| B. Reuse CTA photo + scrim | Optional later for visual consistency |
| C. New privacy still-life | Optional later |

**Remarks:** No product-code change this pass.

---

## T10 · Helpers & generated intermediates

**Pick:** A — keep gitignored on disk

| Variant | Decision |
|---|---|
| A. Keep ignored on disk | **Chosen** — easy re-run of install scripts |
| B. Delete after use | Rejected — lose regen path |
| C. Commit under `scripts/` | Rejected unless CI regen is needed |

**Remarks:** `install_*.py`, `fix_newlines.py`, `start_dev_qa.sh`, `run_visual_qa.sh`, `generated-*.png`, `.playwright-cli/` stay untracked/ignored.

---

## Decision summary

| Task | Action | Edit product? | Result |
|---|---|---|---|
| T7 Visual QA | Playwright 4 routes | CSS path fix only (D3) | **PASS** |
| T8 product-frame | Keep CSS mock | No | Decided |
| T9 privacy-band | Keep flat | No | Decided |
| T10 helpers | Keep ignored | No | Decided |

---

## Open follow-ups (not this pass)

1. **D1** — reframe or `object-position` studio cover for short viewports
2. **D2** — full-page / scroll capture of closing CTA band
3. Optional T9-B — privacy-band photo if visual parity with CTA is wanted
4. Optional T8-B — product-frame screenshot if product wants realism over concept

---

## Tooling notes

- Dev: `sh scripts/with-bun.sh --hot scripts/dev.ts` → `:3000`
- Playwright wrapper: `~/.codex/skills/playwright/scripts/playwright_cli.sh` (npx `@playwright/cli`)
- Do **not** put `url("/images/…")` in bundled CSS; use inline styles or CSS variables from HTML/JSX
