import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { observePreprod } from "../packages/integration/src/preprod-observation.mjs";

const sources = [
  "packages/integration/src/preprod-observation.mjs",
  "scripts/preprod-observe.mjs",
  "packages/integration/package.json",
];
const sourceSha256 = {};
for (const path of sources) {
  sourceSha256[path] = createHash("sha256")
    .update(await readFile(new URL(`../${path}`, import.meta.url)))
    .digest("hex");
}
const receipt = await observePreprod();
console.log(JSON.stringify({ ...receipt, sourceSha256 }, null, 2));
