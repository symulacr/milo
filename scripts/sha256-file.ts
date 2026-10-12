/**
 * The one file-digest helper.
 *
 * Three setup scripts and the contract compiler each carried an identical copy of this
 * expression. A checksum that gates a toolchain download is exactly the kind of thing that
 * must have one definition rather than four that can drift apart.
 */
export async function sha256File(path: string): Promise<string> {
  return new Bun.CryptoHasher("sha256")
    .update(await Bun.file(path).arrayBuffer())
    .digest("hex");
}
