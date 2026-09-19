/**
 * Single source of truth for the route split (01 §7.4/§9.1): the lean public
 * SPA entry versus the workspace app. scripts/build.ts and scripts/dev.ts
 * derive their route lists from this table, and route-parity.test.ts keeps
 * the React router tree, the dev wildcards, the generated _redirects and the
 * vercel.json rewrites in step with it.
 */
export const publicAppRoutes = [
  "/demo",
  "/sign-in",
  "/how-it-works",
  "/privacy",
  "/terms",
  "/pilot",
];

export const workspaceAppRoutes = [
  "/orders",
  "/merchant/orders",
  "/merchant/quotes/new",
  "/operator/cases",
  "/account",
  "/connections",
];

/** Prefixes served by the public entry (dev wildcard + static-host rule). */
export const publicAppPrefixes = ["/m"];

/**
 * Prefixes served by the workspace entry (dev wildcard + Vercel rewrite).
 * Host note: unknown paths fall through to the workspace app in dev and via
 * the generated _redirects catch-all, while Vercel 404s them (its rewrites
 * have no catch-all here and filesystem always wins over rewrites). That
 * difference is intentional: no rewrite may shadow the emitted
 * dist/api/public-config file or the static assets.
 */
export const workspaceAppPrefixes = [
  "/quotes",
  "/orders",
  "/merchant",
  "/operator",
];
