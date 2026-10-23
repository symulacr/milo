export const publicAppRoutes = [
  "/demo",
  "/sign-in",
  "/how-it-works",
  "/privacy",
  "/terms",
  "/pilot",
];

export const workspaceRoutes = [
  { path: "/orders", title: "Your orders" },
  { path: "/merchant/orders", title: "Studio queue" },
  { path: "/merchant/quotes/new", title: "New sample quote" },
  { path: "/operator/cases", title: "Resolution desk" },
  { path: "/account", title: "Account" },
  { path: "/connections", title: "Connection diagnostics" },
] as const;

export const workspaceAppRoutes = workspaceRoutes.map(
  (route): string => route.path,
);

export const publicAppPrefixes = ["/m"];

export const workspaceAppPrefixes = [
  "/quotes",
  "/orders",
  "/merchant",
  "/operator",
];
