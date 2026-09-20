// One-command progress probe for the preprod run. Reads only local receipts and
// public chain state, so it never waits for a wallet sync. Intended to be run
// while a lane mode is working in the background.
//
//   node packages/integration/src/preprod-status.mjs
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const RUN_DIR = new URL("../../../.hoplite/artifacts/preprod", import.meta.url)
  .pathname;
const RECEIPTS = resolve(RUN_DIR, "transactions.jsonl");
const INDEXER = "https://indexer.preprod.midnight.network/api/v4/graphql";

const j = (value) => JSON.stringify(value);

function processState() {
  try {
    const out = execFileSync("pgrep", ["-af", "preprod-lane.mjs"], {
      encoding: "utf8",
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

async function graphql(query, variables) {
  const response = await fetch(INDEXER, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`indexer ${response.status}`);
  const body = await response.json();
  if (body.errors)
    throw new Error(body.errors.map((e) => e.message).join("; "));
  return body.data;
}

async function chainState(events) {
  const tip = await graphql(`query { block { height hash } }`);
  const deployed = events.filter((event) => event.event === "preprod-deployed");
  const addresses = [...new Set(deployed.map((event) => event.address))];
  const landings = [];
  for (const event of events
    .filter((e) => e.event === "call-finalized")
    .slice(-5)) {
    if (!event.txId) continue;
    const result = await graphql(
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
    const result = await graphql(
      `query ($address: String!) { contractAction(address: $address) { address state } }`,
      { address },
    ).catch(() => null);
    contractStates.push({
      address,
      indexed: Boolean(result?.contractAction),
      stateBytes: result?.contractAction?.state?.length ?? 0,
    });
  }
  return { tip: tip?.block, landings, contractStates };
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
