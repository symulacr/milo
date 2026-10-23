export async function sha256File(path: string): Promise<string> {
  return new Bun.CryptoHasher("sha256")
    .update(await Bun.file(path).arrayBuffer())
    .digest("hex");
}
