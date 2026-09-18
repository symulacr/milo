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

/** Prefixes served by the workspace entry (dev wildcard + Vercel rewrite). */
export const workspaceAppPrefixes = [
  "/quotes",
  "/orders",
  "/merchant",
  "/operator",
];
