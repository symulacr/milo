import { spawnSync } from "node:child_process";
import { installIntegration } from "./setup-integration-runtime";

const test = spawnSync(
  installIntegration(),
  ["--test", "packages/integration/test/*.test.mjs", "--test-reporter=dot"],
  { stdio: "inherit" },
);
process.exit(test.status ?? 1);
