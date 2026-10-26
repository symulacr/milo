export const publicAppRoutes = ["/privacy", "/terms"];

const workspaceRoutes = [
  { path: "/orders", title: "Orders" },
  { path: "/account", title: "Account" },
] as const;

export const workspaceAppRoutes = workspaceRoutes.map(
  (route): string => route.path,
);

export const publicAppPrefixes: string[] = [];

export const workspaceAppPrefixes = ["/orders"];

export const legacyRedirects = [
  ["/demo", "/orders"],
  ["/m/north-studio", "/"],
  ["/how-it-works", "/#how"],
  ["/pilot", "/#faq"],
  ["/sign-in", "/account"],
  ["/connections", "/account"],
  ["/merchant/orders", "/orders"],
  ["/merchant/quotes/new", "/orders/new"],
  ["/operator/cases", "/orders"],
  ["/operator/cases/:id", "/orders/:id"],
  ["/quotes/:id", "/orders/:id"],
  ["/orders/:id/receipt", "/orders/:id"],
] as const;
