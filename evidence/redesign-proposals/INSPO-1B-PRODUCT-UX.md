# Inspo pass 1B — product UX ([Inspo product UX flows](d3565b5f-1618-4d50-be2d-9ecc1104e99d))

## Verdict

Quiet document UI. Linear-style magic link. Shopify-style order rows. One confirmation sheet. Phase chips + payment as **words**. No glass. No dark fintech kits. No pricing grids.

## Adopt

- Auth: same sheet email → “Check {address}”; wallet secondary; no OTP theater
- Orders: one-link rows; phase chip; amount tabular; “your turn” = 6px dot
- Modals: one square white sheet; verb title; consequence; fact rows; money dialogs no scrim-dismiss
- Proof = drawer ~420px; receipt = document not success modal
- Chips = phase only; payment caption under phase bar; cancelled muted not red
- 404 / empty: one heading, one sentence, one action
- Legal: ~65ch document template, contents + prose

## A11y upgrades (on top of existing skip/focus/rmotion)

1. Move focus to `#main` / `#workspace` (`tabindex="-1"`)
2. Inset focus ring on order row links (overflow clips today)
3. Row accessible name: title, phase, amount, time
4. Live regions: link sent, phase change, payment word; `aria-busy` on send
5. Dialogs: `alertdialog`, restore focus
6. 44px hit targets on icon-only close/dismiss
7. Phase bar as ordered list with named current step
8. Announce success sentence, not seal animation

## Explicit rejects

Glass UI · dark chrome · neon · wallet-as-identity · green “paid” on hold · confetti/wax/ink splatter · mono-everything · pricing furniture

## Fix queue (after pass 1A/1C + loop tick 2)

Priority engineering once synthesized: skip-focus move, row a11y name + inset ring, dialog semantics, payment-as-words caption, 44px dismiss targets.
