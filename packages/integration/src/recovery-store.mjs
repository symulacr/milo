import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { join, parse, resolve } from "node:path";

export const RECOVERY_SCHEMA_VERSION = 1;

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_PREPARED_DEPLOYMENT_BYTES = 256 * 1024;
const STEPS = ["deploy", "install", "lock"];
const PHASES = ["prepared", "pending", "confirmed"];
const CONFIGURATION_BYTES = [
  "network",
  "orderNonce",
  "termsCommitment",
  "buyerCommitment",
  "merchantCommitment",
  "operatorCommitment",
];
const CONFIGURATION_INTEGERS = [
  "acceptanceDeadline",
  "deliveryDeadline",
  "reviewDeadline",
  "resolutionDeadline",
];
const TERM_BYTES = [
  "currency",
  "scopeDigest",
  "rightsDigest",
  "paymentPolicy",
  "salt",
];
const TERM_INTEGERS = [
  "serviceVersion",
  "packQuantity",
  "outputCount",
  "unitPrice",
  "total",
];
const BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const HEX_32 = /^[0-9a-f]{64}$/;
const HEX_33 = /^[0-9a-f]{66}$/;
const U64_MAX = (1n << 64n) - 1n;
const U64_DECIMAL = /^(0|[1-9][0-9]{0,19})$/;
const own = (value, key) => Object.hasOwn(value, key);

