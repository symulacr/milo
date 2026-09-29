import { createHash } from "node:crypto";

/**
 * Node/ESM twin of packages/backend/src/delivery-policy.ts `deliveryCommitment`.
 *
 * deliveryCommitment(files) = SHA-256( hex(f0.sha256) || hex(f1.sha256) || hex(f2.sha256) )
 *
 * Each `f.sha256` is the lowercase 64-hex SHA-256 of that file's raw bytes (as
 * produced by inspectBytes). The join is plain string concatenation of the three
 * hex digests (192 ASCII chars), then one SHA-256 over those bytes. Flat
 * merkle-style commitment: order-sensitive, exactly 3 leaves, reproducible from
 * the frozen manifest alone. Output is 64-char lowercase hex.
 *
 * Never use randomBytes for a delivery commitment.
 */
export function deliveryCommitment(files) {
  if (!Array.isArray(files) || files.length !== 3)
    throw new Error("delivery commitment requires exactly three file digests");
  const joined = files
    .map((entry) => {
      const digest = entry?.sha256;
      if (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest))
        throw new Error("invalid file digest");
      return digest;
    })
    .join("");
  return createHash("sha256").update(joined, "utf8").digest("hex");
}
