# IMPLEMENTATION-P2-M4 — Stripe manual-capture window vs contract deadlines

**Task:** TODO M4 (`TODO.md`) — Stripe window vs deadlines | fix or doc | mvp  
**Date:** 2026-09-30  
**Status:** RECONCILED (code fix + residual gaps documented)

---

## 1. Research (primary sources)

Primary sources recorded in `audit/discovery/RESEARCH-LOG.md` § "M4 Stripe manual-capture window".

| Fact | Source | Value |
|---|---|---|
| Hold expiry authority | [Stripe place-a-hold](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method) | `charge.payment_method_details.card.capture_before` only — never a guessed window |
| Card-not-present window | same | Visa MIT **5d** (exact **4d 18h**); Visa CIT / Mastercard / Amex / Discover **7d** |
| Card-present window | same | Visa **5d** (4d18h); MC/Amex/Discover **2d** |
| Extended hold | [Stripe extended-authorization](https://docs.stripe.com/payments/extended-authorization) | up to **30d**, brand/region gated; **not used by Milo v1** |
| Expiry effect | place-a-hold | funds released; PaymentIntent → `canceled` |
| `automatic_delayed` | place-a-hold + `01-blueprint.md:680` | can capture without Milo approval — **forbidden** as expiry workaround |

**Product implication:** the whole contract lifecycle (acceptance → delivery → review → dispute resolution) plus `captureSafetyMarginMs` must finish inside the **actual** hold, typically **≤ 4d18h–7d** from authorization (not from quote freeze). Longer commercial SLAs need extended auth (out of scope) or shorter frozen deadlines.

---

## 2. Spec baseline

| Spec | Requirement |
|---|---|
| `01-blueprint.md:678-688` | Read `capture_before`; do not hard-code seven days. Admission: `latestApprovalOrResolutionDeadline + captureSafetyMarginSeconds < capture_before` (strict). Missing/unsupported expiry or insufficient time blocks progress and triggers safe hold reconciliation/void. Recheck at acceptance and capture. |
| `06-backend-design.md:178-184` | Same inequality. Authorization expiry and immutable contract deadlines are different clocks. No automatic refund endpoint. Preserve APPROVED + expired/failed payment as an exception, never counterfeit cancellation/success. |
| `docs/midnight-integration-map.md:206`, `packages/backend/README.md:19` | Documented formula matches. |
| B-06 (`02-roadmap.md`) | Below/equal/above deadline-plus-margin boundaries; hold-window boundaries; capture/void races; external refund/partial/failed incident observations. |

---

## 3. Code audit (pre-fix)

| Layer | Location | Behavior | Verdict |
|---|---|---|---|
| Observe | `packages/backend/src/stripe-observer.server.ts:94-121,173-181` | Reads real `capture_before`; missing → fail closed; `usableUntil = min(captureBeforeMs, observedAt+60s)` | **OK** vs primary |
| Admission | `packages/backend/src/admission-policy.ts:248-254` | `resolutionDeadlineSeconds*1000 + captureSafetyMarginMs >= captureBeforeMs` → reject. Positive margin required (`validTimingPolicy`) | **OK** (strict inequality) |
| Quote freeze | `packages/backend/src/provisioning-policy.ts` `validateFreeze` | Deadlines future + strictly ordered only — **no span cap** vs expected hold | **GAP** (see §5) |
| Capture recheck | `provisioning-policy.ts` `usableObservation` used by `settlement.ts:255` | Required age < 60s and shape; **did not require `now < usableUntil`** | **BUG — fixed** |
| Capture/void effects | `convex/stripeSettlement.ts` | `payment_intents/capture` / `cancel` + idempotency key; 409/425 → ambiguous | OK (D1d) |
| Phase gates | `convex/settlement.ts` `settlementAuthorized` | capture iff APPROVED; void iff CANCELLED | OK |
| Refund / Stripe dispute | observer `:110-135`; `reconciliation.ts` ops `authorize\|capture\|void` | Refunded/disputed charges **blocked** ("needs independent refund/dispute reconciliation"). No refund mutation/endpoint | **Documented residual** (§6) |

---

## 4. IMPLEMENTATION (code fix)

### 4.1 `packages/backend/src/provisioning-policy.ts` — `usableObservation`

Capture and observation publication must land **inside the half-open usable window**
`[usableFrom, usableUntil)`. Age < 60s alone still accepted a hold whose
`usableUntil` (already `min(capture_before, observation TTL)`) had passed — a
capture recheck hole at the Stripe window boundary.

**Fix:** require `now < authorization.usableUntil`.

Call sites covered by the shared helper: `convex/settlement.ts` (capture request),
`convex/paymentMonitoring.ts` (observation publish), `convex/provisioning.ts` (job completion).

### 4.2 Tests — `packages/backend/test/provisioning.test.ts`

New case **"usableObservation refuses past usableUntil even inside the 60s age window"**:
- `now = usableUntil - 1` → true (inside window)
- `now = usableUntil` → false (half-open)
- `now = usableUntil + 15s` (still age < 60s) → false (provider expiry / session cap)
- short `usableUntil` vs later `captureBeforeMs` → false (observation cap wins)

**Verification**

```
sh scripts/with-bun.sh test packages/backend     → 249 pass, 0 fail (was 248 + 1 new)
sh scripts/with-bun.sh test convex               → 100 pass, 0 fail
sh scripts/with-bun.sh test packages/backend/test/provisioning.test.ts
                                                 → 47 pass, 0 fail (new case green)
```

`tsc --noEmit` reports one **pre-existing** unrelated error in
`packages/backend/test/privacy-invariants.test.ts:109` (`constructorVersion: number` vs literal `1`).
Not introduced by this change; left untouched.

---

## 5. Reconciliation matrix (window vs deadlines)

| Clock | Owner | Range | Enforced where |
|---|---|---|---|
| Stripe hold expiry (`capture_before`) | Card network / Stripe | **4d18h–7d** online (ext. 30d unused) | Observer read; never hard-coded |
| Observation freshness | Milo server | 60s (`PAYMENT_AUTHORIZATION_WINDOW_MS`) | `usableObservation` / admission |
| `captureSafetyMarginMs` | Server DB row `admissionTimingPolicies` | must be **> 0** | `validTimingPolicy` |
| Acceptance / delivery / review / resolution deadlines | Frozen quote (immutable) | must be strictly ascending future | `validateFreeze` |
| Admission gate | `decideCanonicalAdmission` | `resolutionDeadline*1000 + margin < capture_before` | `admission-policy.ts:248-254` |

**Below / equal / above boundary (already tested):** `admission-policy.test.ts`
"enforces server timing policy through the complete resolution window" binds at
`captureBeforeMs = 155_001` and rejects at `155_000` / `154_999` (resolution 154s + margin 1s).

**Reconciled:** code matches the primary Stripe source and the blueprint formula.
No hard-coded seven-day assumption exists.

**Documented residual gaps (no silent fix — product/ops decisions):**

1. **Freeze-time span cap missing.** `validateFreeze` accepts any future ordered
   deadlines. A quote with resolution 14d out freezes, then **fails at admission**
   once a real ~7d hold is observed. Fail-closed (safe), but the buyer can still
   authorize a hold that cannot satisfy the quote. Product should cap
   `resolutionDeadline − now` against the shortest expected hold (Visa MIT 4d18h)
   or require extended auth. **Do not shorten frozen deadlines silently** (blueprint).
2. **Safe hold void on admission rejection not automated.** Blueprint §5.1:
   insufficient time should trigger safe hold reconciliation/void. Today admission
   rejects the bind only; the Stripe hold is left to expire (`canceled`) or must be
   voided by finance ops. `settlementOps` void opens solely on order phase
   `CANCELLED`. Orphan holds after window-reject are an ops runbook item (PR5/PR8).
3. **Merchant-acceptance recheck** is specified but not a distinct guard beside
   the capture-time `usableObservation` call; acceptance currently rides the chain
   phase + later capture gate. Residual for B-06 full-path proof.

---

## 6. Refund / dispute path

| Concern | Behavior (current) | Spec |
|---|---|---|
| Automatic refund | **None.** No refund endpoint, mutation, or settlement action | `06-backend-design.md:184` — externally authorized finance incidents only |
| Settlement effects | `capture` \| `void` only (`settlementOps.action`) | match design |
| Provider refund/dispute seen on observe | **Fail closed** — `normalizeTestPayment` returns `blocked("Captured payment needs independent refund/dispute reconciliation")` when `charge.refunded` / `amount_refunded` / `disputed` | correct: never treat a refunded/disputed charge as a clean authorization or capture proof |
| Late / duplicate events | `paymentInbox` dedupe `(provider, accountId, eventId)`; event is evidence to re-fetch, never phase authority | `settlement.ts` `recordEvent`/`reconcile` |
| Order-level dispute | Compact circuits `disputeBuyer` / `disputeMerchant` / `resolve` (phase `DISPUTED`) — **separate clock and authority** from Stripe disputes | `06-backend-design.md` MID-T08/T09 |
| Approved + expired hold | Capture refuses (fresh usable hold required). Must surface as **approved/unpaid exception**, never fake `CANCELLED` or success | blueprint §5.1; UI copy already distinguishes expired hold (`docs/drift-audit-2026-09-14.md` D-03) |

**Residual (documented, not coded):** B-06 requires recording externally initiated
refund / partial / failed incidents with provider IDs and decision audit, kept
separate from capture history. `reconciliation.ts` has no `refund` operation type
yet. Owner: financeOperator / production gate PR5. No automatic refund code may
be added without that approval.

---

## 7. Files touched

| File | Change |
|---|---|
| `packages/backend/src/provisioning-policy.ts` | **FIX** — `usableObservation` requires `now < usableUntil` |
| `packages/backend/test/provisioning.test.ts` | **TEST** — half-open usableUntil / past-expiry cases |
| `audit/discovery/RESEARCH-LOG.md` (parent) | **DOC** — Stripe primary sources + code mapping |
| `audit/discovery/IMPLEMENTATION-P2-M4-stripe-window.md` | **DOC** — this report |

---

## 8. Claims discipline

- No live-payment claim. Tests use doubles; Stripe figures come from public docs.
- No hard-coded “seven days” added — only the real `capture_before` path remains.
- Pre-existing `privacy-invariants.test.ts` type error left as found.
- MVP label for M4: **window-vs-deadline reconciliation is code-backed and tested
  at the observation/capture boundary**; freeze-time span cap, orphan-hold void,
  and refund-incident recording remain documented residuals for production gates.