function invalid(message) {
  throw new Error(`Invalid bootstrap recovery record: ${message}`);
}
function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid(label);
  return value;
}
function exact(value, keys, label) {
  plainObject(value, label);
  if (
    Object.keys(value).length !== keys.length ||
    !keys.every((key) => own(value, key))
  )
    invalid(`${label} fields`);
}
function text(value, label, maximum = 256) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum)
    invalid(label);
  return value;
}
function encodedBytes(value, label, length) {
  if (!(value instanceof Uint8Array) || value.length !== length) invalid(label);
  return Buffer.from(value).toString("base64");
}
function decodedBytes(value, label, length) {
  text(value, label, Math.ceil(length / 3) * 4 + 4);
  if (!BASE64.test(value)) invalid(label);
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== length || decoded.toString("base64") !== value)
    invalid(label);
  return new Uint8Array(decoded);
}
function encodedBoundedBytes(value, label, maximum) {
  if (
    !(value instanceof Uint8Array) ||
    value.length === 0 ||
    value.length > maximum
  )
    invalid(label);
  return Buffer.from(value).toString("base64");
}
function decodedBoundedBytes(value, label, maximum) {
  text(value, label, Math.ceil(maximum / 3) * 4 + 4);
  if (!BASE64.test(value)) invalid(label);
  const decoded = Buffer.from(value, "base64");
  if (
    !decoded.length ||
    decoded.length > maximum ||
    decoded.toString("base64") !== value
  )
    invalid(label);
  return new Uint8Array(decoded);
}
function encodedBigInt(value, label) {
  if (typeof value !== "bigint" || value < 0n || value > U64_MAX)
    invalid(label);
  return value.toString();
}
function decodedBigInt(value, label) {
  if (typeof value !== "string" || !U64_DECIMAL.test(value)) invalid(label);
  return BigInt(value);
}
function encodeTyped(value, bytes, integers, label) {
  exact(value, [...bytes, ...integers], label);
  const result = {};
  for (const key of bytes)
    result[key] = encodedBytes(value[key], `${label}.${key}`, 32);
  for (const key of integers)
    result[key] = encodedBigInt(value[key], `${label}.${key}`);
  return result;
}
function decodeTyped(value, bytes, integers, label) {
  exact(value, [...bytes, ...integers], label);
  const result = {};
  for (const key of bytes)
    result[key] = decodedBytes(value[key], `${label}.${key}`, 32);
  for (const key of integers)
    result[key] = decodedBigInt(value[key], `${label}.${key}`);
  return result;
}
function encodePrivateState(value) {
  exact(value, ["actor", "secret", "terms", "limit"], "privateState");
  return {
    actor: ["buyer", "merchant", "operator"].includes(value.actor)
      ? value.actor
      : invalid("privateState.actor"),
    secret: encodedBytes(value.secret, "privateState.secret", 32),
    terms: encodeTerms(value.terms),
    limit: encodedBigInt(value.limit, "privateState.limit"),
  };
}
function decodePrivateState(value) {
  exact(value, ["actor", "secret", "terms", "limit"], "privateState");
  return {
    actor: ["buyer", "merchant", "operator"].includes(value.actor)
      ? value.actor
      : invalid("privateState.actor"),
    secret: decodedBytes(value.secret, "privateState.secret", 32),
    terms: decodeTerms(value.terms),
    limit: decodedBigInt(value.limit, "privateState.limit"),
  };
}
function encodeTerms(value) {
  exact(value, [...TERM_BYTES, ...TERM_INTEGERS], "privateState.terms");
  const result = {};
  for (const key of TERM_INTEGERS)
    result[key] = encodedBigInt(value[key], `privateState.terms.${key}`);
  result.currency = encodedBytes(
    value.currency,
    "privateState.terms.currency",
    3,
  );
  for (const key of TERM_BYTES.slice(1))
    result[key] = encodedBytes(value[key], `privateState.terms.${key}`, 32);
  return result;
}
function decodeTerms(value) {
  exact(value, [...TERM_BYTES, ...TERM_INTEGERS], "privateState.terms");
  const result = {};
  for (const key of TERM_INTEGERS)
    result[key] = decodedBigInt(value[key], `privateState.terms.${key}`);
  result.currency = decodedBytes(
    value.currency,
    "privateState.terms.currency",
    3,
  );
  for (const key of TERM_BYTES.slice(1))
    result[key] = decodedBytes(value[key], `privateState.terms.${key}`, 32);
  return result;
}
function encodeStep(step) {
  exact(
    step,
    [
      "name",
      "phase",
      "identifiers",
      "txId",
      "txHash",
      "blockHash",
      "blockHeight",
    ],
    "step",
  );
  if (!STEPS.includes(step.name) || !PHASES.includes(step.phase))
    invalid("step name or phase");
  if (
    !Array.isArray(step.identifiers) ||
    step.identifiers.length > 15 ||
    new Set(step.identifiers).size !== step.identifiers.length ||
    !step.identifiers.every((id) => HEX_33.test(id))
  )
    invalid("step identifiers");
  for (const key of ["txId", "txHash", "blockHash", "blockHeight"])
    if (step[key] !== null) text(step[key], `step.${key}`);
  if (step.txId !== null && !HEX_33.test(step.txId)) invalid("step.txId");
  if (step.txHash !== null && !HEX_32.test(step.txHash)) invalid("step.txHash");
  if (step.blockHash !== null && !HEX_32.test(step.blockHash))
    invalid("step.blockHash");
  if (step.blockHeight !== null && !U64_DECIMAL.test(step.blockHeight))
    invalid("step.blockHeight");
  if (
    step.phase === "prepared" &&
    (step.identifiers.length ||
      step.txId ||
      step.txHash ||
      step.blockHash ||
      step.blockHeight)
  )
    invalid("prepared step identifiers");
  if (
    step.phase === "pending" &&
    (!step.identifiers.length ||
      step.txId ||
      step.txHash ||
      step.blockHash ||
      step.blockHeight)
  )
    invalid("pending step identifiers");
  if (
    step.phase === "confirmed" &&
    (!step.identifiers.length ||
      !step.txId ||
      !step.identifiers.includes(step.txId) ||
      !step.txHash ||
      !step.blockHash ||
      !step.blockHeight)
  )
    invalid("confirmed step identifiers");
  return { ...step, identifiers: [...step.identifiers] };
}
function encodeRecord(record) {
  exact(
    record,
    [
      "configuration",
      "privateState",
      "coinPublicKey",
      "signingKey",
      "address",
      "preparedDeployment",
      "steps",
    ],
    "record",
  );
  if (typeof record.signingKey !== "string" || !HEX_32.test(record.signingKey))
    invalid("signingKey");
  if (
    typeof record.coinPublicKey !== "string" ||
    !HEX_32.test(record.coinPublicKey)
  )
    invalid("coinPublicKey");
  if (typeof record.address !== "string" || !HEX_32.test(record.address))
    invalid("address");
  if (!Array.isArray(record.steps) || record.steps.length !== STEPS.length)
    invalid("steps");
  const steps = record.steps.map(encodeStep);
  if (!steps.every((step, index) => step.name === STEPS[index]))
    invalid("steps");
  return {
    configuration: encodeTyped(
      record.configuration,
      CONFIGURATION_BYTES,
      CONFIGURATION_INTEGERS,
      "configuration",
    ),
    privateState: encodePrivateState(record.privateState),
    coinPublicKey: record.coinPublicKey,
    signingKey: record.signingKey,
    address: record.address,
    preparedDeployment: encodedBoundedBytes(
      record.preparedDeployment,
      "preparedDeployment",
      MAX_PREPARED_DEPLOYMENT_BYTES,
    ),
    steps,
  };
}
function decodeRecord(value) {
  const encoded = encodeRecord({
    ...value,
    configuration: decodeTyped(
      value.configuration,
      CONFIGURATION_BYTES,
      CONFIGURATION_INTEGERS,
      "configuration",
    ),
    privateState: decodePrivateState(value.privateState),
    preparedDeployment: decodedBoundedBytes(
      value.preparedDeployment,
      "preparedDeployment",
      MAX_PREPARED_DEPLOYMENT_BYTES,
    ),
  });
  return {
    configuration: decodeTyped(
      encoded.configuration,
      CONFIGURATION_BYTES,
      CONFIGURATION_INTEGERS,
      "configuration",
    ),
    privateState: decodePrivateState(encoded.privateState),
    coinPublicKey: encoded.coinPublicKey,
    signingKey: encoded.signingKey,
    address: encoded.address,
    preparedDeployment: decodedBoundedBytes(
      encoded.preparedDeployment,
      "preparedDeployment",
      MAX_PREPARED_DEPLOYMENT_BYTES,
    ),
    steps: encoded.steps,
  };
}
function contextOf(value) {
  exact(
    value,
    ["network", "genesis", "artifactSet", "actorId", "orderId"],
    "context",
  );
  const result = {};
  for (const key of ["network", "genesis", "artifactSet", "actorId", "orderId"])
    result[key] = text(value[key], `context.${key}`);
  return result;
}
const canonical = (value) => JSON.stringify(value);
const pathFor = (context) =>
  `bootstrap-${createHash("sha256").update(canonical(context)).digest("hex")}.recovery`;
