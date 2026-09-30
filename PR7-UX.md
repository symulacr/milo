# PR7 UX evidence

- skip-link present (PublicShell)
- aria-labels on nav/wordmark
- unit a11y-related tests 18/18 (chrome, demo-boundary, route-parity)
- axe full suite: **DONE** 2026-09-30 — `scripts/pr7-axe.mjs` (axe-core + headless Chrome 151)
  - public-app.html: 0 serious/critical, 0 other (wcag2a/2aa/21a/21aa)
  - index.html: 0 serious/critical, 0 other
  - app.html: 0 serious/critical, 0 other
  - Evidence ID: `obs_pr7_axe_1`
  - color-contrast remains incomplete/manual-review (VERIFICATION.md)
- keyboard-only pass: unit-covered (dialog consent gating, focus return); full route keyboard map not re-run this pass
- 375px: covered in CLICK-MAP (D3a)
- reduced-motion: CSS partial


## R2 residual (PR7 stays open)

- axe `obs_pr7_axe_1` covered 3 HTML entries only (public-app, index, app).
- Still open: every route × state, keyboard-only full map, 375px, Lighthouse budgets.
- M3 UI cells also wait on auth (O-PRIVY-TEST / option C).
