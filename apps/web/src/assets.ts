export const sampleFiles = [
  {
    id: "01",
    name: "01-still-hero.png",
    title: "The hero",
    note: "Product portrait · studio composition",
    src: "/images/hero.png",
    hash: "a05e51ca6ec13e5c880cb363d275d2ca5fface6fcaa735a8ca1449d63e903519",
  },
  {
    id: "02",
    name: "02-still-detail.png",
    title: "The details",
    note: "Material study · close composition",
    src: "/images/detail.png",
    hash: "3dbf9f923e11a17c9640e50cea8d9b152244f93a8637058dff8d97b9b38c7b20",
  },
  {
    id: "03",
    name: "03-still-collection.png",
    title: "The collection",
    note: "Campaign composition · family portrait",
    src: "/images/collection.png",
    hash: "cf4bebec832e7af624ee329bf0caf3efb4f87b7ac9c564564349557ae93d8baf",
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
