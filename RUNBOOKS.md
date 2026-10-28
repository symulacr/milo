# RUNBOOKS.md

## Deploy (test-mode)

**Order matters: backend first, then the frontend built against it.** The old
order here was build → host → deploy Convex, which ships a frontend that can call
a function the backend does not have yet. A missing query shows as an endless
`Loading orders` (a failed `useQuery` is a data error, not a render throw, so
`ServiceBoundary` does not catch it).

1. `npx convex deploy --cmd 'bun run build'` with `CONVEX_DEPLOY_KEY`.
   Convex deploys first, then builds the frontend with the new deployment URL
   injected, so the two cannot skew.
2. Host `dist/` (Vercel). The host needs no build-time env: `/api/public-config`
   is baked from the values Convex already has.
3. Set Convex env **before** step 1 on a first deploy:
   `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `BETTER_AUTH_SECRET`,
   `SITE_URL`, `CONVEX_SITE_URL`, `MILO_OPERATOR_EMAILS`, `MAIL_PROVIDER`,
   `MAIL_FROM`, and the one provider key (`RESEND_API_KEY` /
   `AGENTMAIL_API_KEY` / `BREVO_API_KEY`).
   `MILO_OPERATOR_EMAILS` is not optional: with it unset the daily dead-letter
   digest silently no-ops, so "no alert" and "nothing wrong" look the same.
4. Smoke: `/` `/orders` `/orders/new` `/account`, then one magic-link sign-in.

**Never remove a Convex function in the same deploy that stops calling it.**
Two deploys: stop calling, then delete. An open tab from before the deploy is
otherwise calling a function that no longer exists.

## Rollback
1. `npx convex deploy` the previous git SHA (backend first, same reason).
2. Revert the host to the previous `dist/` **after** the backend is back.
3. Verify the webhook still accepts HMAC.

## Secret rotation
1. Stripe dashboard → rotate `whsec_`
2. `npx convex env set STRIPE_WEBHOOK_SECRET <new>`
3. Test bad-sig reject + good-sig accept
4. Rotate `sk_test_` similarly

## Incident
1. Disable webhook endpoint in Stripe
2. Set Convex env `STRIPE_WEBHOOK_SECRET=` empty → 503 fail-closed
3. Inspect `paymentInbox` / `settlementOps`
4. Resume after root cause

## Env separation
| Env | Stripe | Midnight | Convex |
|---|---|---|---|
| local | test or none | compose undeployed | convex-local |
| dev | sk_test_ | preprod | tremendous-rooster-473 |
| prod | not provisioned: the live site runs on the dev row above, in test mode | preprod | tremendous-rooster-473 |

## SBOM
`npm sbom --sbom-format cyclonedx` (npm 10+) in the repo root and in `packages/integration` (dual lockfiles).

## PR3/PR4 addendum (Reliability + Chain ops)

Full report with evidence IDs: ../audit/discovery/IMPLEMENTATION-PR3PR4.md

### Reliability ops
- Idempotency keys: settlement milo-ACTION:orderId:contractRevision; inbox provider|accountId|eventId. Never mint a new key for a retry of the same business action.
- Retries: generation+attempt fences; lease 60s; sweep reclaims stale running as pending with attempt+1 (generation preserved).
- Sweeps (manual until crons registered): npx convex run settlement:sweep; grant sweep files.sweepGrantsMutation.
- Dead letters: settlementOps state reconciliation (ambiguous) or blocked + lastReason. Inspect with settlement:opsForPaymentIntent. Webhook reconcile requeues reconciliation to pending. Do not blind-retry blocked.
- Backup/restore drill (dev): export Convex data, scratch restore, verify inbox dedupe. NOT DONE (no artifact).
- Rollback: prior dist/ plus npx convex deploy previous SHA; re-verify webhook HMAC.

### Chain ops
- Operator keys: .env.preprod mode 600, gitignored; seed never printed (spend-balance.mjs redact). Disclosed seed means burn wallet, never fund on mainnet.
- DUST: bun scripts/spend-balance.mjs --audit|--wallet|--local; log spends in SPEND-LEDGER.md; dust-seed is read-only and fail-closed.
- Indexer: fixed Preprod GraphQL; errors/lag/disagreement fail closed (scripts/preprod-observe.mjs).
- Network guard: PREPROD only (SUPPORTED_MIDNIGHT_NETWORK); Mainnet blocked until separate authorization.

## Preprod genesis replay (make the funded wallet spendable)

Status: **not yet run.** This runbook documents the procedure; no step here has been
executed against Preprod.

### Why this exists

The Preprod wallet holds 7 registered NIGHT UTXOs and reports `dustBalance: 0`, so it
cannot pay a fee and every spend fails with `InsufficientDustForFee`. The cause is not a
key mismatch: `DustGenerationsItem.owner` is a SCALE-compact field (prefix byte `0x73`,
then the 32-byte key little-endian), so `owner[2:] == reverse(dustKeyHex)` holds exactly
and the DUST generation belongs to this wallet.

The defect is that the dust seeder starts the wallet past its own history. Our 7
`DustInitialUtxo` events sit at dust ledger ids 1539297-1540159, the seeder's cutoff is
1708291, and the SDK's `Sync.js` resumes from `appliedIndex - 1`. A wallet restored from a
collapsed-update seed therefore never requests the skipped range, restores with
`utxos.length === 0`, and can never construct a DUST spend. A guard in
`packages/integration/src/dust-seed.mjs` now makes the seeder fail closed instead of
emitting such a snapshot, so the fast path refuses rather than silently producing an
unspendable wallet.

The only remaining way to make the wallet spendable is to replay dust events from genesis,
which builds `state.utxos` from the events that actually create the leaves.

The refusal is observable today. A read-only `--check` run on this tree reproduces it:

```
{"event":"dust-seed-cutoff-found","cutoffEventId":1710903,"foundAtHeight":3094366,...}
{"event":"dust-seed-failed","reason":"seed-refused","name":"DustSeedError",
 "message":"emitted snapshot holds no dust UTXOs: a collapsed update carries the tree roots
 but not the wallet's own leaves, ...","fallback":"ordinary-full-sync"}
{"event":"preprod-check",...,"address":"mn_addr_preprod1y7kqu30rc3dq647v37r77eew7efml5pzvcgpntp28rv85fzzz7usc2n4h7",
 "balances":{"connected":true,"synced":false,"night":"35000000000","dust":"0"}}
```

That is the whole defect in one run: NIGHT `35000000000`, DUST `0`, and the seeder refusing
to emit an unspendable snapshot. The cutoff has since advanced past 1708291 (it was 1710903
at height 3094366), which does not change the analysis: the cutoff is always ahead of our
events at 1539297-1540159.

### Command

Run from the repository root. The lane reads `.env.preprod`; the three variables below are
the ones that change behaviour for this procedure.

```sh
cd /home/eya/milo/milo-main

MILO_AWAIT_TIMEOUT_MS=10800000 \
MIDNIGHT_PREPROD_RUN_DIR=/home/eya/milo/milo-main/.hoplite/artifacts/preprod \
  node --env-file=.env.preprod packages/integration/src/preprod-lane.mjs --sync
```

`.env.preprod` begins with a UTF-8 BOM, so `set -a; . ./.env.preprod` does **not** load it
(the first assignment is prefixed with the BOM bytes and is silently skipped). Use
`node --env-file=.env.preprod`, which handles the BOM, or `scripts/spend-balance.mjs`, whose
loader trims each line. Do not paste the seed onto the command line: it would land in shell
history and in the process argv.

Required environment (validated by `preprodConfig` before any network I/O):

| Variable | Value | Why |
|---|---|---|
| `MIDNIGHT_PREPROD_SEED` | 64 hex chars | wallet key material; already in `.env.preprod` |
| `MILO_PREPROD_ALLOW` | `disposable-owned-preprod` | explicit Preprod authorization |
| `MILO_PREPROD_BLOCKFROST_PROJECT_ID` | `nightpreprod…` | appended as `project_id`; a `nightmainnet` token is rejected |
| `MIDNIGHT_PREPROD_PROOF_HTTP` | `http://127.0.0.1:6300` (default) | must be a bare loopback origin; the proof server sees witness data |

`--sync` is the correct mode: it syncs fully and persists the snapshots. Do not use
`--seed-dust`, which is the collapsed-update fast path that this procedure replaces.

To force a true from-genesis replay, the dust snapshot must be absent. The seeder writes
`<runDir>/wallet-state/dust.json`; if that file exists the wallet restores from it and
resumes at its recorded applied index instead of replaying genesis. Move it aside (do not
delete it) before the run:

```sh
mv .hoplite/artifacts/preprod/wallet-state/dust.json \
   .hoplite/artifacts/preprod/wallet-state/dust.json.pre-genesis-replay
```

The `shielded.json` and `unshielded.json` snapshots may stay: they are independent of the
dust replay and keep that part of the sync cheap. If a fully clean replay is wanted, move
all three aside and expect the longer end of the range below.

### Bounding the run

A fresh Preprod sync measured **125 minutes** on this SDK cohort (the lane's own comment at
`packages/integration/src/preprod-lane.mjs:940`, citing servicedesk #104); the file header
also records an operator note that a fresh sync "can approach three hours". Budget 2-3
hours and do not run it unattended without the receipt trail below.

`MILO_AWAIT_TIMEOUT_MS` is the only deadline that applies here. `awaitSync` calls
`resolveAwaitTimeoutMs(process.env)` and races `wallet.waitForSyncedState()` against it. The
default is **600000 ms (10 minutes)**, which is far shorter than a genesis replay and will
abort the run with `AwaitStallError` long before it finishes. Set it explicitly:

- `MILO_AWAIT_TIMEOUT_MS=10800000` — 3 hours, the recommended bound for a genesis replay.
- `MILO_AWAIT_TIMEOUT_MS=0` — disables the deadline entirely. Only for an attended run;
  a dropped subscription then hangs forever with no error.
- The value is clamped to `1000..86400000`; a blank value keeps the 10-minute default.

`MILO_LOCAL_TIMEOUT_MS` does **not** apply. It is read by `localConfig` in
`packages/integration/src/config.mjs`, which requires `MILO_LOCAL_NETWORK_ID=undeployed` and
a local genesis hash; `preprod-lane.mjs` never calls it. Setting it for a Preprod run has no
effect.

Progress is durable, not just stdout. `awaitSync` appends a `sync-progress-receipt` line to
`<runDir>/transactions.jsonl` every `MIDNIGHT_PREPROD_PROGRESS_INTERVAL_MS` (default 60000,
bounded 10000..3600000) and one immediately at start. Each line carries the applied index of
all three roles plus `elapsedMs`. Watch forward motion with:

```sh
tail -f .hoplite/artifacts/preprod/transactions.jsonl | grep sync-progress-receipt
```

A run also writes `<runDir>/sync-inflight.json` at start and removes it on a clean exit. A
leftover marker means the previous run was interrupted; the next run reports
`previous-run-interrupted`. These files are visibility only: the ledger exposes no
partial-sync checkpoint, so a killed sync is not resumed and its state cannot be
reconstructed from them.

The marker is written by every mode, including a short read-only `--check`, so any run that
is killed or times out leaves one behind and the next run reports a spurious interruption.
Check for it before starting a long replay and remove it only if you know the recorded `pid`
is gone:

```sh
cat .hoplite/artifacts/preprod/sync-inflight.json   # note "mode" and "pid"
rm .hoplite/artifacts/preprod/sync-inflight.json    # only after confirming that pid is dead
```

### Verifying success

1. The run exits cleanly and `sync-inflight.json` is gone.
2. `--check` reports a non-zero dust balance:

   ```sh
   MILO_AWAIT_TIMEOUT_MS=10800000 \
     node --env-file=.env.preprod packages/integration/src/preprod-lane.mjs --check
   ```

   The `preprod-check` receipt carries `balances.dust` and `balances.night`. Success is
   `dust > 0`. Note `--check` bounds its own balance wait at 120000 ms
   (`balances(session, ledger, timeoutMs = 120_000)`), so it is only meaningful after a
   completed sync, when the wallet restores from the snapshot instead of replaying.

3. `walletBalance(now) > 0` and `state.utxos.length > 0`. The UTXO set is the decisive
   signal: a collapsed-update seed restores matching Merkle roots but an empty `utxos`
   array, which is exactly the failure this replay fixes. The seeder's own guard uses the
   same condition (`restored.state.utxos.length === 0` throws `DustSeedError`).

4. The 7 expected `DustInitialUtxo` events at dust ledger ids **1539297-1540159** are the
   events that must have been replayed. Confirm they are present in the range the wallet
   consumed by checking the applied index in the final receipt is at or past 1540159, and
   that the wallet reports 7 spendable dust UTXOs matching the 7 registered NIGHT coins.

   The ids are the operator's recorded values. An independent read-only confirmation of the
   exact range was not completed: sampling Preprod found `DustSpendProcessed` id 1708291 at
   height 3090696 (matching the seeder's recorded cutoff of 1708291 exactly), and id 1541241
   at height 2638005, so the cited range falls in the blocks just below 2638005. Treat the
   precise ids as recorded-but-unconfirmed and verify them against the wallet's own applied
   index rather than relying on them.

### If it fails

| Symptom | Meaning | Action |
|---|---|---|
| `AwaitStallError ... exceeded N ms with no sync` | deadline too short for a genesis replay | raise `MILO_AWAIT_TIMEOUT_MS` (up to 86400000) and rerun |
| `dust-seed-failed` / `dust-seed-fallback` in the trail | the collapsed-update seeder was attempted and refused, which is expected here | confirm `dust.json` was moved aside; the run should fall through to the full sync |
| process killed, `sync-inflight.json` left behind | interrupted run; no checkpoint exists | rerun `--sync`; it restarts from its cursor, it does not resume |
| `wallet-state-rejected` with `sdk-versions-*` | snapshot written under a different SDK matrix | do not auto-repair; run `--repair-state` deliberately, or move the snapshots aside |
| run completes but `dustBalance` still `0` | the replay did not rebuild `utxos` | stop; do not submit anything. Capture the final receipt and the `--check` balances |

**Re-registering the existing NIGHT cannot substitute for this.** `--register-dust` spends
NIGHT to create DUST generation, and that transaction needs a DUST fee the wallet cannot
construct while `dustBalance` is 0. The trail already records this dead end:
`dust-already-registered` with `coins: 7, dustBalance: "0"` and repeated
`dust-force-respend` attempts. Registration is not a workaround for an empty UTXO set; it is
blocked by the same missing DUST.

Do not submit any transaction while `dustBalance` is 0: the proof server will prove a
transaction the node rejects for fee, which burns time and produces no receipt.

## Probes: every one finishes inside a minute

A probe is anything that reads state and reports it: the status and balance readers, the
verification gate, the drivers' receipts. None of them may hold a shell for longer than 60 s.
The rules below are enforced in code, not just documented.

| Probe | Command | Bound | Runbook line |
|---|---|---|---|
| Preprod progress | `node packages/integration/src/preprod-status.mjs` | 45 s shared chain budget, 15 s per request | Reads local receipts plus public chain state. Reports `chain.truncated` when the budget runs out instead of continuing. |
| NIGHT balance | `node scripts/spend-balance.mjs --audit` | 15 s per request, no wallet sync | Offline-safe: addresses, heights, fee estimates. Never prints the seed. |
| Snapshot verification | `node packages/integration/src/preprod-lane.mjs --verify` | 300 s default, `--timeout-ms` to change | Restores each role under a hard bound and cross-checks the chain. A CPU-near-zero timeout is the silent-hang trap and refuses; a CPU-busy timeout is re-tried once. |
| Local drivers | `node packages/integration/src/local-happy.mjs` etc. | `MILO_LOCAL_TIMEOUT_MS`, default and ceiling both 60 s | The default and the ceiling are the same constant, so no environment override can exceed a minute. |
| Circuit sweep | `node packages/integration/src/local-circuit-sweep.mjs` | same 60 s ceiling, plus a per-step `withTimeout` | Each deploy, handle and circuit call carries its own bound, so a stall names the step. |

Two things are deliberately **not** probes and keep their longer bounds: the lane's
`waitForGeneratedDust` protocol wait (a DUST registration legitimately takes minutes) and a
from-genesis wallet sync. Both are documented as long-running operations, both stream
progress to the trail, and neither is something to run while waiting on a shell.

The one bound that cannot be enforced from inside the process is a synchronous CPU block:
`AbortSignal.timeout` and `withTimeout` preempt a promise that never settles, but a
synchronous `restore()` holds the thread and the timer cannot fire. That is why the
verification gate samples CPU as well as wall time, and why the 14 MB dust snapshot is
restored only inside the gate (which re-runs a CPU-busy timeout once) rather than in an
ad-hoc script.

## A receipt only vouches for the snapshot it was written for

`wallet-state-verification.json` records the sha256 and byte size of each snapshot file it
verified. Nothing used to compare those against the files on disk, and every other gate
re-derives its answer from whatever is on disk *now* — so a PASS verdict written for an
older snapshot was read as evidence about new files that were never verified.

That was not hypothetical on this tree. The receipt at
`.hoplite/artifacts/preprod/wallet-state-verification.json` says `safeForFastPath: true`
with 17/17 checks passed, and records `shielded.json` at 4006 B and `dust.json` at 7893 B.
The files beside it are 3542 B and 14473807 B, rewritten a day later. Gate **G13
(`receipt-freshness`)** now compares the recorded hashes against the files about to be
restored and refuses the fast path when they disagree.

| Situation | G13 | What to do |
|---|---|---|
| No receipt yet | `UNEXERCISED` | Nothing is trusted from a receipt that does not exist. Run `--verify` to write one. |
| Receipt matches every file | `PASS` | The verdict describes these files. |
| Any recorded hash differs | `FAIL` | The receipt describes a different snapshot. Re-run `--verify`; do not restore on the old receipt. |
| Receipt unreadable | `FAIL` | Delete it and re-run `--verify`. |

The practical consequence: **after replacing any of the three snapshot files, re-run
`--verify` before the next restore.** A stale receipt is worse than no receipt, because it
carries a PASS that looks like evidence.


