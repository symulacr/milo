const sha256Hex = async (data: string | ArrayBuffer) =>
  new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      typeof data === "string" ? new TextEncoder().encode(data) : data,
    ),
  ).toHex();

export const sampleFiles = [
  {
    title: "The hero",
    src: "/images/hero.webp",
    hash: "a70f248e5504aeec43e59ac68ebd9516614dd5c839a338635bceabf2cdfa8fda",
  },
  {
    title: "The details",
    src: "/images/detail.webp",
    hash: "3a07f69f751b1ec4bee4ffe0fd95dbaed043d7553bf5375f6dba9f3d797cf8bf",
  },
  {
    title: "The collection",
    src: "/images/collection.webp",
    hash: "e994848a179a98868efdf731e761b0560790aaea029626d455e2a5a7fd9ba9a7",
  },
] as const;

export const MISMATCH =
  "A file does not match its locked digest. You cannot approve this delivery.";

export async function checkSampleFiles(signal: AbortSignal) {
  const digests = await Promise.all(
    sampleFiles.map(async (file) => {
      const response = await fetch(file.src, { signal, cache: "no-store" });
      if (!response.ok) throw new Error("A file is not available. Try again.");
      return sha256Hex(await response.arrayBuffer());
    }),
  );
  const manifest = await sha256Hex(digests.join(""));
  return {
    digests,
    manifest,
    match: digests.every((value, index) => value === sampleFiles[index]?.hash),
  };
}
