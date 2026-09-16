import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openBootstrapRecoveryStore } from "../src/recovery-store.mjs";

const context = {
  network: "undeployed",
  genesis: "local-genesis",
  artifactSet: "milo-contract-v1",
  actorId: "merchant-actor",
  orderId: "order-001",
};
const hex32 = "ab".repeat(32);
const hex33 = "cd".repeat(33);
const configuration = () => ({
  network: new Uint8Array(32).fill(1),
  orderNonce: new Uint8Array(32).fill(2),
  termsCommitment: new Uint8Array(32).fill(3),
  buyerCommitment: new Uint8Array(32).fill(4),
  merchantCommitment: new Uint8Array(32).fill(5),
  operatorCommitment: new Uint8Array(32).fill(6),
  acceptanceDeadline: 1n,
  deliveryDeadline: 2n,
  reviewDeadline: 3n,
  resolutionDeadline: 4n,
});
const privateState = () => ({
  actor: "merchant",
  secret: new Uint8Array(32).fill(7),
  terms: {
    serviceVersion: 1n,
    packQuantity: 1n,
    outputCount: 3n,
    unitPrice: 36_000n,
    total: 36_000n,
    currency: new Uint8Array([85, 83, 68]),
    scopeDigest: new Uint8Array(32).fill(8),
    rightsDigest: new Uint8Array(32).fill(9),
    paymentPolicy: new Uint8Array(32).fill(10),
    salt: new Uint8Array(32).fill(11),
  },
  limit: 36_000n,
});
const step = (name, phase) => ({
  name,
  phase,
  identifiers: phase === "prepared" ? [] : [hex33],
  txId: phase === "confirmed" ? hex33 : null,
  txHash: phase === "confirmed" ? hex32 : null,
  blockHash: phase === "confirmed" ? hex32 : null,
  blockHeight: phase === "confirmed" ? "42" : null,
});
const record = (deploy = "prepared") => ({
  configuration: configuration(),
  privateState: privateState(),
  coinPublicKey: "00".repeat(32),
  signingKey: hex32,
  address: "ef".repeat(32),
  preparedDeployment: new Uint8Array([1, 2, 3]),
  steps: [
    step("deploy", deploy),
    step("install", "prepared"),
    step("lock", "prepared"),
  ],
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "milo-recovery-"));
  return { directory, key: new Uint8Array(randomBytes(32)) };
}

test("recovery journal round-trips encrypted typed bootstrap intent with private permissions", async (t) => {
  const { directory, key } = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = await openBootstrapRecoveryStore({
    directory,
    key,
    ...context,
  });
  await store.checkpoint(record());
  const restored = await store.read();
  assert(restored);
  assert.deepEqual(restored.configuration, configuration());
  assert.deepEqual(restored.privateState, privateState());
  assert.deepEqual(restored.preparedDeployment, new Uint8Array([1, 2, 3]));
  assert.equal(typeof restored.configuration.acceptanceDeadline, "bigint");
  assert.equal((await lstat(store.path)).mode & 0o777, 0o600);
  assert.equal((await lstat(directory)).mode & 0o777, 0o700);
  const raw = await readFile(store.path, "utf8");
  assert(!raw.includes(hex32));
  assert(!raw.includes("merchant"));
});

test("recovery survives an independent process and permits only forward ordered journal progress", async (t) => {
  const { directory, key } = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = await openBootstrapRecoveryStore({
    directory,
    key,
    ...context,
  });
  await store.checkpoint(record("pending"));
  const module = new URL("../src/recovery-store.mjs", import.meta.url).href;
  const reader = `import { openBootstrapRecoveryStore } from ${JSON.stringify(module)};
    const store = await openBootstrapRecoveryStore({ directory: ${JSON.stringify(directory)}, key: new Uint8Array(${JSON.stringify([...key])}), ...${JSON.stringify(context)} });
    const value = await store.read(); console.log(value.steps[0].phase + ":" + value.signingKey);`;
  const restarted = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", reader],
    { encoding: "utf8" },
  );
  assert.equal(restarted.status, 0, restarted.stderr);
  assert.equal(restarted.stdout.trim(), `pending:${hex32}`);
  await assert.rejects(store.checkpoint(record()), /phase regression/);
  const confirmed = record("confirmed");
  await store.checkpoint(confirmed);
  const installBeforeDeploy = record();
  installBeforeDeploy.steps[1] = step("install", "pending");
  await assert.rejects(
    store.checkpoint(installBeforeDeploy),
    /phase regression|step order/,
  );
});

