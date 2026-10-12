export const sampleFiles = [
  {
    id: "01",
    name: "01-still-hero.webp",
    title: "The hero",
    note: "Product portrait · studio composition",
    src: "/images/hero.webp",
    hash: "a70f248e5504aeec43e59ac68ebd9516614dd5c839a338635bceabf2cdfa8fda",
  },
  {
    id: "02",
    name: "02-still-detail.webp",
    title: "The details",
    note: "Material study · close composition",
    src: "/images/detail.webp",
    hash: "3a07f69f751b1ec4bee4ffe0fd95dbaed043d7553bf5375f6dba9f3d797cf8bf",
  },
  {
    id: "03",
    name: "03-still-collection.webp",
    title: "The collection",
    note: "Campaign composition · family portrait",
    src: "/images/collection.webp",
    hash: "e994848a179a98868efdf731e761b0560790aaea029626d455e2a5a7fd9ba9a7",
  },
] as const;

export async function verifySampleFiles(
  signal: AbortSignal,
): Promise<string[]> {
  return Promise.all(
    sampleFiles.map(async (file) => {
      const response = await fetch(file.src, { signal, cache: "no-store" });
      if (!response.ok) throw new Error("File unavailable. Please try again.");
      const bytes = await response.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const hash = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      if (hash !== file.hash)
        throw new Error(
          "Cannot verify: sample bytes do not match the expected digest. Approval stays blocked.",
        );
      return file.id;
    }),
  );
}
