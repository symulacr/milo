#!/usr/bin/env node
// spend-balance: read wallet / chain balances for the spend ledger WITHOUT echoing the seed.
//
// SAFETY
// - The seed is loaded from the environment (or .env.preprod) into a closed local binding
//   only. It is never written to stdout, stderr, logs, or files.
// - Every printed string passes through redact() which replaces any occurrence of the
//   seed (and any 64-hex blob equal to it) with <redacted:seed>.
// - Public addresses, tx hashes, block heights and fee estimates are fine to print.
//
// Modes (exactly one, default is --audit):
//   --audit    offline-safe: addresses, chain heights (local RPC + Preprod indexer),
//              fee estimates from SPEND-LEDGER, faucet policy, seed presence (length only)
//   --wallet   open the Preprod wallet via preprod-lane --check and report live balances;
//              seed is used internally and redacted from the child output
//   --local    local disposable node tip + recorded local staged-deploy fee total
//
// Exit codes: 0 ok, 1 usage/config error, 2 upstream query failure.

import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

// --------------------------------------------------------------------------------------
// Seed handling: load once, never print.
// --------------------------------------------------------------------------------------

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const fileEnv = loadEnvFile(resolve(REPO, ".env.preprod"));
const SEED = process.env.MIDNIGHT_PREPROD_SEED ?? fileEnv.MIDNIGHT_PREPROD_SEED ?? "";
const ADDRESS =
  process.env.MIDNIGHT_PREPROD_ADDRESS ??
  fileEnv.MIDNIGHT_PREPROD_ADDRESS ??
  "";
const DUST_ADDRESS =
  process.env.MIDNIGHT_PREPROD_DUST_ADDRESS ??
  fileEnv.MIDNIGHT_PREPROD_DUST_ADDRESS ??
  "";

/** Replace any seed material in a string before it is printed. */
function redact(text) {
  let s = String(text);
  if (SEED && SEED.length >= 16) {
    s = s.split(SEED).join("<redacted:seed>");
  }
  // belt and braces: any 64-lowerhex token that equals the seed is already covered;
  // also scrub a bare seed if it appears in mixed quoting.
  s = s.replace(/\b[a-f0-9]{64}\b/g, (tok) => (tok === SEED ? "<redacted:seed>" : tok));
  return s;
}

function say(line) {
  process.stdout.write(redact(line) + "\n");
}

function sayErr(line) {
  process.stderr.write(redact(line) + "\n");
}

function seedPresence() {
  if (!SEED) return "absent";
  const ok = /^[a-f0-9]{64}$/.test(SEED);
  // length only — never the value
  return ok ? `present (64-hex, length ${SEED.length}, value redacted)` : `present (unexpected format, length ${SEED.length}, value redacted)`;
}

// --------------------------------------------------------------------------------------
// Chain probes (public data only).
// --------------------------------------------------------------------------------------

async function postJson(url, body, timeoutMs = 15_000) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return res.json();
}