const aadFor = (context) =>
  Buffer.from(canonical({ schema: RECOVERY_SCHEMA_VERSION, context }));

async function secureDirectory(directory) {
  const root = resolve(directory);
  const parsed = parse(root);
  let current = parsed.root;
  const parts = root.slice(parsed.root.length).split("/").filter(Boolean);
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink() || !entry.isDirectory())
        throw new Error("Unsafe recovery-store directory");
      if (
        index === parts.length - 1 &&
        ((entry.mode & 0o077) !== 0 ||
          (process.getuid?.() !== undefined && entry.uid !== process.getuid()))
      )
        throw new Error("Recovery-store directory is not private");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await mkdir(current, { mode: 0o700 });
    }
  }
  return root;
}
async function regularOrMissing(path) {
  try {
    const entry = await lstat(path);
    if (entry.isSymbolicLink() || !entry.isFile())
      throw new Error("Unsafe recovery-store path");
    if (
      (entry.mode & 0o077) !== 0 ||
      (process.getuid?.() !== undefined && entry.uid !== process.getuid())
    )
      throw new Error("Recovery-store file is not private");
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
function seal(record, key, context) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aadFor(context));
  const ciphertext = Buffer.concat([
    cipher.update(canonical(record), "utf8"),
    cipher.final(),
  ]);
  const envelope = canonical({
    schema: RECOVERY_SCHEMA_VERSION,
    nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  });
  if (Buffer.byteLength(envelope, "utf8") > MAX_FILE_BYTES)
    invalid("envelope size");
  return envelope;
}
function unseal(contents, key, context) {
  if (Buffer.byteLength(contents, "utf8") > MAX_FILE_BYTES)
    throw new Error("Invalid bootstrap recovery envelope");
  let envelope;
  try {
    envelope = JSON.parse(contents);
  } catch {
    throw new Error("Invalid bootstrap recovery envelope");
  }
  exact(envelope, ["schema", "nonce", "ciphertext", "tag"], "envelope");
  if (envelope.schema !== RECOVERY_SCHEMA_VERSION) invalid("envelope schema");
  const nonce = decodedBytes(envelope.nonce, "envelope nonce", 12);
  const ciphertext = decodedBoundedBytes(
    envelope.ciphertext,
    "envelope ciphertext",
    MAX_FILE_BYTES,
  );
  const tag = decodedBytes(envelope.tag, "envelope tag", 16);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(aadFor(context));
    decipher.setAuthTag(tag);
    return decodeRecord(
      JSON.parse(
        Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
          "utf8",
        ),
      ),
    );
  } catch {
    throw new Error("Bootstrap recovery authentication failed");
  }
}
function sameIntent(left, right) {
  return (
    left.signingKey === right.signingKey &&
    left.coinPublicKey === right.coinPublicKey &&
    left.address === right.address &&
    canonical(
      encodeTyped(
        left.configuration,
        CONFIGURATION_BYTES,
        CONFIGURATION_INTEGERS,
        "configuration",
      ),
    ) ===
      canonical(
        encodeTyped(
          right.configuration,
          CONFIGURATION_BYTES,
          CONFIGURATION_INTEGERS,
          "configuration",
        ),
      ) &&
    canonical(encodePrivateState(left.privateState)) ===
      canonical(encodePrivateState(right.privateState)) &&
    Buffer.from(left.preparedDeployment).equals(
      Buffer.from(right.preparedDeployment),
    )
  );
}
function validProgress(previous, next) {
  for (const name of STEPS) {
    const before = previous.steps.find((step) => step.name === name);
    const after = next.steps.find((step) => step.name === name);
    const difference =
      PHASES.indexOf(after.phase) - PHASES.indexOf(before.phase);
    if (difference < 0) invalid("phase regression");
    if (difference > 1) invalid("phase jump");
    if (
      before.phase !== "prepared" &&
      canonical(before.identifiers) !== canonical(after.identifiers)
    )
      invalid("transaction identifier mutation");
    if (before.phase === "confirmed" && canonical(before) !== canonical(after))
      invalid("confirmed receipt mutation");
  }
  for (let index = 1; index < STEPS.length; index++) {
    const step = next.steps.find(
      (candidate) => candidate.name === STEPS[index],
    );
    const predecessor = next.steps.find(
      (candidate) => candidate.name === STEPS[index - 1],
    );
    if (step.phase !== "prepared" && predecessor.phase !== "confirmed")
      invalid("step order");
  }
}

