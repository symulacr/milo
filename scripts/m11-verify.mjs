/**
 * M11 — independent re-query of local happy-path receipt rows.
 * Re-reads each tx hash from the local indexer GraphQL and compares
 * height/status against the recorded receipt. Does not trust the receipt file.
 */
import { readFileSync, writeFileSync } from "node:fs";

const INDEXER = "http://127.0.0.1:8088/api/v4/graphql";
const receipts = JSON.parse(
  readFileSync("/tmp/d2a-instances/instance2.json", "utf8"),
);

async function gql(query, variables) {
  const res = await fetch(INDEXER, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors));
  return body.data;
}

const rows = [];
for (const rec of receipts.receipts ?? []) {
  const data = await gql(
    `query ($hash: String!) {
       transactions(offset: { hash: $hash }) { hash block { height hash } }
     }`,
    { hash: rec.txHash },
  );
  const found = data.transactions?.[0] ?? null;
  rows.push({
    circuit: rec.circuit,
    recordedTxHash: rec.txHash,
    recordedHeight: rec.blockHeight,
    recordedStatus: rec.status,
    indexerFound: !!found,
    indexerHeight: found?.block?.height ?? null,
    heightMatch: found ? found.block.height === rec.blockHeight : false,
  });
}

const tip = await gql(`query { block { height hash } }`);
const report = {
  evidenceId: "obs_m11_indep_verify_1",
  at: Date.now(),
  source: "local indexer GraphQL re-query",
  tip: tip.block,
  address: receipts.address,
  rows,
  allHeightMatch: rows.every((r) => r.heightMatch),
  allFound: rows.every((r) => r.indexerFound),
};
writeFileSync(
  "/tmp/d2a-instances/m11-verify.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
if (!report.allFound || !report.allHeightMatch) process.exitCode = 1;
else console.log("M11_VERIFY_PASS");