test("recovery refuses tampering, truncation, wrong keys, and cross-context ciphertext", async (t) => {
  const { directory, key } = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = await openBootstrapRecoveryStore({
    directory,
    key,
    ...context,
  });
  await store.checkpoint(record());
  const original = await readFile(store.path, "utf8");
  await writeFile(store.path, "{}", { mode: 0o600 });
  await assert.rejects(store.read());
  await writeFile(store.path, original.slice(0, 20), { mode: 0o600 });
  await assert.rejects(store.read());
  await writeFile(store.path, original, { mode: 0o600 });
  const cipherTamper = JSON.parse(original);
  cipherTamper.ciphertext = `${cipherTamper.ciphertext[0] === "A" ? "B" : "A"}${cipherTamper.ciphertext.slice(1)}`;
  await writeFile(store.path, JSON.stringify(cipherTamper), { mode: 0o600 });
  await assert.rejects(store.read(), /authentication failed/);
  await writeFile(store.path, original, { mode: 0o600 });
  const wrongKey = await openBootstrapRecoveryStore({
    directory,
    key: new Uint8Array(32),
    ...context,
  });
  await assert.rejects(wrongKey.read(), /authentication failed/);
  for (const keyName of [
    "network",
    "genesis",
    "artifactSet",
    "actorId",
    "orderId",
  ]) {
    const other = await openBootstrapRecoveryStore({
      directory,
      key,
      ...context,
      [keyName]: `other-${keyName}`,
    });
    await writeFile(other.path, original, { mode: 0o600 });
    await assert.rejects(other.read(), /authentication failed/);
  }
});

test("recovery refuses unsafe paths, unexpected identity, and arbitrary serialized fields", async (t) => {
  const { directory, key } = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = await openBootstrapRecoveryStore({
    directory,
    key,
    ...context,
  });
  await store.checkpoint(record());
  const altered = record();
  altered.address = "12".repeat(32);
  await assert.rejects(store.checkpoint(altered), /identity mismatch/);
  const changedDeployment = record();
  changedDeployment.preparedDeployment = new Uint8Array([1, 2, 4]);
  await assert.rejects(
    store.checkpoint(changedDeployment),
    /identity mismatch/,
  );
  await rm(store.path);
  const target = join(directory, "target");
  await writeFile(target, "not a journal", { mode: 0o600 });
  await symlink(target, store.path);
  await assert.rejects(store.read(), /Unsafe recovery-store path/);
  const linkedDirectory = `${directory}-link`;
  await symlink(directory, linkedDirectory);
  await assert.rejects(
    openBootstrapRecoveryStore({ directory: linkedDirectory, key, ...context }),
    /Unsafe recovery-store directory/,
  );
  const bad = record();
  bad.extra = true;
  await assert.rejects(store.checkpoint(bad), /record fields/);
  await assert.rejects(
    openBootstrapRecoveryStore({
      directory,
      key: new Uint8Array(31),
      ...context,
    }),
    /32 bytes/,
  );
});

test("recovery rejects unsafe modes, reordered records, receipt mutation, and concurrent identities", async (t) => {
  const { directory, key } = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = await openBootstrapRecoveryStore({
    directory,
    key,
    ...context,
  });
  const reordered = record();
  reordered.steps.reverse();
  await assert.rejects(store.checkpoint(reordered), /steps/);
  await assert.rejects(store.checkpoint(record("confirmed")), /phase jump/);
  await store.checkpoint(record());
  await chmod(store.path, 0o644);
  await assert.rejects(store.read(), /not private/);
  await chmod(store.path, 0o600);
  await chmod(directory, 0o755);
  await assert.rejects(
    openBootstrapRecoveryStore({ directory, key, ...context }),
    /not private/,
  );
  await chmod(directory, 0o700);
  const pending = record("pending");
  await store.checkpoint(pending);
  const confirmed = record("confirmed");
  await store.checkpoint(confirmed);
  const mutatedReceipt = record("confirmed");
  mutatedReceipt.steps[0].blockHeight = "43";
  await assert.rejects(
    store.checkpoint(mutatedReceipt),
    /confirmed receipt mutation/,
  );
  const swappedSecret = record("confirmed");
  swappedSecret.privateState.secret[0] = 99;
  await assert.rejects(store.checkpoint(swappedSecret), /identity mismatch/);
  const swappedRole = record("confirmed");
  swappedRole.privateState.actor = "buyer";
  await assert.rejects(store.checkpoint(swappedRole), /identity mismatch/);
  const swappedCoin = record("confirmed");
  swappedCoin.coinPublicKey = "01".repeat(32);
  await assert.rejects(store.checkpoint(swappedCoin), /identity mismatch/);

  const { directory: concurrentDirectory, key: concurrentKey } =
    await fixture();
  t.after(() => rm(concurrentDirectory, { recursive: true, force: true }));
  const concurrent = await openBootstrapRecoveryStore({
    directory: concurrentDirectory,
    key: concurrentKey,
    ...context,
  });
  const another = record();
  another.address = "13".repeat(32);
  const outcomes = await Promise.allSettled([
    concurrent.checkpoint(record()),
    concurrent.checkpoint(another),
  ]);
  assert.equal(
    outcomes.filter((outcome) => outcome.status === "fulfilled").length,
    1,
  );
  assert.equal(
    outcomes.filter((outcome) => outcome.status === "rejected").length,
    1,
  );
  await writeFile(`${concurrent.path}.lock`, "retained", { mode: 0o600 });
  await assert.rejects(concurrent.checkpoint(record()), /checkpoint locked/);
});
