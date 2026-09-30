# JUDGE-STEPS.md — local demo reproduction (≤10 steps)

Timed path for a judge with Node 24 + Docker + Bun.

1. `git clone <repo> && cd milo-main` (1 min)
2. `sh scripts/setup.sh` (Bun 1.4.2 + deps; 2–5 min)
3. Copy `.env.example` → `.env.local`; fill PRIVY_APP_ID, CONVEX_URL, Stripe test keys (2 min)
4. `bun run test:unit` → expect 493 pass (15 s)
5. `bun run build` → `dist/` (5 s)
6. `bun run dev` → http://127.0.0.1:3000 (1 min)
7. Optional local chain: compose up + `local.mjs` staged bootstrap (see RECEIPTS-LOCAL.md)
8. Open `/demo` and `/orders` (1 min)
9. Read RECEIPTS.md for Preprod contract facts

**Total ≤ 10 minutes** after clone for steps 2–6, 8–9.

## Notes
- No wallet required for demo/landing
- Preprod facts are read-only indexer queries
- Live Stripe capture needs test keys (owner)
