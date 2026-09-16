export const sampleFiles = [
  {
    id: "01",
    name: "01-still-hero.png",
    title: "The hero",
    note: "Product portrait · studio composition",
    src: "/images/hero.png",
    hash: "21ec4110eedb37597293d858609f2c22d558fd3e6963bcd87e744b3a60dcce6a",
  },
  {
    id: "02",
    name: "02-still-detail.png",
    title: "The details",
    note: "Material study · close composition",
    src: "/images/detail.png",
    hash: "58221194d35709f6c489244ee5af248b316bded9b8296b68d03e59c70bc231a5",
  },
  {
    id: "03",
    name: "03-still-collection.png",
    title: "The collection",
    note: "Campaign composition · family portrait",
    src: "/images/collection.png",
    hash: "435f3d70cd82a623cd1ab65d174f57f47f7b5d1e59f55b60fbc9dd59a1f4a588",
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
