import assert from "node:assert/strict";
import { mkdir, rename, rm } from "node:fs/promises";

export async function sha256File(path: string): Promise<string> {
  return new Bun.CryptoHasher("sha256")
    .update(await Bun.file(path).arrayBuffer())
    .digest("hex");
}

/**
 * Downloads `url` to `archive` unless that file already carries `expected`,
 * then verifies it. A partial download is removed on any failure, so it can
 * never look like a good one.
 */
export async function fetchVerified(
  url: string,
  archive: string,
  expected: string,
  message = "Download checksum mismatch",
): Promise<void> {
  await mkdir(archive.slice(0, archive.lastIndexOf("/")), { recursive: true });
  if (
    (await Bun.file(archive).exists()) &&
    (await sha256File(archive)) === expected
  )
    return;
  const response = await fetch(url);
  assert(response.ok, `${message}: HTTP ${response.status}`);
  const temporary = `${archive}.${crypto.randomUUID()}.part`;
  try {
    await Bun.write(temporary, response);
    assert.equal(await sha256File(temporary), expected, message);
    await rename(temporary, archive);
  } finally {
    await rm(temporary, { force: true });
  }
}