async function localChainHeight() {
  try {
    const j = await postJson("http://127.0.0.1:9944", {
      jsonrpc: "2.0",
      method: "chain_getHeader",
      params: [],
      id: 1,
    });
    const hex = j?.result?.number;
    if (!hex) return { ok: false, error: "no header" };
    return { ok: true, height: Number.parseInt(hex, 16), hex };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}

const PREPROD_GQL = "https://indexer.preprod.midnight.network/api/v4/graphql";

async function preprodChainHeight() {
  try {
    const j = await postJson(PREPROD_GQL, { query: "{ block { height } }" });
    const height = j?.data?.block?.height;
    if (typeof height !== "number") return { ok: false, error: JSON.stringify(j).slice(0, 200) };
    return { ok: true, height };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}

async function preprodContractAction() {
  const q = `query {
  contractAction(address: "b95c8243f269c995c76577006f233b7c37f353067df8737b9b17537739e74586") {
    __typename
    transaction { hash block { height } }
  }
}`;
  try {
    const j = await postJson(PREPROD_GQL, { query: q });
    const action = j?.data?.contractAction;
    return { ok: true, action };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}

// --------------------------------------------------------------------------------------
// Fee estimates (recorded BEFORE submit; see SPEND-LEDGER.md)
// --------------------------------------------------------------------------------------

const FEE_ESTIMATES = [
  {
    hash: "0746d21e488f46698910e6fd0bf016f6a0a0a3d54db91c0af080bf07e0e5205c",
    purpose: "MID-T01-staged-deploy",
    fee: 30,
    block: 701,
  },
  {
    hash: "8b59ea5be0e0101ed599ada21db7a1e837da9e1485db0c69c9e13698cbcaa48c",
    purpose: "MID-T01-staged-install",
    fee: 29,
    block: 704,
  },
  {
    hash: "40ade7947a0f70cb78eaa715b10d422650f838cd00d16e95993ea85ccc2b6a39",
    purpose: "MID-T01-staged-lock",
    fee: 1,
    block: 707,
  },
];

// --------------------------------------------------------------------------------------
// Modes
// --------------------------------------------------------------------------------------

async function modeAudit() {
  say("event: spend-balance-audit");
  say(`repo: ${REPO}`);
  say(`seed: ${seedPresence()}`);
  say(`address: ${ADDRESS || "(unset)"}`);
  say(`dust-address: ${DUST_ADDRESS || "(unset)"}`);
  say("seed-policy: never printed; redaction active on all output");

  const local = await localChainHeight();
  say(
    local.ok
      ? `local-chain-height: ${local.height}`
      : `local-chain-height: unavailable (${local.error})`,
  );

  const tip = await preprodChainHeight();
  say(
    tip.ok
      ? `preprod-chain-height: ${tip.height}`
      : `preprod-chain-height: unavailable (${tip.error})`,
  );

  const action = await preprodContractAction();
  if (action.ok && action.action?.transaction) {
    const t = action.action.transaction;
    say(`preprod-latest-action: ${action.action.__typename}`);
    say(`preprod-latest-tx: ${t.hash}`);
    say(`preprod-latest-block: ${t.block?.height}`);
  } else {
    say(`preprod-latest-action: unavailable (${action.error ?? "no data"})`);
  }

  say("fee-estimates-specks-with-margin (estimated BEFORE submit):");
  let total = 0;
  for (const row of FEE_ESTIMATES) {
    total += row.fee;
    say(`  ${row.purpose} | ${row.hash} | fee=${row.fee} | block=${row.block}`);
  }
  say(`  total-staged-deploy-fee-estimate: ${total}`);

  say("faucet: https://midnight-tmnight-preprod.nethermind.dev/ (1000 tNIGHT / request, unshielded only)");
  say("faucet-address: " + (ADDRESS || "(unset)"));
  say("balance-source: see SPEND-LEDGER.md and preprod-lane --check for live NIGHT/DUST");
  return 0;
}

async function modeLocal() {
  say("event: spend-balance-local");
  const local = await localChainHeight();
  if (!local.ok) {
    sayErr(`local-chain-height: unavailable (${local.error})`);
    return 2;
  }
  say(`local-chain-height: ${local.height}`);
  say("local-staged-deploy-txs: 3");
  say("local-staged-deploy-fee-estimate-total: 60 specks");
  for (const row of FEE_ESTIMATES) {
    say(`  ${row.purpose} | ${row.hash} | fee=${row.fee} | block=${row.block}`);
  }
  say("local-funding-tx: 43506e61576418638c180984c0bb52ff571b7ce57c9947a52d2059a9ccb9d720 | block=691");
  return 0;
}

function modeWallet() {
  return new Promise((resolvePromise) => {
    if (!SEED || !/^[a-f0-9]{64}$/.test(SEED)) {
      sayErr("wallet-mode requires MIDNIGHT_PREPROD_SEED (64-hex) in env or .env.preprod");
      sayErr(`seed: ${seedPresence()}`);
      resolvePromise(1);
      return;
    }
    say("event: spend-balance-wallet");
    say(`seed: ${seedPresence()}`);
    say(`address: ${ADDRESS || "(derived by wallet)"}`);
    say("delegate: packages/integration/src/preprod-lane.mjs --check");
    say("note: child output is redacted; seed is never forwarded to argv");

    const child = spawn(
      process.execPath,
      [resolve(REPO, "packages/integration/src/preprod-lane.mjs"), "--check"],
      {
        cwd: REPO,
        env: {
          ...process.env,
          // seed is inherited via env, never argv
          MIDNIGHT_PREPROD_SEED: SEED,
          MILO_PREPROD_ALLOW: process.env.MILO_PREPROD_ALLOW ?? "disposable-owned-preprod",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    child.stdout.on("data", (buf) => {
      for (const line of String(buf).split("\n")) {
        if (line.trim()) say(line);
      }
    });
    child.stderr.on("data", (buf) => {
      for (const line of String(buf).split("\n")) {
        if (line.trim()) sayErr(line);
      }
    });
    child.on("error", (error) => {
      sayErr(`wallet-child-error: ${redact(String(error?.message ?? error))}`);
      resolvePromise(2);
    });
    child.on("close", (code) => {
      say(`wallet-child-exit: ${code}`);
      resolvePromise(code === 0 ? 0 : 2);
    });
  });
}

// --------------------------------------------------------------------------------------

async function main() {
  const flags = process.argv.slice(2);
  const mode = flags.find((f) => f.startsWith("--")) ?? "--audit";
  if (!["--audit", "--wallet", "--local", "--help"].includes(mode)) {
    sayErr(`unknown mode: ${mode}`);
    sayErr("usage: node scripts/spend-balance.mjs [--audit|--wallet|--local|--help]");
    return 1;
  }
  if (mode === "--help") {
    say("usage: node scripts/spend-balance.mjs [--audit|--wallet|--local]");
    say("reads balances without echoing the seed (see file header)");
    return 0;
  }
  if (mode === "--audit") return modeAudit();
  if (mode === "--local") return modeLocal();
  return modeWallet();
}

main().then(
  (code) => process.exit(code),
  (error) => {
    sayErr(`fatal: ${redact(String(error?.stack ?? error))}`);
    process.exit(2);
  },
);
