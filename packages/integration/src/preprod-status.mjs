// One-command progress probe for the preprod run. Reads only local receipts and
// public chain state, so it never waits for a wallet sync. Intended to be run
// while a lane mode is working in the background.
//
//   node packages/integration/src/preprod-status.mjs
//
// Bounded: every request goes through the package's one GraphQL helper with the
// whole chain section's 45 s budget as its deadline. Without the budget the
// per-address and per-landing lookups run sequentially, so a slow indexer
// multiplied 15 s by the number of addresses in the trail. Past the budget the
// chain section reports what it has and stops, rather than holding a shell open.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blockfrostPreprodEndpoints } from "./blockfrost.mjs";
import { graphql } from "./harness.mjs";

const RUN_DIR = new URL("../../../.hoplite/artifacts/preprod", import.meta.url)
  .pathname;
const RECEIPTS = resolve(RUN_DIR, "transactions.jsonl");

/** The whole probe must finish inside a minute, so the chain section gets 45 s. */
const CHAIN_BUDGET_MS = 45_000;
const chainDeadline = Date.now() + CHAIN_BUDGET_MS;

// Resolve the Blockfrost Preprod indexer (token appended) at call time. A read-only progress
// probe must not throw at import when no token is present; it reports the failure instead.
function indexerEndpoint() {
  try {
    return blockfrostPreprodEndpoints(process.env).indexer;
  } catch (error) {
    return { error: String(error?.message ?? error) };
  }
}

const j = (value) => JSON.stringify(value);

function processState() {
  try {
    const out = execFileSync("pgrep", ["-af", "preprod-lane.mjs"], {
      encoding: "utf8",
      timeout: 5_000,
    });
    const lines = out
      .split("\n")
      .filter((line) => line.includes("node src/preprod-lane.mjs"));
    return lines.length ? lines.map((line) => line.trim().slice(0, 120)) : [];
  } catch {
    return [];
  }
}

function receipts() {
  if (!existsSync(RECEIPTS)) return [];
  return readFileSync(RECEIPTS, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** One indexer POST through the package's single GraphQL helper, with this
 * probe's 45 s chain budget as the deadline so no single request outlives it. */
async function gql(query, variables) {
  const endpoint = indexerEndpoint();
  if (typeof endpoint !== "string")
    throw new Error(`indexer endpoint unavailable: ${endpoint.error}`);
  return graphql({ indexer: endpoint }, query, variables, {
    deadline: chainDeadline,
  });
}

async function chainState(events) {
  const tip = await gql(`query { block { height hash } }`);
  const deployed = events.filter((event) => event.event === "preprod-deployed");
  const addresses = [...new Set(deployed.map((event) => event.address))];
  const landings = [];
  const truncated = { landings: false, contractStates: false };
  for (const event of events
    .filter((e) => e.event === "call-finalized")
    .slice(-5)) {
    if (!event.txId) continue;
    if (Date.now() >= chainDeadline) {
      truncated.landings = true;
      break;
    }
    const result = await gql(
      `query ($hash: String!) { transactions(offset: { hash: $hash }) { hash block { height } } }`,
      { hash: event.txId },
    ).catch(() => null);
    landings.push({
      circuit: event.circuit,
      txId: event.txId,
      indexed: Boolean(result?.transactions?.length),
    });
  }
  const contractStates = [];
  for (const address of addresses) {
    if (Date.now() >= chainDeadline) {
      truncated.contractStates = true;
      break;
    }
    const result = await gql(
      `query ($address: String!) { contractAction(address: $address) { address state } }`,
      { address },
    ).catch(() => null);
    contractStates.push({
      address,
      indexed: Boolean(result?.contractAction),
      stateBytes: result?.contractAction?.state?.length ?? 0,
    });
  }
  return {
    tip: tip?.block,
    landings,
    contractStates,
    truncated,
    budgetMs: CHAIN_BUDGET_MS,
  };
}

const events = receipts();
const counts = events.reduce((acc, event) => {
  acc[event.event] = (acc[event.event] ?? 0) + 1;
  return acc;
}, {});
const deployments = events.filter(
  (event) => event.event === "preprod-deployed",
);
const scenarios = new Map();
for (const event of events.filter(
  (e) => e.event === "call-finalized" || e.event === "call-rejected",
)) {
  const key = event.scenario ?? "unknown";
  const entry = scenarios.get(key) ?? {
    finalized: 0,
    rejected: 0,
    circuits: [],
  };
  if (event.event === "call-finalized") entry.finalized += 1;
  else entry.rejected += 1;
  entry.circuits.push(event.circuit);
  scenarios.set(key, entry);
}

const report = {
  lane_processes: processState(),
  receipts_file: RECEIPTS,
  receipt_events: counts,
  deployments: deployments.map((d) => ({
    label: d.label,
    address: d.address,
    txId: d.txId,
    block: d.blockHeight,
  })),
  scenarios: Object.fromEntries(
    [...scenarios.entries()].map(([k, v]) => [
      k,
      { ...v, circuits: [...new Set(v.circuits)] },
    ]),
  ),
  last_events: events.slice(-4).map((e) => ({
    event: e.event,
    circuit: e.circuit,
    scenario: e.scenario,
    txId: e.txId,
  })),
  chain: await chainState(events).catch((error) => ({ error: error.message })),
  wallet_state:
    "requires a wallet sync; run preprod-lane.mjs --check for balances",
};

console.log(j(report));
