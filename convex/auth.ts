import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { betterAuth } from "better-auth/minimal";
import { magicLink } from "better-auth/plugins";
import { queryGeneric } from "convex/server";
import { v } from "convex/values";
import { inviteFailureReason, sendEmail } from "../packages/backend/src/email";
import { env } from "../packages/backend/src/encoding";
import { ORDER_WINDOWS_MS } from "../packages/backend/src/order-windows";
import {
  operatorEmails,
  requireSessionSubject,
} from "../packages/backend/src/session-identity";
import { WALLET_EMAIL_DOMAIN } from "../packages/backend/src/wallet-auth";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { walletAuth } from "./auth/walletPlugin";
import authConfig from "./auth.config";

/**
 * Read a required deployment setting, failing closed.
 *
 * `registerRoutes` calls `createAuth({})` once at module load purely to read
 * `options.basePath` — no request, no session — so validating there would make
 * `convex/http.ts` unimportable without the env. The empty-ctx probe therefore
 * gets the fallback, and a real request gets the hard failure. A deployment
 * that never sets the value still fails on its first sign-in attempt.
 */
const required = (
  ctx: GenericCtx<DataModel>,
  name: string,
  probe: string,
  minLength = 1,
): string => {
  const value = env(name);
  if (value && value.length >= minLength) return value;
  if (Object.keys(ctx as object).length === 0) return probe;
  throw new Error(`${name} is not configured or too short.`);
};

export const authComponent = createClient<DataModel>(components.betterAuth);

/**
 * The magic-link token travels in the query string of the verify URL, so any
 * `Referer` the page emits hands it to a third party. OWASP's guidance for
 * URL-borne secrets is `Referrer-Policy: no-referrer` on the landing response.
 *
 * Better Auth's own after-hook is the cheapest place to do it: `ctx.setHeader`
 * is the documented way for a hook to add a response header, and it needs no
 * wrapper around `registerRoutes` and no extra route. Only the verify hop is
 * touched — the rest of the auth surface keeps the site's normal policy.
 */
const noReferrerOnVerify = createAuthMiddleware(async (ctx) => {
  if (ctx.path === "/magic-link/verify")
    ctx.setHeader("referrer-policy", "no-referrer");
});

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth({
    baseURL: env("CONVEX_SITE_URL"),
    secret: required(ctx, "BETTER_AUTH_SECRET", "unconfigured-probe", 32),
    // One env var, a list of origins. A second Vercel domain (a preview, or a
    // custom domain during cutover) is a comma in SITE_URL, not a code change.
    trustedOrigins: required(ctx, "SITE_URL", "http://localhost:5173")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    hooks: { after: noReferrerOnVerify },
    database: authComponent.adapter(ctx),
    /**
     * R22 I-07. `updateAge` is a refresh cadence: a session used after it has
     * its expiry pushed to `now + expiresIn`. With a 1-day cadence and a 7-day
     * expiry an ACTIVE session never ends, so the privacy page's "7 days, then
     * you sign in again" was false and a stolen token stayed valid for as long
     * as the account was used. `disableSessionRefresh` makes `expiresIn`
     * absolute; the cost is a re-sign-in weekly, one click for a magic-link
     * product. (`revokeSession`/`revokeSessions` remain the explicit paths.)
     */
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      disableSessionRefresh: true,
    },
    // Database-backed built-in limiter. Magic-link sends email, so it is
    // strictest; the wallet routes are public and unauthenticated, and each
    // `/wallet/verify` costs a signature check, so they need a cap too.
    rateLimit: {
      enabled: true,
      storage: "database",
      customRules: {
        "/sign-in/magic-link": { window: 60, max: 3 },
        "/wallet/nonce": { window: 60, max: 10 },
        "/wallet/verify": { window: 60, max: 10 },
      },
    },
    plugins: [
      crossDomain({
        siteUrl: required(ctx, "SITE_URL", "http://localhost:5173"),
      }),
      convex({ authConfig }),
      magicLink({
        // G-16: the sign-in link gates an order invite that has **no expiry** of
        // its own — only the order's acceptance window, which is one hour. A
        // 15-minute link therefore outlived nothing and gated everything: a
        // buyer who read the mail at minute 16 held a valid order and a dead
        // sign-in link, and could never open it on the first try.
        //
        // Derived from the window it has to cover rather than written as a
        // literal, so the two clocks cannot drift apart again. `acceptance` is
        // the only one that matters here: after it the order is gone anyway.
        expiresIn: ORDER_WINDOWS_MS.acceptance / 1000,
        storeToken: "hashed",
        // A plain throw becomes a bodyless 500, so the client would show
        // nothing. APIError is the one shape better-call serializes.
        sendMagicLink: ({ email, url }) =>
          sendEmail({ to: email, url }).catch((cause) => {
            throw new APIError("SERVICE_UNAVAILABLE", {
              message: inviteFailureReason(cause),
              code: "EMAIL_FAILED",
            });
          }),
      }),
      walletAuth(),
    ],
  });

