import { writeFileSync } from "node:fs";
import {
  installNativeSignalCleanup,
  ownNativeProcess,
} from "../native-processes";

installNativeSignalCleanup();
const marker = process.argv[2];
if (!marker) throw new Error("Missing test marker path");
const child = ownNativeProcess(
  Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], {
    stdout: "ignore",
    stderr: "ignore",
  }),
);
if (process.argv[3] === "late") {
  const late = () => {
    const spawned = ownNativeProcess(
      Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], {
        stdout: "ignore",
        stderr: "ignore",
      }),
    );
    writeFileSync(`${marker}.late`, String(spawned.pid));
  };
  process.once("SIGINT", late);
  process.once("SIGTERM", late);
}
await Bun.write(marker, String(child.pid));
setInterval(() => {}, 1000);
