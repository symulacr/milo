# IMPLEMENTATION-P2-M5M6.md

| Field | Value |
|---|---|
| Task | TODO **M5** (attachUpload provenance + deliveryCommitment/submitDelivery shape) and **M6** (recovery-kit ops UI or justification + no-usable-order) |
| Stage | mvp |
| Date | 2026-09-30 |
| Repo | `/home/eya/milo/milo-main` |
| Evidence criterion | tests (M5); wired or justified (M6) |
| Deliverables | closed URL→storageId provenance + tests; `submitDeliveryArgs` shape equality; `RECOVERY_KIT_OPS` inventory + UI tests; this report |

---

## 1. Outcome

M5 and M6 are complete at the unit/UI-test layer (test-first: failing tests written first, then implementation).

### M5 — attachUpload URL→storageId provenance closed

| Gap (was) | Closure (now) |
|---|---|
| `attachUpload` accepted any unclaimed `storageId` (R-04) | One-time `uploadTicket` minted with `requestUpload` and consumed on bind; wrong/foreign/missing tickets refused before storage lookup |
| No action-based upload | `storeAndAttachUpload` (R-04): authorized action calls `ctx.storage.store` and binds the resulting `storageId` in the same path — no client-supplied id |
| Ticket reuse | Consumed (`uploadTicket: undefined`) on first bind; second attach refused |

Tests: `convex/upload-provenance.test.ts` (7 cases: ticket mint, missing/wrong/foreign ticket, single-use bind, action produces+binds, auth/expiry refusal). Existing `convex/files.test.ts` updated to the ticketed `attachUpload` contract (8 cases still green).

### M5 — deliveryCommitment equals on-chain submitDelivery arg shape

| Surface | Shape |
|---|---|
| `order.compact` | `submitDelivery(expectedRevision: Uint<64>, commitment: Bytes<32>)`; ledger `deliveryCommitment: Bytes<32>` |
| generated TS | `commitment_0: Uint8Array`; `readonly deliveryCommitment: Uint8Array` |
| off-chain | `deliveryCommitment(files)` = 64-hex SHA-256; `deliveryCommitmentBytes32` / `submitDeliveryArgs` produce the exact `Bytes<32>` bytes |

Tests: `packages/contract/tests/delivery-shape.test.ts` (7 cases: digest bytes == commitment bytes, `CompactTypeBytes(32)` round-trip, compact/TS signature parity, Node twin, U64 revision).

### M6 — seven recovery-kit ops wired or justified

Seven ops (`beginOperation`, `resumeOperation`, `confirmOperation`, `abandonOperation`, `loseCapability`, `restoreKit`, `adoptBackup`) now appear in `RECOVERY_KIT_OPS` with `disposition: "ui-wired" | "justified"` and a written detail. Wired: begin/confirm (reserve), loseCapability. Justified: resume, abandon, restoreKit, adoptBackup (and begin/confirm for deploy|submit|approve). Inventory renders in the panel.

No-usable-order holds through UI: domain tests (`packages/domain/tests/recovery-kit.test.ts`) prove only commercial `confirmOperation` sets `usable: true` (deploy confirm, abandon, lose, restore, adopt never do). UI tests (`apps/web/src/recovery-ops-ui.test.tsx`) render every kit state and assert no affirmative usability claim without that confirm; UI confirm fails closed without an observation.

---

## 2. Test evidence

```
bun test convex/files.test.ts convex/upload-provenance.test.ts \
  packages/contract/tests/delivery-shape.test.ts \
  apps/web/src/recovery-ops-ui.test.tsx \
  packages/domain/tests/recovery-kit.test.ts \
  apps/web/src/recovery-kit-panel.test.tsx \
  apps/web/src/order-record-panel.test.tsx \
  packages/backend/test/delivery-integrity.test.ts
→ 62 pass, 0 fail, 301 expect()

bun test apps/web packages/domain packages/contract packages/backend scripts convex
→ 624 pass, 0 fail, 2697 expect()

tsc --noEmit → 1 pre-existing error (packages/backend/test/privacy-invariants.test.ts); 0 from this change
```

---

## 3. Files touched

| Path | Change |
|---|---|
| `convex/files.ts` | `uploadTicket` on grant; `attachUpload` requires/consumes ticket; `storeAndAttachUpload` action (R-04) |
| `convex/schema.ts` | `fileGrants.uploadTicket` optional field |
| `convex/files.test.ts` | attachUpload calls carry the grant ticket |
| `convex/upload-provenance.test.ts` | **new** — URL→storageId provenance suite |
| `packages/backend/src/delivery-policy.ts` | `deliveryCommitmentBytes32`, `submitDeliveryArgs` |
| `packages/contract/tests/delivery-shape.test.ts` | **new** — commitment == submitDelivery arg shape |
| `packages/domain/tests/recovery-kit.test.ts` | **new** — seven-op surface + no-usable-order |
| `apps/web/src/RecoveryKitPanel.tsx` | `RECOVERY_KIT_OPS` inventory (wired/justified); stale SUPERSEDED copy corrected |
| `apps/web/src/recovery-ops-ui.test.tsx` | **new** — seven-op inventory + UI no-usable-order |
| `apps/web/src/order-record-panel.test.tsx` | still green via `UNUSED_RECOVERY_KIT_OPS` alias |

---

## 4. NOT DONE

- **Browser upload of bytes through `storeAndAttachUpload`** — the action exists and is tested against a storage double; no web upload UI calls it yet (merchant delivery UI remains the D-series gap).
- **Ticketed `attachUpload` against a live Convex** — unit doubles only; no deployed-Convex integration receipt.
- **`beginOperation`/`confirmOperation` for deploy|submit|approve** — written justification only; needs order.compact browser call paths (unchanged blocker).
- **`restoreKit` / `adoptBackup` UI** — gated UX (blueprint recovery kit); written justification, domain-tested only.
- **`abandonOperation` / `resumeOperation` UI controls** — intentionally not wired (would imply cancel/retry); justification retained.
- **End-to-end submitDelivery with real `deliveryCommitment` on-chain** — shape equality is unit/provenance-level; no Preprod submitDelivery receipt with a freeze-produced manifest.
- **privacy-invariants.test.ts typecheck** — pre-existing, out of scope.