export const { getAuthUser } = authComponent.clientApi();

const walletAddressOf = (email: string | null | undefined): string | null =>
  typeof email === "string" && email.endsWith(`@${WALLET_EMAIL_DOMAIN}`)
    ? email.slice(0, -`.${WALLET_EMAIL_DOMAIN}`.length).replace(/^wallet-/, "")
    : null;

export const me = queryGeneric({
  args: {},
  returns: v.object({
    subject: v.string(),
    email: v.union(v.string(), v.null()),
    walletAddress: v.union(v.string(), v.null()),
    studio: v.union(
      v.object({ scopeId: v.string(), name: v.string() }),
      v.null(),
    ),
    operator: v.boolean(),
  }),
  handler: async (ctx) => {
    const subject = requireSessionSubject(await ctx.auth.getUserIdentity());
    const user = await authComponent.safeGetAuthUser(ctx);
    const email = user?.email ?? null;
    const walletAddress = walletAddressOf(email);
    const membership = await merchantMembershipOf(ctx, subject);
    return {
      subject,
      email: walletAddress === null ? email : null,
      walletAddress,
      studio: membership?.studioName
        ? { scopeId: membership.scopeId, name: membership.studioName }
        : null,
      operator: operatorEmails().includes((email ?? "").toLowerCase()),
    };
  },
});

/**
 * Item 8: the operator path. `MILO_OPERATOR_EMAILS` decides who may act as an
 * operator, but `orders:list` and `orders:order` read a membership row. This
 * creates that row for an allowlisted email, once, on demand.
 *
 * The scope is a fixed operator scope, not a studio scope: an operator resolves
 * disputes across studios and must never gain merchant rights inside one.
 */
export const OPERATOR_SCOPE = "milo-operators";

/**
 * Item 8: operator rights come from the allowlist, not from a stored row.
 * A membership row would be a second source of truth that drifts when the
 * allowlist changes; reading the allowlist keeps one answer.
 *
 * The decision is pure so it is testable without the auth component.
 */
export function operatorAllowed(
  email: string | null | undefined,
  configured = operatorEmails(),
): boolean {
  return configured.includes((email ?? "").trim().toLowerCase());
}

export async function isOperator(ctx: QueryCtx): Promise<boolean> {
  if (operatorEmails().length === 0) return false;
  const user = await authComponent.safeGetAuthUser(ctx);
  return operatorAllowed(user?.email);
}

/** The subject's active merchant membership, if any. Shared by `me` and
 * `trustedProvisioning:studioFor`. */
export const merchantMembershipOf = (
  ctx: { db: QueryCtx["db"] },
  subject: string,
) =>
  ctx.db
    .query("memberships")
    .withIndex("by_subject", (q) => q.eq("privySubject", subject))
    .filter((q) => q.eq(q.field("role"), "merchant"))
    .filter((q) => q.eq(q.field("status"), "active"))
    .first();
