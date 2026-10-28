import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { requireSessionSubject } from "../packages/backend/src/session-identity";
import {
  type AdmissionContext,
  fail,
  type ReadContext,
} from "./admissionContext";
import { isOperator } from "./auth";

/**
 * The operator-readable dispute reason.
 *
 * The buyer seals the note in the browser to the operator's per-order public key
 * (published on the order payload) and stores only ciphertext here. The
 * plaintext never reaches this deployment, and `digest` is
 * `sha256(plaintext.trim())` — the same value the chain holds as
 * `evidenceCommitment` — so the operator verifies a decryption against the chain
 * instead of trusting this row.
 *
 * The AAD is the quote id, so a row copied to another order will not open.
 */

const HEX32 = /^[0-9a-f]{64}$/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_SEALED = 4096;

/** The buyer records the sealed note. One per order, refused after the first. */
export const put = mutationGeneric({
  args: {
    quoteId: v.string(),
    epk: v.string(),
    iv: v.string(),
    sealed: v.string(),
    digest: v.string(),
  },
  returns: v.union(
    v.object({ ok: v.literal(true) }),
    v.object({ ok: v.literal(false), reason: v.string() }),
  ),
  handler: async (ctx: AdmissionContext, args) => {
    const subject = requireSessionSubject(await ctx.auth.getUserIdentity());
    if (!HEX32.test(args.digest))
      return {
        ok: false as const,
        reason: "The digest must be 64 hex characters.",
      };
    if (!B64.test(args.epk) || !B64.test(args.iv) || !B64.test(args.sealed))
      return {
        ok: false as const,
        reason: "The sealed note is not valid base64.",
      };
    // Bounded before any query: `v.string()` accepts a megabyte.
    if (args.sealed.length > MAX_SEALED)
      return { ok: false as const, reason: "The sealed note is too large." };
    const draft = await ctx.db
      .query("quoteDrafts")
      .withIndex("by_quote", (q) => q.eq("id", args.quoteId))
      .unique();
    if (!draft) return { ok: false as const, reason: "Order not found." };
    // Only the buyer of this order may record its dispute reason.
    if (draft.buyerSubject !== subject)
      fail("FORBIDDEN", "only the client can record a dispute reason");
    const existing = await ctx.db
      .query("disputeNotes")
      .withIndex("by_quote", (q) => q.eq("quoteId", args.quoteId))
      .unique();
    // A second write would let a buyer rewrite the reason after the operator has
    // read it, which is the one thing this record exists to prevent.
    if (existing)
      return {
        ok: false as const,
        reason: "This order already has a dispute reason.",
      };
    await ctx.db.insert("disputeNotes", {
      quoteId: args.quoteId,
      epk: args.epk,
      iv: args.iv,
      sealed: args.sealed,
      digest: args.digest,
      createdAt: Date.now(),
    });
    return { ok: true as const };
  },
});

/** The operator reads the sealed note. Ciphertext only — it cannot open it. */
export const get = queryGeneric({
  args: { quoteId: v.string() },
  returns: v.union(
    v.object({
      epk: v.string(),
      iv: v.string(),
      sealed: v.string(),
      digest: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx: ReadContext, args) => {
    requireSessionSubject(await ctx.auth.getUserIdentity());
    // The same allowlist check every other operator surface uses.
    if (!(await isOperator(ctx))) return null;
    const row = await ctx.db
      .query("disputeNotes")
      .withIndex("by_quote", (q) => q.eq("quoteId", args.quoteId))
      .unique();
    if (!row) return null;
    return { epk: row.epk, iv: row.iv, sealed: row.sealed, digest: row.digest };
  },
});