async function readSecure(path, key, context) {
  if (!(await regularOrMissing(path))) return null;
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const entry = await handle.stat();
    if (
      !entry.isFile() ||
      (entry.mode & 0o077) !== 0 ||
      (process.getuid?.() !== undefined && entry.uid !== process.getuid()) ||
      entry.size > MAX_FILE_BYTES
    )
      throw new Error("Unsafe recovery-store path");
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        length,
        buffer.length - length,
        length,
      );
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > MAX_FILE_BYTES)
      throw new Error("Invalid bootstrap recovery envelope");
    return unseal(buffer.subarray(0, length).toString("utf8"), key, context);
  } finally {
    await handle?.close();
  }
}

async function withExclusiveLock(path, action) {
  const lockPath = `${path}.lock`;
  let handle;
  try {
    handle = await open(
      lockPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    await handle.writeFile("bootstrap recovery lock\n", "utf8");
    await handle.sync();
    return await action();
  } catch (error) {
    if (error?.code === "EEXIST")
      throw new Error(
        "Recovery checkpoint locked; manually reconcile the retained lock",
      );
    throw error;
  } finally {
    await handle?.close();
    if (handle) await rm(lockPath, { force: true });
  }
}

/** Local actor journal only: callers must reconcile pending submissions; this store never submits or retries. */
export async function openBootstrapRecoveryStore({
  directory,
  key,
  ...rawContext
}) {
  if (!(key instanceof Uint8Array) || key.length !== 32)
    throw new Error("Recovery key must be exactly 32 bytes");
  const context = contextOf(rawContext);
  const root = await secureDirectory(directory);
  const path = join(root, pathFor(context));
  const read = () => readSecure(path, key, context);
  return Object.freeze({
    path,
    read,
    async checkpoint(record) {
      const next = decodeRecord(encodeRecord(record));
      await withExclusiveLock(path, async () => {
        const previous = await read();
        if (previous) {
          if (!sameIntent(previous, next))
            throw new Error("Recovery checkpoint identity mismatch");
          validProgress(previous, next);
        } else {
          validProgress(
            {
              steps: STEPS.map((name) => ({
                name,
                phase: "prepared",
                identifiers: [],
                txId: null,
                txHash: null,
                blockHash: null,
                blockHeight: null,
              })),
            },
            next,
          );
        }
        const temporary = `${path}.${randomBytes(16).toString("hex")}.tmp`;
        let handle;
        try {
          handle = await open(temporary, "wx", 0o600);
          await handle.writeFile(
            seal(encodeRecord(next), key, context),
            "utf8",
          );
          await handle.sync();
          await handle.close();
          handle = undefined;
          await regularOrMissing(path);
          await rename(temporary, path);
          const directoryHandle = await open(root, "r");
          try {
            await directoryHandle.sync();
          } finally {
            await directoryHandle.close();
          }
        } finally {
          await handle?.close();
          await rm(temporary, { force: true });
        }
      });
    },
  });
}
