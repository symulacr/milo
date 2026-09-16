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
