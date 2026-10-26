// One-command Preprod preflight. Every check runs under its own bound and the whole
// run under PREFLIGHT_TIMEOUT_MS, so this finishes inside a minute or names the check
// it was on. Exit 0 only when every check passes; otherwise exit 1 and print the
// failing check id, so a caller can branch on it without parsing prose.
//
//   node packages/integration/src/preprod.mjs
import { runPreflight } from "./preprod-profile.mjs";

const result = await runPreflight(process.env);
for (const check of result.checks)
  console.error(
    `${check.status.padEnd(4)} ${check.id.padEnd(16)} ${check.evidence ?? check.reason ?? ""}`,
  );
console.log(JSON.stringify(result));
if (!result.ok) {
  console.error(`preflight failed: ${result.failedId}`);
  process.exitCode = 1;
}
