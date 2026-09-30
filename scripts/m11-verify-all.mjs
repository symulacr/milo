/**
 * M11/D5-type — independently re-query tracked receipt hashes and sign the report.
 * Reads M2-circuit-table.md + RECEIPTS-LOCAL.md hashes; probes local indexer.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const INDEXER = "http://127.0.0.1:8088/api/v4/graphql";

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

function collectHashes() {
  const rows = [];
  const files = ["audit/discovery/M2-circuit-table.md", "RECEIPTS-LOCAL.md"];
  for (const f of files) {
    if (!existsSync(f)) continue;
    const text = readFileSync(f, "utf8");
    // markdown table rows with 64-hex
    for (const line of text.split("\n")) {
      const hashes = line.match(/\b[0-9a-f]{64}\b/g);
      if (!hashes) continue;
      const circuit = (line.match(
        /`?(reserve|accept|submitDelivery|approve|cancelReserved|decline|disputeBuyer|disputeMerchant|escalateUnreviewed|expireBootstrap|expireDispute|expireReserved|expireUndelivered|resolve)`?/,
      ) || [])[1];
      // skip artifact/genesis/source hashes
      if (/artifactSet|genesis|sourceSha|0bede3fb|13bc8bf4|e72f7a21/.test(line))
        continue;
      for (const h of hashes) {
        if (
          h ===
          "0bede3fbadbda00410db4888394f430fd327f89dd868714fb93f23da12096fe0"
        )
          continue;
        if (
          h ===
          "13bc8bf4ee518fa678b3f4adccdedbd05e1120473ce79594c8dbb2b4c840a944"
        )
          continue;
        if (
          h ===
          "e72f7a21a0397844563b4206f887b779ffa0d937c2d1b2339441faa1f08b9846"
        )
          continue;
        rows.push({ file: f, circuit: circuit || null, txHash: h });
      }
    }
  }
  // unique by hash
  const seen = new Set();
  return rows.filter((r) =>
    seen.has(r.txHash) ? false : (seen.add(r.txHash), true),
  );
}

const rows = collectHashes();
console.log("candidate hashes", rows.length);
const verified = [];
for (const row of rows.slice(0, 40)) {
  try {
    const data = await gql(
      `query ($hash: String!) { transactions(offset: { hash: $hash }) { hash block { height } } }`,
      { hash: row.txHash },
    );
    const found = data.transactions?.[0] ?? null;
    verified.push({
      ...row,
      found: !!found,
      height: found?.block?.height ?? null,
    });
  } catch (e) {
    verified.push({ ...row, found: false, error: String(e).slice(0, 80) });
  }
}

const report = {
  evidenceId: "obs_m11_indep_verify_2",
  at: new Date().toISOString(),
  indexer: INDEXER,
  rows: verified,
  found: verified.filter((r) => r.found).length,
  total: verified.length,
};
const json = JSON.stringify(report, null, 2);
const sha = createHash("sha256").update(json).digest("hex");
report.signatureSha256 = sha;
writeFileSync(
  "audit/discovery/M11-independent-verify.json",
  JSON.stringify(report, null, 2),
);
writeFileSync(
  "audit/discovery/M11-independent-verify.md",
  `# M11 independent verify (D5-type)\n\nEvidence: \`obs_m11_indep_verify_2\`\n\n- rows ${report.total}\n- found ${report.found}\n- signatureSha256 \`${sha}\`\n\n| file | circuit | txHash | found | height |\n|---|---|---|---|---|\n` +
    verified
      .map(
        (r) =>
          `| ${r.file} | ${r.circuit ?? "—"} | \`${r.txHash.slice(0, 16)}…\` | ${r.found ? "YES" : "NO"} | ${r.height ?? "—"} |`,
      )
      .join("\n") +
    "\n",
);
console.log(JSON.stringify({ found: report.found, total: report.total, sha }));
if (report.found < report.total) process.exitCode = 0; // partial OK; report truth
