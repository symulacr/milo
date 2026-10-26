const children = new Set<Bun.Subprocess>();
let shuttingDown = false;

export function ownNativeProcess(child: Bun.Subprocess) {
  children.add(child);
  void child.exited.then(() => children.delete(child));
  if (shuttingDown && child.exitCode === null) child.kill("SIGKILL");
  return child;
}

export async function stopNativeProcess(child: Bun.Subprocess) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try {
    await child.exited;
  } finally {
    clearTimeout(timeout);
  }
}

export function installNativeSignalCleanup() {
  let stopping = false;
  const interrupt = async (code: number) => {
    if (stopping) return;
    stopping = true;
    shuttingDown = true;
    while (children.size) {
      await Promise.all([...children].reverse().map(stopNativeProcess));
    }
    process.exit(code);
  };
  const term = () => void interrupt(143);
  const int = () => void interrupt(130);
  process.once("SIGTERM", term);
  process.once("SIGINT", int);
  return () => {
    process.off("SIGTERM", term);
    process.off("SIGINT", int);
  };
}

/**
 * The preamble every provisioning script needs: signal cleanup when run
 * directly, and a hard stop on any platform other than the pinned one.
 */
export function provisioningPreamble() {
  const removeSignalHandlers = import.meta.main
    ? installNativeSignalCleanup()
    : () => {};
  if (process.platform !== "linux" || process.arch !== "x64")
    throw new Error("provisioning runs on linux x64 only");
  return removeSignalHandlers;
}
